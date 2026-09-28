import net from "node:net";
import tls from "node:tls";

const INCOMPLETE = Symbol("incomplete");

function command(parts) {
  const chunks = [
    Buffer.from(`*${parts.length}\r\n`)
  ];
  for (const part of parts) {
    const value = Buffer.from(String(part), "utf8");
    chunks.push(
      Buffer.from(`$${value.length}\r\n`),
      value,
      Buffer.from("\r\n")
    );
  }
  return Buffer.concat(chunks);
}

function parseValue(buffer, offset = 0) {
  if (offset >= buffer.length) return INCOMPLETE;

  const prefix = String.fromCharCode(buffer[offset]);
  const lineEnd = buffer.indexOf("\r\n", offset + 1);

  if (prefix !== "$" && prefix !== "*") {
    if (lineEnd < 0) return INCOMPLETE;
    const text = buffer
      .subarray(offset + 1, lineEnd)
      .toString("utf8");
    if (prefix === "+") {
      return { value: text, next: lineEnd + 2 };
    }
    if (prefix === "-") {
      return {
        value: new Error(text),
        next: lineEnd + 2
      };
    }
    if (prefix === ":") {
      return {
        value: Number(text),
        next: lineEnd + 2
      };
    }
    throw new Error("unsupported_redis_frame");
  }

  if (lineEnd < 0) return INCOMPLETE;
  const count = Number(
    buffer
      .subarray(offset + 1, lineEnd)
      .toString("utf8")
  );

  if (prefix === "$") {
    if (count === -1) {
      return { value: null, next: lineEnd + 2 };
    }
    const start = lineEnd + 2;
    const end = start + count;
    if (buffer.length < end + 2) return INCOMPLETE;
    return {
      value: buffer.subarray(start, end).toString("utf8"),
      next: end + 2
    };
  }

  const values = [];
  let next = lineEnd + 2;
  for (let index = 0; index < count; index += 1) {
    const parsed = parseValue(buffer, next);
    if (parsed === INCOMPLETE) return INCOMPLETE;
    values.push(parsed.value);
    next = parsed.next;
  }
  return { value: values, next };
}

class RespStream {
  constructor(onValue) {
    this.buffer = Buffer.alloc(0);
    this.onValue = onValue;
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length) {
      const parsed = parseValue(this.buffer, 0);
      if (parsed === INCOMPLETE) return;
      this.buffer = this.buffer.subarray(parsed.next);
      this.onValue(parsed.value);
    }
  }
}

function connectSocket(url) {
  const options = {
    host: url.hostname,
    port: Number(
      url.port ||
      (url.protocol === "rediss:" ? 6380 : 6379)
    )
  };

  return url.protocol === "rediss:"
    ? tls.connect({
        ...options,
        servername: url.hostname
      })
    : net.connect(options);
}

function authCommands(url) {
  const commands = [];
  const username = decodeURIComponent(
    url.username || ""
  );
  const password = decodeURIComponent(
    url.password || ""
  );

  if (password) {
    commands.push(
      username
        ? ["AUTH", username, password]
        : ["AUTH", password]
    );
  }

  const db = url.pathname.replace(/^\//, "");
  if (db && /^[0-9]+$/.test(db) && db !== "0") {
    commands.push(["SELECT", db]);
  }
  return commands;
}

export class RedisFanout {
  constructor({
    redisUrl = "",
    channel = "rekixo:geolive:events",
    instanceId
  }) {
    this.redisUrl = String(redisUrl || "").trim();
    this.channel = channel;
    this.instanceId = instanceId;
    this.closed = false;
    this.publisher = null;
    this.subscriber = null;
    this.subscribed = false;
    this.onEvent = null;
    this.retryTimer = null;
  }

  get enabled() {
    return Boolean(this.redisUrl);
  }

  get ready() {
    return !this.enabled || Boolean(
      this.publisher &&
      !this.publisher.destroyed &&
      this.subscriber &&
      !this.subscriber.destroyed &&
      this.subscribed
    );
  }

  start(onEvent) {
    this.onEvent = onEvent;
    if (!this.enabled || this.closed) return;
    this.#connect();
  }

  publish(event) {
    if (!this.enabled || !this.publisher || this.publisher.destroyed) {
      return false;
    }

    const payload = JSON.stringify({
      source: this.instanceId,
      event
    });

    try {
      this.publisher.write(
        command(["PUBLISH", this.channel, payload])
      );
      return true;
    } catch {
      return false;
    }
  }

  close() {
    this.closed = true;
    clearTimeout(this.retryTimer);
    this.publisher?.destroy();
    this.subscriber?.destroy();
    this.publisher = null;
    this.subscriber = null;
    this.subscribed = false;
  }

  #scheduleReconnect() {
    if (this.closed || !this.enabled) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(
      () => this.#connect(),
      1500
    );
    this.retryTimer.unref?.();
  }

  #connect() {
    if (this.closed) return;

    let url;
    try {
      url = new URL(this.redisUrl);
    } catch {
      return;
    }
    if (!["redis:", "rediss:"].includes(url.protocol)) {
      return;
    }

    this.publisher?.destroy();
    this.subscriber?.destroy();
    this.subscribed = false;

    const publisher = connectSocket(url);
    const subscriber = connectSocket(url);
    this.publisher = publisher;
    this.subscriber = subscriber;

    const reconnect = () => {
      this.subscribed = false;
      this.#scheduleReconnect();
    };
    publisher.once("error", reconnect);
    subscriber.once("error", reconnect);
    publisher.once("close", reconnect);
    subscriber.once("close", reconnect);

    const publisherStream = new RespStream(() => {});
    publisher.on("data", (chunk) => {
      publisherStream.push(chunk);
    });
    publisher.once("connect", () => {
      for (const parts of authCommands(url)) {
        publisher.write(command(parts));
      }
    });

    const stream = new RespStream((value) => {
      if (
        Array.isArray(value) &&
        value[0] === "subscribe" &&
        value[1] === this.channel
      ) {
        this.subscribed = true;
        return;
      }

      if (
        Array.isArray(value) &&
        value[0] === "message" &&
        value[1] === this.channel &&
        typeof value[2] === "string"
      ) {
        try {
          const parsed = JSON.parse(value[2]);
          if (
            parsed.source !== this.instanceId &&
            parsed.event &&
            this.onEvent
          ) {
            this.onEvent(parsed.event);
          }
        } catch {}
      }
    });

    subscriber.on("data", (chunk) => stream.push(chunk));
    subscriber.once("connect", () => {
      for (const parts of authCommands(url)) {
        subscriber.write(command(parts));
      }
      subscriber.write(
        command(["SUBSCRIBE", this.channel])
      );
    });
  }
}

export const redisProtocol = {
  command,
  parseValue
};
