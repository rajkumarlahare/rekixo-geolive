import crypto from "node:crypto";

export function parseWebhookSigningKeys(
  rawValue
) {
  const raw = String(rawValue || "").trim();
  if (!raw) return [];

  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(
      "GEOLIVE_WEBHOOK_SIGNING_KEYS_JSON must be an array."
    );
  }

  const seen = new Set();
  return parsed.map((item) => {
    const kid = String(
      item?.kid || ""
    ).trim();
    const secretText = String(
      item?.secret || ""
    ).trim();

    if (
      !/^[A-Za-z0-9._-]{1,64}$/.test(
        kid
      ) ||
      seen.has(kid) ||
      !/^[A-Za-z0-9_-]+$/.test(
        secretText
      )
    ) {
      throw new Error(
        "Invalid GeoLive webhook signing key."
      );
    }
    seen.add(kid);

    const secret = Buffer.from(
      secretText,
      "base64url"
    );
    if (secret.length < 32) {
      throw new Error(
        "GeoLive webhook signing secrets must be at least 32 bytes."
      );
    }

    return {
      kid,
      secret
    };
  });
}

function keyById(keys, keyId) {
  const key = keys.find(
    (item) => item.kid === keyId
  );
  if (!key) {
    const error = new Error(
      "webhook_signing_key_unavailable"
    );
    error.code =
      "webhook_signing_key_unavailable";
    error.status = 503;
    throw error;
  }
  return key;
}

export function activeWebhookSigningKey(
  keys
) {
  if (!Array.isArray(keys) || !keys.length) {
    const error = new Error(
      "webhook_signing_unavailable"
    );
    error.code =
      "webhook_signing_unavailable";
    error.status = 503;
    throw error;
  }
  return keys[0];
}

export function deriveWebhookSecret({
  keys,
  keyId,
  projectId,
  endpointId,
  generation
}) {
  const key = keyById(keys, keyId);
  const digest = crypto
    .createHmac("sha256", key.secret)
    .update(
      [
        "rekixo-geolive-webhook",
        String(projectId),
        String(endpointId),
        String(generation)
      ].join(":")
    )
    .digest("base64url");

  return `rgl_whsec_${digest}`;
}

export function signWebhookPayload({
  secret,
  timestamp,
  body
}) {
  return crypto
    .createHmac(
      "sha256",
      Buffer.from(String(secret))
    )
    .update(
      `${timestamp}.${String(body)}`
    )
    .digest("hex");
}
