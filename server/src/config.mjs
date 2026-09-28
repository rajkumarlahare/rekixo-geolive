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

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
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
    allowedOrigins: Array.isArray(item.allowedOrigins) ? item.allowedOrigins.map(String) : [],
    allowedPackages: Array.isArray(item.allowedPackages) ? item.allowedPackages.map(String) : []
  };
}

export function loadConfig(env = process.env) {
  const isProduction = env.NODE_ENV === "production";
  const keys = [];

  // Transitional compatibility bridge for pre-P1C deployments.
  // New credentials must be created in Postgres through the P1C lifecycle.
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
        allowedOrigins: csv(env.GEOLIVE_ALLOWED_ORIGINS),
        allowedPackages: []
      }));
    }
    if (env.GEOLIVE_DEV_ADMIN_KEY) {
      keys.push(normalizeKey({
        id: "dev-read",
        projectId,
        hash: sha256(env.GEOLIVE_DEV_ADMIN_KEY),
        scopes: ["users:read", "summary:read", "events:read"],
        allowedOrigins: csv(env.GEOLIVE_ALLOWED_ORIGINS),
        allowedPackages: []
      }));
    }
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
  if (isProduction && persistence !== "postgres") {
    throw new Error("Production requires GEOLIVE_PERSISTENCE=postgres.");
  }

  return {
    port: boundedNumber(env.PORT, 8787, 1, 65535),
    isProduction,
    allowedOrigins,
    keys,
    persistence,
    database: {
      url: env.DATABASE_URL || "",
      sslMode: env.DATABASE_SSL || (isProduction ? "verify-full" : "disable"),
      maxPoolSize: boundedNumber(env.DATABASE_POOL_MAX, 10, 1, 50)
    },
    admin: {
      sessionHours: boundedNumber(env.GEOLIVE_ADMIN_SESSION_HOURS, 12, 1, 168),
      maxFailedLogins: boundedNumber(env.GEOLIVE_ADMIN_MAX_FAILED_LOGINS, 5, 3, 20),
      lockMinutes: boundedNumber(env.GEOLIVE_ADMIN_LOCK_MINUTES, 15, 1, 1440)
    },
    thresholds: {
      onlineSeconds: boundedNumber(env.GEOLIVE_ONLINE_SECONDS, 120, 10, 3600),
      recentSeconds: boundedNumber(env.GEOLIVE_RECENT_SECONDS, 900, 60, 86400),
      inactiveSeconds: boundedNumber(env.GEOLIVE_INACTIVE_SECONDS, 86400, 3600, 2592000)
    }
  };
}
