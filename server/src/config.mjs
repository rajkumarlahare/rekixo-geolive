import crypto from "node:crypto";
import {
  parseWebhookSigningKeys
} from "./webhook-secrets.mjs";

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

function parseClientTokenKeys(env, isProduction) {
  const raw = String(
    env.GEOLIVE_CLIENT_TOKEN_KEYS_JSON || ""
  ).trim();
  let source = [];

  if (raw) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error(
        "GEOLIVE_CLIENT_TOKEN_KEYS_JSON must be an array."
      );
    }
    source = parsed;
  } else if (
    !isProduction &&
    env.GEOLIVE_DEV_CLIENT_TOKEN_SECRET
  ) {
    source = [{
      kid: "dev",
      secret:
        env.GEOLIVE_DEV_CLIENT_TOKEN_SECRET
    }];
  }

  return source.map((item) => {
    const kid = String(item?.kid || "").trim();
    const secretText =
      String(item?.secret || "").trim();

    if (
      !/^[A-Za-z0-9._-]{1,64}$/.test(kid) ||
      !/^[A-Za-z0-9_-]+$/.test(secretText)
    ) {
      throw new Error(
        "Invalid GeoLive client-token signing key."
      );
    }

    const secret = Buffer.from(
      secretText,
      "base64url"
    );
    if (secret.length < 32) {
      throw new Error(
        "GeoLive client-token signing secrets must be at least 32 bytes."
      );
    }

    return { kid, secret };
  });
}

function parsePlayIntegrityApps(env) {
  const raw = String(
    env.GEOLIVE_PLAY_INTEGRITY_APPS_JSON || ""
  ).trim();
  if (!raw) return [];

  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(
      "GEOLIVE_PLAY_INTEGRITY_APPS_JSON must be an array."
    );
  }

  const seen = new Set();
  return parsed.map((item) => {
    const packageName = String(
      item?.packageName || ""
    ).trim();
    if (
      !packageName ||
      packageName.length > 200 ||
      !/^[A-Za-z0-9_.-]+$/.test(packageName) ||
      seen.has(packageName)
    ) {
      throw new Error(
        "Invalid or duplicate Play Integrity package."
      );
    }
    seen.add(packageName);

    const serviceAccount =
      item?.serviceAccount;
    if (
      !serviceAccount ||
      typeof serviceAccount !== "object" ||
      !serviceAccount.client_email ||
      !serviceAccount.private_key
    ) {
      throw new Error(
        `Play Integrity app ${packageName} requires a service account.`
      );
    }

    const requiredDeviceVerdicts =
      Array.isArray(item.requiredDeviceVerdicts)
        ? [...new Set(
            item.requiredDeviceVerdicts
              .map(String)
              .filter(Boolean)
          )]
        : ["MEETS_DEVICE_INTEGRITY"];

    return {
      packageName,
      cloudProjectNumber:
        item.cloudProjectNumber
          ? String(item.cloudProjectNumber)
          : "",
      serviceAccount: {
        client_email:
          String(serviceAccount.client_email),
        private_key:
          String(serviceAccount.private_key)
      },
      requiredAppVerdict:
        String(
          item.requiredAppVerdict ||
          "PLAY_RECOGNIZED"
        ),
      requiredDeviceVerdicts,
      requireLicensed:
        Boolean(item.requireLicensed),
      maxVerdictAgeSeconds:
        boundedNumber(
          item.maxVerdictAgeSeconds,
          120,
          30,
          600
        )
    };
  });
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
        scopes: ["users:read", "history:read", "summary:read", "events:read"],
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

  const clientTokenSigningKeys =
    parseClientTokenKeys(env, isProduction);
  const playIntegrityApps =
    parsePlayIntegrityApps(env);
  const webhookSigningKeys =
    parseWebhookSigningKeys(
      env.GEOLIVE_WEBHOOK_SIGNING_KEYS_JSON
    );

  return {
    port: boundedNumber(env.PORT, 8787, 1, 65535),
    isProduction,
    allowedOrigins,
    keys,
    persistence,
    public: {
      googleMapsApiKey: String(
        env.GEOLIVE_GOOGLE_MAPS_API_KEY ||
        env.GOOGLE_MAPS_API_KEY ||
        ""
      ).trim()
    },
    database: {
      url: env.DATABASE_URL || "",
      sslMode: env.DATABASE_SSL || (isProduction ? "verify-full" : "disable"),
      maxPoolSize: boundedNumber(env.DATABASE_POOL_MAX, 10, 1, 50)
    },
    admin: {
      sessionHours: boundedNumber(env.GEOLIVE_ADMIN_SESSION_HOURS, 12, 1, 168),
      maxFailedLogins: boundedNumber(env.GEOLIVE_ADMIN_MAX_FAILED_LOGINS, 5, 3, 20),
      lockMinutes: boundedNumber(env.GEOLIVE_ADMIN_LOCK_MINUTES, 15, 1, 1440),
      trustProxy:
        String(env.GEOLIVE_TRUST_PROXY || "").toLowerCase() === "true"
    },
    clientTokens: {
      required:
        String(
          env.GEOLIVE_CLIENT_TOKENS_REQUIRED || ""
        ).toLowerCase() === "true",
      signingKeys: clientTokenSigningKeys,
      playIntegrityApps
    },
    webhooks: {
      signingKeys:
        webhookSigningKeys,
      timeoutMs: boundedNumber(
        env.GEOLIVE_WEBHOOK_TIMEOUT_MS,
        10000,
        1000,
        30000
      ),
      maxAttempts: boundedNumber(
        env.GEOLIVE_WEBHOOK_MAX_ATTEMPTS,
        8,
        1,
        20
      ),
      batchSize: boundedNumber(
        env.GEOLIVE_WEBHOOK_BATCH_SIZE,
        25,
        1,
        100
      ),
      deliveryPollMs: boundedNumber(
        env.GEOLIVE_WEBHOOK_DELIVERY_POLL_MS,
        5000,
        1000,
        60000
      ),
      dwellPollMs: boundedNumber(
        env.GEOLIVE_DWELL_POLL_MS,
        15000,
        5000,
        60000
      )
    },
    realtime: {
      redisUrl: String(env.GEOLIVE_REDIS_URL || "").trim(),
      redisChannel: String(
        env.GEOLIVE_REDIS_CHANNEL || "rekixo:geolive:events"
      ).trim(),
      redisRequired:
        String(env.GEOLIVE_REDIS_REQUIRED || "").toLowerCase() === "true",
      maxReplayEvents: boundedNumber(
        env.GEOLIVE_REALTIME_MAX_REPLAY_EVENTS,
        1000,
        100,
        5000
      ),
      authTimeoutMs: boundedNumber(
        env.GEOLIVE_REALTIME_AUTH_TIMEOUT_MS,
        5000,
        1000,
        30000
      ),
      heartbeatIntervalMs: boundedNumber(
        env.GEOLIVE_REALTIME_HEARTBEAT_INTERVAL_MS,
        25000,
        5000,
        60000
      ),
      heartbeatTimeoutMs: boundedNumber(
        env.GEOLIVE_REALTIME_HEARTBEAT_TIMEOUT_MS,
        70000,
        15000,
        180000
      )
    },
    thresholds: {
      onlineSeconds: boundedNumber(env.GEOLIVE_ONLINE_SECONDS, 120, 10, 3600),
      recentSeconds: boundedNumber(env.GEOLIVE_RECENT_SECONDS, 900, 60, 86400),
      inactiveSeconds: boundedNumber(env.GEOLIVE_INACTIVE_SECONDS, 86400, 3600, 2592000)
    }
  };
}
