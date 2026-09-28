import crypto from "node:crypto";

export function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function csv(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeKey(item) {
  if (!item || typeof item !== "object") throw new Error("Invalid GeoLive key entry.");
  const scopes = Array.isArray(item.scopes) ? item.scopes.map(String) : [];
  if (!item.id || !item.projectId || !item.hash || scopes.length === 0) {
    throw new Error("Each GeoLive key needs id, projectId, hash and scopes.");
  }
  return {
    id: String(item.id),
    projectId: String(item.projectId),
    hash: String(item.hash).toLowerCase(),
    scopes,
    allowedOrigins: Array.isArray(item.allowedOrigins) ? item.allowedOrigins.map(String) : []
  };
}

export function loadConfig(env = process.env) {
  const isProduction = env.NODE_ENV === "production";
  const keys = [];

  if (env.GEOLIVE_KEYS_JSON?.trim()) {
    const parsed = JSON.parse(env.GEOLIVE_KEYS_JSON);
    if (!Array.isArray(parsed)) throw new Error("GEOLIVE_KEYS_JSON must be an array.");
    keys.push(...parsed.map(normalizeKey));
  }

  if (!isProduction) {
    const projectId = env.GEOLIVE_DEV_PROJECT_ID || "demo-project";
    if (env.GEOLIVE_DEV_INGEST_KEY) {
      keys.push(normalizeKey({
        id: "dev-ingest",
        projectId,
        hash: sha256(env.GEOLIVE_DEV_INGEST_KEY),
        scopes: ["location:write"],
        allowedOrigins: csv(env.GEOLIVE_ALLOWED_ORIGINS)
      }));
    }
    if (env.GEOLIVE_DEV_ADMIN_KEY) {
      keys.push(normalizeKey({
        id: "dev-admin",
        projectId,
        hash: sha256(env.GEOLIVE_DEV_ADMIN_KEY),
        scopes: ["users:read", "summary:read", "events:read"],
        allowedOrigins: csv(env.GEOLIVE_ALLOWED_ORIGINS)
      }));
    }
  }

  if (isProduction && keys.length === 0) {
    throw new Error("Production requires GEOLIVE_KEYS_JSON.");
  }

  const allowedOrigins = [...new Set([
    ...csv(env.GEOLIVE_ALLOWED_ORIGINS),
    ...keys.flatMap((key) => key.allowedOrigins)
  ])];

  const persistence = String(
    env.GEOLIVE_PERSISTENCE || (env.DATABASE_URL ? "postgres" : "memory")
  ).toLowerCase();

  if (!["memory", "postgres"].includes(persistence)) {
    throw new Error("GEOLIVE_PERSISTENCE must be memory or postgres.");
  }
  if (persistence === "postgres" && !env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for postgres persistence.");
  }

  return {
    port: Number(env.PORT || 8787),
    isProduction,
    allowedOrigins,
    keys,
    persistence,
    database: {
      url: env.DATABASE_URL || "",
      sslMode: env.DATABASE_SSL || (isProduction ? "verify-full" : "disable"),
      maxPoolSize: Math.min(Math.max(Number(env.DATABASE_POOL_MAX || 10), 1), 50)
    },
    thresholds: {
      onlineSeconds: Number(env.GEOLIVE_ONLINE_SECONDS || 120),
      recentSeconds: Number(env.GEOLIVE_RECENT_SECONDS || 900),
      inactiveSeconds: Number(env.GEOLIVE_INACTIVE_SECONDS || 86400)
    }
  };
}
