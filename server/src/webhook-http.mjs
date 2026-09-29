import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

function ipv4Public(address) {
  const parts = String(address)
    .split(".")
    .map(Number);
  if (
    parts.length !== 4 ||
    parts.some(
      (value) =>
        !Number.isInteger(value) ||
        value < 0 ||
        value > 255
    )
  ) {
    return false;
  }
  const [a, b] = parts;

  if (a === 0 || a === 10 || a === 127) {
    return false;
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return false;
  }
  if (a === 169 && b === 254) {
    return false;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return false;
  }
  if (a === 192 && b === 168) {
    return false;
  }
  if (a === 192 && b === 0) {
    return false;
  }
  if (a === 192 && b === 0 && parts[2] === 2) {
    return false;
  }
  if (a === 198 && (b === 18 || b === 19)) {
    return false;
  }
  if (a === 198 && b === 51 && parts[2] === 100) {
    return false;
  }
  if (a === 203 && b === 0 && parts[2] === 113) {
    return false;
  }
  if (a >= 224) {
    return false;
  }
  return true;
}

function ipv6Public(address) {
  const value = String(address)
    .toLowerCase()
    .split("%")[0];

  if (
    value === "::" ||
    value === "::1" ||
    value.startsWith("fc") ||
    value.startsWith("fd") ||
    value.startsWith("ff") ||
    value.startsWith("fe8") ||
    value.startsWith("fe9") ||
    value.startsWith("fea") ||
    value.startsWith("feb") ||
    value.startsWith("2001:db8:")
  ) {
    return false;
  }

  if (value.startsWith("::ffff:")) {
    const mapped =
      value.slice("::ffff:".length);
    if (net.isIP(mapped) === 4) {
      return ipv4Public(mapped);
    }
  }

  return true;
}

export function isPublicWebhookAddress(
  address
) {
  const family = net.isIP(address);
  if (family === 4) {
    return ipv4Public(address);
  }
  if (family === 6) {
    return ipv6Public(address);
  }
  return false;
}

export async function resolveWebhookTarget(
  rawUrl,
  {
    isProduction = true
  } = {}
) {
  let url;
  try {
    url = new URL(
      String(rawUrl || "")
    );
  } catch {
    const error = new Error(
      "invalid_webhook_url"
    );
    error.code =
      "invalid_webhook_url";
    error.status = 400;
    throw error;
  }

  if (
    url.username ||
    url.password ||
    url.hash ||
    (
      isProduction
        ? url.protocol !== "https:"
        : ![
            "http:",
            "https:"
          ].includes(url.protocol)
    )
  ) {
    const error = new Error(
      "invalid_webhook_url"
    );
    error.code =
      "invalid_webhook_url";
    error.status = 400;
    throw error;
  }

  const hostname =
    url.hostname
      .toLowerCase()
      .replace(/^\[/, "")
      .replace(/\]$/, "");
  if (
    isProduction &&
    (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local")
    )
  ) {
    const error = new Error(
      "webhook_private_target"
    );
    error.code =
      "webhook_private_target";
    error.status = 400;
    throw error;
  }

  const literalFamily =
    net.isIP(hostname);
  let addresses;
  if (literalFamily) {
    addresses = [{
      address: hostname,
      family: literalFamily
    }];
  } else {
    addresses = await dns.lookup(
      hostname,
      {
        all: true,
        verbatim: true
      }
    );
  }

  if (
    !addresses.length ||
    (
      isProduction &&
      addresses.some(
        ({ address }) =>
          !isPublicWebhookAddress(
            address
          )
      )
    )
  ) {
    const error = new Error(
      "webhook_private_target"
    );
    error.code =
      "webhook_private_target";
    error.status = 400;
    throw error;
  }

  return {
    url,
    hostname,
    address:
      addresses[0].address,
    family:
      addresses[0].family
  };
}

export async function postWebhook({
  url,
  body,
  headers = {},
  timeoutMs = 10000,
  isProduction = true
}) {
  const target =
    await resolveWebhookTarget(
      url,
      { isProduction }
    );

  const bodyBuffer =
    Buffer.from(
      String(body),
      "utf8"
    );
  const transport =
    target.url.protocol === "https:"
      ? https
      : http;

  return new Promise(
    (resolve, reject) => {
      let settled = false;

      const request = transport.request(
        {
          protocol:
            target.url.protocol,
          hostname:
            target.hostname,
          port:
            target.url.port ||
            (
              target.url.protocol ===
              "https:"
                ? 443
                : 80
            ),
          path:
            target.url.pathname +
            target.url.search,
          method: "POST",
          servername:
            net.isIP(
              target.hostname
            )
              ? undefined
              : target.hostname,
          headers: {
            host: target.url.host,
            "content-type":
              "application/json",
            "content-length":
              String(
                bodyBuffer.length
              ),
            "user-agent":
              "Rekixo-GeoLive-Webhooks/1.0",
            ...headers
          },
          lookup(
            _hostname,
            _options,
            callback
          ) {
            callback(
              null,
              target.address,
              target.family
            );
          }
        },
        (response) => {
          const chunks = [];
          let bytes = 0;
          response.on(
            "data",
            (chunk) => {
              if (bytes >= 2048) {
                return;
              }
              const remaining =
                2048 - bytes;
              const slice =
                chunk.subarray(
                  0,
                  remaining
                );
              chunks.push(slice);
              bytes += slice.length;
            }
          );
          response.on(
            "end",
            () => {
              if (settled) return;
              settled = true;
              resolve({
                statusCode:
                  Number(
                    response.statusCode ||
                      0
                  ),
                bodyExcerpt:
                  Buffer.concat(
                    chunks
                  )
                    .toString("utf8")
                    .slice(0, 2048)
              });
            }
          );
        }
      );

      request.setTimeout(
        Math.min(
          Math.max(
            Number(timeoutMs) ||
              10000,
            1000
          ),
          30000
        ),
        () => {
          request.destroy(
            new Error(
              "webhook_timeout"
            )
          );
        }
      );

      request.on(
        "error",
        (error) => {
          if (settled) return;
          settled = true;
          reject(error);
        }
      );

      request.end(
        bodyBuffer
      );
    }
  );
}
