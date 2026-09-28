import crypto from "node:crypto";

const ISSUER = "rekixo-geolive";
const AUDIENCE = "geolive-ingest";
const PREFIX = "rgl_client_";

function base64urlJson(value) {
  return Buffer.from(
    JSON.stringify(value),
    "utf8"
  ).toString("base64url");
}

function decodeJson(value) {
  try {
    return JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    );
  } catch {
    return null;
  }
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function hmac(secret, value) {
  return crypto
    .createHmac("sha256", secret)
    .update(value)
    .digest("base64url");
}

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(String(value || ""));
}

export class ClientTokenService {
  constructor({
    signingKeys = [],
    now = () => Date.now()
  } = {}) {
    this.keys = new Map();
    this.current = null;
    this.now = now;

    for (const item of signingKeys) {
      const kid = String(item?.kid || "").trim();
      const secret = item?.secret;
      if (!kid || !Buffer.isBuffer(secret) || secret.length < 32) {
        throw new Error("Invalid GeoLive client-token signing key.");
      }
      if (this.keys.has(kid)) {
        throw new Error("Duplicate GeoLive client-token key id.");
      }
      const normalized = {
        kid,
        secret: Buffer.from(secret)
      };
      if (!this.current) this.current = normalized;
      this.keys.set(kid, normalized);
    }
  }

  get configured() {
    return Boolean(this.current);
  }

  issue({
    projectId,
    userId,
    issuerKeyId,
    ttlSeconds = 300,
    packageId = "",
    platform = "",
    attested = false,
    proofPublicKey = ""
  }) {
    if (!this.current) {
      const error = new Error("client_tokens_not_configured");
      error.code = "client_tokens_not_configured";
      error.status = 503;
      throw error;
    }
    if (!validUuid(projectId) || !validUuid(issuerKeyId)) {
      throw new Error("Invalid client-token project or issuer key.");
    }

    const subject = String(userId || "").trim();
    if (!subject || subject.length > 160) {
      throw new Error("Invalid client-token subject.");
    }

    const ttl = Math.min(
      Math.max(Number(ttlSeconds) || 300, 60),
      3600
    );
    const nowSeconds = Math.floor(this.now() / 1000);
    const header = {
      alg: "HS256",
      typ: "RGLT",
      kid: this.current.kid
    };
    const payload = {
      iss: ISSUER,
      aud: AUDIENCE,
      sub: subject,
      projectId,
      scope: "location:write",
      issuerKeyId,
      iat: nowSeconds,
      nbf: nowSeconds - 5,
      exp: nowSeconds + ttl,
      jti: crypto.randomUUID(),
      ...(packageId
        ? { packageId: String(packageId) }
        : {}),
      ...(platform
        ? { platform: String(platform) }
        : {}),
      attested: Boolean(attested),
      ...(proofPublicKey
        ? { proofPublicKey: String(proofPublicKey) }
        : {})
    };

    const encodedHeader = base64urlJson(header);
    const encodedPayload = base64urlJson(payload);
    const signingInput =
      `${encodedHeader}.${encodedPayload}`;
    const signature = hmac(
      this.current.secret,
      signingInput
    );

    return {
      token:
        `${PREFIX}${signingInput}.${signature}`,
      expiresAt:
        new Date(payload.exp * 1000).toISOString(),
      claims: payload
    };
  }

  verify(token, requiredScope = "location:write") {
    const raw = String(token || "");
    if (!raw.startsWith(PREFIX)) {
      return {
        ok: false,
        status: 401,
        error: "invalid_credential"
      };
    }

    const compact = raw.slice(PREFIX.length);
    const parts = compact.split(".");
    if (parts.length !== 3) {
      return {
        ok: false,
        status: 401,
        error: "invalid_client_token"
      };
    }

    const [encodedHeader, encodedPayload, signature] =
      parts;
    const header = decodeJson(encodedHeader);
    const payload = decodeJson(encodedPayload);

    if (
      !header ||
      header.alg !== "HS256" ||
      header.typ !== "RGLT" ||
      !payload
    ) {
      return {
        ok: false,
        status: 401,
        error: "invalid_client_token"
      };
    }

    const key = this.keys.get(String(header.kid || ""));
    if (!key) {
      return {
        ok: false,
        status: 401,
        error: "client_token_key_unavailable"
      };
    }

    const expected = hmac(
      key.secret,
      `${encodedHeader}.${encodedPayload}`
    );
    if (!safeEqual(signature, expected)) {
      return {
        ok: false,
        status: 401,
        error: "invalid_client_token"
      };
    }

    const nowSeconds = Math.floor(this.now() / 1000);
    if (
      payload.iss !== ISSUER ||
      payload.aud !== AUDIENCE ||
      payload.scope !== "location:write" ||
      !validUuid(payload.projectId) ||
      !validUuid(payload.issuerKeyId) ||
      !validUuid(payload.jti) ||
      typeof payload.sub !== "string" ||
      !payload.sub ||
      payload.sub.length > 160 ||
      !Number.isInteger(payload.iat) ||
      !Number.isInteger(payload.nbf) ||
      !Number.isInteger(payload.exp) ||
      payload.exp <= payload.iat ||
      payload.exp - payload.iat > 3600
    ) {
      return {
        ok: false,
        status: 401,
        error: "invalid_client_token"
      };
    }

    if (payload.nbf > nowSeconds + 30) {
      return {
        ok: false,
        status: 401,
        error: "client_token_not_yet_valid"
      };
    }
    if (payload.exp <= nowSeconds) {
      return {
        ok: false,
        status: 401,
        error: "client_token_expired"
      };
    }
    if (
      requiredScope &&
      requiredScope !== "location:write"
    ) {
      return {
        ok: false,
        status: 403,
        error: "insufficient_scope"
      };
    }

    return {
      ok: true,
      key: {
        id: `client:${payload.jti}`,
        kind: "client-token",
        clientToken: true,
        projectId: payload.projectId,
        issuerKeyId: payload.issuerKeyId,
        subject: payload.sub,
        jti: payload.jti,
        scopes: ["location:write"],
        allowedOrigins: [],
        allowedPackages: payload.packageId
          ? [payload.packageId]
          : [],
        packageId: payload.packageId || "",
        platform: payload.platform || "",
        attested: Boolean(payload.attested),
        proofPublicKey: payload.proofPublicKey || "",
        expiresAt: new Date(
          payload.exp * 1000
        ).toISOString()
      }
    };
  }
}

export const clientTokenConstants = {
  issuer: ISSUER,
  audience: AUDIENCE,
  prefix: PREFIX
};
