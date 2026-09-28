import pg from "pg";

const { Pool } = pg;

export function sslForMode(mode = "verify-full") {
  const normalized = String(mode).toLowerCase();
  if (normalized === "disable") return false;
  if (normalized === "require") return { rejectUnauthorized: false };
  if (normalized === "verify-full") return { rejectUnauthorized: true };
  throw new Error("DATABASE_SSL must be disable, require or verify-full.");
}

export function createPgPool({ url, sslMode = "verify-full", maxPoolSize = 10 } = {}) {
  if (!url) throw new Error("DATABASE_URL is required.");
  return new Pool({
    connectionString: url,
    ssl: sslForMode(sslMode),
    max: maxPoolSize,
    application_name: "rekixo-geolive",
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000
  });
}

export function createPgPoolFromEnv(env = process.env) {
  return createPgPool({
    url: env.DATABASE_URL,
    sslMode: env.DATABASE_SSL || (env.NODE_ENV === "production" ? "verify-full" : "disable"),
    maxPoolSize: Math.min(Math.max(Number(env.DATABASE_POOL_MAX || 10), 1), 50)
  });
}
