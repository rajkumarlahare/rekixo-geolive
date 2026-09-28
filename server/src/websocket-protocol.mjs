import crypto from "node:crypto";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export function acceptWebSocketKey(key) {
  return crypto
    .createHash("sha1")
    .update(String(key) + WS_GUID)
    .digest("base64");
}

export function encodeWebSocketFrame(
  opcode,
  payload = Buffer.alloc(0)
) {
  const body = Buffer.isBuffer(payload)
    ? payload
    : Buffer.from(String(payload), "utf8");
  const length = body.length;

  let header;
  if (length < 126) {
    header = Buffer.allocUnsafe(2);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = length;
  } else if (length <= 0xffff) {
    header = Buffer.allocUnsafe(4);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.allocUnsafe(10);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  return Buffer.concat([header, body]);
}

export function upgradeWebSocket(req, socket) {
  const key = req.headers["sec-websocket-key"];
  const version = req.headers["sec-websocket-version"];
  const upgrade = String(req.headers.upgrade || "").toLowerCase();
  const connection = String(req.headers.connection || "").toLowerCase();

  if (
    req.method !== "GET" ||
    !key ||
    version !== "13" ||
    upgrade !== "websocket" ||
    !connection.split(",").map((v) => v.trim()).includes("upgrade")
  ) {
    socket.write(
      "HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"
    );
    socket.destroy();
    return null;
  }

  const accept = acceptWebSocketKey(key);
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );

  return new WebSocketPeer(socket);
}

export class WebSocketPeer {
  constructor(socket, {
    maxPayloadBytes = 64 * 1024,
    maxBufferedBytes = 1024 * 1024,
    maxQueuedFrames = 256
  } = {}) {
    this.socket = socket;
    this.maxPayloadBytes = maxPayloadBytes;
    this.maxBufferedBytes = maxBufferedBytes;
    this.maxQueuedFrames = maxQueuedFrames;
    this.buffer = Buffer.alloc(0);
    this.queue = [];
    this.coalesced = new Map();
    this.closed = false;
    this.lastPongAt = Date.now();
    this.onText = null;
    this.onClose = null;
    this.onError = null;

    socket.on("data", (chunk) => this.#onData(chunk));
    socket.on("drain", () => this.#flush());
    socket.on("close", () => this.#finish());
    socket.on("end", () => this.#finish());
    socket.on("error", (error) => {
      if (this.onError) this.onError(error);
      this.#finish();
    });
  }

  sendJson(value, { coalesceKey = "" } = {}) {
    return this.sendText(
      JSON.stringify(value),
      { coalesceKey }
    );
  }

  sendText(text, { coalesceKey = "" } = {}) {
    if (this.closed) return false;
    const frame = encodeWebSocketFrame(
      0x1,
      Buffer.from(String(text), "utf8")
    );
    return this.#enqueue(frame, coalesceKey);
  }

  ping() {
    if (this.closed) return;
    this.#enqueue(
      encodeWebSocketFrame(0x9, Buffer.from("g")),
      ""
    );
  }

  close(code = 1000, reason = "") {
    if (this.closed) return;
    this.closed = true;

    const cleanReason = Buffer.from(
      String(reason).slice(0, 100),
      "utf8"
    );
    const payload = Buffer.allocUnsafe(
      2 + cleanReason.length
    );
    payload.writeUInt16BE(code, 0);
    cleanReason.copy(payload, 2);

    try {
      this.socket.write(
        encodeWebSocketFrame(0x8, payload)
      );
    } catch {}
    this.socket.end();
    this.#finish();
  }

  #enqueue(frame, coalesceKey) {
    if (
      this.socket.writableLength < this.maxBufferedBytes &&
      this.queue.length === 0 &&
      this.coalesced.size === 0
    ) {
      const writable = this.socket.write(frame);
      return writable;
    }

    if (coalesceKey) {
      this.coalesced.set(coalesceKey, frame);
    } else {
      this.queue.push(frame);
    }

    if (
      this.queue.length + this.coalesced.size >
      this.maxQueuedFrames
    ) {
      this.close(1013, "backpressure");
      return false;
    }

    this.#flush();
    return true;
  }

  #flush() {
    if (this.closed) return;

    while (
      this.socket.writableLength < this.maxBufferedBytes
    ) {
      let frame = this.queue.shift();
      if (!frame && this.coalesced.size) {
        const first = this.coalesced.entries().next();
        if (!first.done) {
          const [key, value] = first.value;
          this.coalesced.delete(key);
          frame = value;
        }
      }
      if (!frame) break;

      if (!this.socket.write(frame)) break;
    }
  }

  #onData(chunk) {
    if (this.closed) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);

    try {
      while (this.#parseFrame()) {}
    } catch (error) {
      if (this.onError) this.onError(error);
      this.close(1002, "protocol_error");
    }
  }

  #parseFrame() {
    if (this.buffer.length < 2) return false;

    const first = this.buffer[0];
    const second = this.buffer[1];
    const fin = Boolean(first & 0x80);
    const opcode = first & 0x0f;
    const masked = Boolean(second & 0x80);
    let length = second & 0x7f;
    let offset = 2;

    if (!fin) {
      throw new Error("fragmented_frames_not_supported");
    }
    if (!masked) {
      throw new Error("client_frame_must_be_masked");
    }

    if (length === 126) {
      if (this.buffer.length < 4) return false;
      length = this.buffer.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (this.buffer.length < 10) return false;
      const big = this.buffer.readBigUInt64BE(2);
      if (big > BigInt(this.maxPayloadBytes)) {
        throw new Error("payload_too_large");
      }
      length = Number(big);
      offset = 10;
    }

    if (length > this.maxPayloadBytes) {
      this.close(1009, "payload_too_large");
      return false;
    }

    const total = offset + 4 + length;
    if (this.buffer.length < total) return false;

    const mask = this.buffer.subarray(offset, offset + 4);
    const payload = Buffer.from(
      this.buffer.subarray(offset + 4, total)
    );
    this.buffer = this.buffer.subarray(total);

    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4];
    }

    if (opcode === 0x8) {
      this.close(1000, "");
      return this.buffer.length > 0;
    }
    if (opcode === 0x9) {
      this.socket.write(
        encodeWebSocketFrame(0xA, payload)
      );
      return this.buffer.length > 0;
    }
    if (opcode === 0xA) {
      this.lastPongAt = Date.now();
      return this.buffer.length > 0;
    }
    if (opcode !== 0x1) {
      throw new Error("unsupported_opcode");
    }

    const text = payload.toString("utf8");
    if (this.onText) this.onText(text);
    return this.buffer.length > 0;
  }

  #finish() {
    if (this._finished) return;
    this._finished = true;
    this.closed = true;
    if (this.onClose) this.onClose();
  }
}
