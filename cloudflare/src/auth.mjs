import { randomBytes, timingSafeEqual, createHash } from "node:crypto";

export function sha256Hex(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function randomSecret(prefix, bytes = 32) {
  return `${prefix}${randomBytes(bytes).toString("base64url")}`;
}

export function parseBearer(request) {
  const value = String(request.headers.get("authorization") || "");
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function csv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function originAllowed(origin, keyAllowed, globalAllowed) {
  if (!origin) return true;
  if (keyAllowed.length) return keyAllowed.includes(origin);
  if (globalAllowed.length) return globalAllowed.includes(origin);
  return false;
}

function safeHashEqual(a, b) {
  if (!/^[a-f0-9]{64}$/i.test(String(a)) || !/^[a-f0-9]{64}$/i.test(String(b))) {
    return false;
  }
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export async function authenticateIntegration(env, request, requiredScope) {
  const token = parseBearer(request);
  if (!token) return { ok: false, status: 401, error: "missing_key" };
  const hash = sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT
      k.id, k.project_id, k.name, k.prefix, k.secret_hash,
      k.scopes_json, k.allowed_origins_json, k.allowed_packages_json,
      k.expires_at, k.revoked_at,
      p.status AS project_status
     FROM api_keys k
     JOIN projects p ON p.id = k.project_id
     WHERE k.secret_hash = ?
     LIMIT 1`
  ).bind(hash).first();

  if (!row || !safeHashEqual(hash, row.secret_hash)) {
    return { ok: false, status: 401, error: "invalid_key" };
  }
  if (row.revoked_at) return { ok: false, status: 401, error: "revoked_key" };
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    return { ok: false, status: 401, error: "expired_key" };
  }
  if (row.project_status !== "active") {
    return { ok: false, status: 403, error: "project_not_active" };
  }

  const scopes = parseJsonArray(row.scopes_json);
  if (requiredScope && !scopes.includes(requiredScope) && !scopes.includes("*")) {
    return { ok: false, status: 403, error: "scope_denied" };
  }

  const allowedOrigins = parseJsonArray(row.allowed_origins_json);
  const globalOrigins = csv(env.GEOLIVE_ALLOWED_ORIGINS);
  const origin = String(request.headers.get("origin") || "").trim();
  if (!originAllowed(origin, allowedOrigins, globalOrigins)) {
    return {
      ok: false,
      status: 403,
      error: "origin_not_allowed",
      key: {
        id: row.id,
        projectId: row.project_id
      }
    };
  }

  const allowedPackages = parseJsonArray(row.allowed_packages_json);
  const packageId = String(request.headers.get("x-geolive-package") || "").trim();
  if (allowedPackages.length && !allowedPackages.includes(packageId)) {
    return { ok: false, status: 403, error: "package_not_allowed" };
  }

  return {
    ok: true,
    key: {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      prefix: row.prefix,
      scopes,
      allowedOrigins,
      allowedPackages
    },
    corsOrigin: origin || ""
  };
}

export function corsHeaders(request, auth) {
  const origin = String(request.headers.get("origin") || "").trim();
  if (!origin || auth?.corsOrigin !== origin) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers":
      "Authorization,Content-Type,X-GeoLive-Package,X-CSRF-Token",
    "access-control-max-age": "600",
    vary: "Origin"
  };
}
