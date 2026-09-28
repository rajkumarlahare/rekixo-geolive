import crypto from "node:crypto";

export const API_KEY_SCOPES = Object.freeze([
  "location:write",
  "users:read",
  "summary:read",
  "events:read",
  "tokens:issue"
]);

const SCOPE_SET = new Set(API_KEY_SCOPES);

export function generateIntegrationKey() {
  const prefix = `rgl_live_${crypto.randomBytes(6).toString("hex")}`;
  const secretPart = crypto.randomBytes(32).toString("base64url");
  return {
    prefix,
    secret: `${prefix}_${secretPart}`
  };
}

export function parseIntegrationKeyPrefix(value) {
  const match = String(value || "").match(/^(rgl_live_[a-f0-9]{12})_[A-Za-z0-9_-]{40,}$/);
  return match ? match[1] : "";
}

export function hashIntegrationKey(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

export function validateApiKeyScopes(scopes) {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw Object.assign(new Error("At least one API key scope is required."), {
      code: "invalid_key_scopes",
      status: 400
    });
  }

  const normalized = [...new Set(scopes.map(String))];
  if (normalized.some((scope) => !SCOPE_SET.has(scope))) {
    throw Object.assign(new Error("Unknown API key scope."), {
      code: "invalid_key_scopes",
      status: 400
    });
  }

  const hasWrite =
    normalized.includes("location:write");
  const hasRead =
    normalized.some(
      (scope) => scope.endsWith(":read")
    );
  const hasIssuer =
    normalized.includes("tokens:issue");

  if (
    (hasWrite && hasRead) ||
    (hasIssuer && normalized.length !== 1)
  ) {
    throw Object.assign(
      new Error(
        "Use separate API keys for ingest, read and client-token issuer purposes."
      ),
      {
        code: "mixed_key_scopes_not_allowed",
        status: 400
      }
    );
  }

  return normalized;
}

export function normalizeAllowedOrigins(values) {
  if (values == null) return [];
  if (!Array.isArray(values) || values.length > 50) {
    throw Object.assign(new Error("Invalid allowed origins."), {
      code: "invalid_allowed_origins",
      status: 400
    });
  }

  const normalized = [];
  for (const raw of values) {
    const value = String(raw || "").trim();
    if (!value) continue;

    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw Object.assign(new Error("Invalid allowed origin."), {
        code: "invalid_allowed_origins",
        status: 400
      });
    }

    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.origin !== value.replace(/\/$/, "")
    ) {
      throw Object.assign(
        new Error("Allowed origins must be origin-only http/https URLs."),
        {
          code: "invalid_allowed_origins",
          status: 400
        }
      );
    }
    normalized.push(parsed.origin);
  }
  return [...new Set(normalized)];
}

export function normalizeAllowedPackages(values) {
  if (values == null) return [];
  if (!Array.isArray(values) || values.length > 50) {
    throw Object.assign(new Error("Invalid allowed packages."), {
      code: "invalid_allowed_packages",
      status: 400
    });
  }

  const normalized = [];
  for (const raw of values) {
    const value = String(raw || "").trim();
    if (!value) continue;
    if (
      value.length > 200 ||
      !/^[A-Za-z0-9_.-]+$/.test(value)
    ) {
      throw Object.assign(new Error("Invalid package identifier."), {
        code: "invalid_allowed_packages",
        status: 400
      });
    }
    normalized.push(value);
  }
  return [...new Set(normalized)];
}

export function normalizeExpiry(value, { allowPast = false } = {}) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw Object.assign(new Error("Invalid key expiry."), {
      code: "invalid_key_expiry",
      status: 400
    });
  }
  if (!allowPast && date.getTime() <= Date.now()) {
    throw Object.assign(
      new Error("Key expiry must be in the future."),
      {
        code: "invalid_key_expiry",
        status: 400
      }
    );
  }

  const max = Date.now() + 2 * 365 * 24 * 60 * 60 * 1000;
  if (!allowPast && date.getTime() > max) {
    throw Object.assign(
      new Error("Key expiry is too far in the future."),
      {
        code: "invalid_key_expiry",
        status: 400
      }
    );
  }
  return date.toISOString();
}

export function safeKeyName(value, fallback = "API key") {
  const name = String(value ?? fallback).trim();
  if (name.length < 2 || name.length > 80) {
    throw Object.assign(
      new Error("API key name must be 2-80 characters."),
      {
        code: "invalid_key_name",
        status: 400
      }
    );
  }
  return name;
}
