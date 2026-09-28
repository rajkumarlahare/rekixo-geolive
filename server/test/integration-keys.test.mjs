import test from "node:test";
import assert from "node:assert/strict";
import {
  generateIntegrationKey,
  normalizeAllowedOrigins,
  normalizeAllowedPackages,
  parseIntegrationKeyPrefix,
  validateApiKeyScopes
} from "../src/integration-keys.mjs";

test("generated integration keys expose a lookup prefix but keep a long secret", () => {
  const generated = generateIntegrationKey();
  assert.match(generated.prefix, /^rgl_live_[a-f0-9]{12}$/);
  assert.equal(parseIntegrationKeyPrefix(generated.secret), generated.prefix);
  assert.ok(generated.secret.length > 60);
});

test("API key scopes are allowlisted, deduplicated and split by trust purpose", () => {
  assert.deepEqual(
    validateApiKeyScopes(["location:write", "location:write"]),
    ["location:write"]
  );
  assert.deepEqual(
    validateApiKeyScopes(["users:read", "summary:read", "events:read"]),
    ["users:read", "summary:read", "events:read"]
  );
  assert.throws(
    () => validateApiKeyScopes(["admin:write"]),
    /Unknown API key scope/
  );
  assert.throws(
    () => validateApiKeyScopes(["location:write", "users:read"]),
    /separate API keys/
  );

  assert.deepEqual(
    validateApiKeyScopes(["tokens:issue"]),
    ["tokens:issue"]
  );
  assert.throws(
    () => validateApiKeyScopes(["tokens:issue", "events:read"]),
    /separate API keys/
  );
});

test("origin and package restrictions normalize safely", () => {
  assert.deepEqual(
    normalizeAllowedOrigins([
      "https://app.example.com",
      "https://app.example.com/"
    ]),
    ["https://app.example.com"]
  );
  assert.deepEqual(
    normalizeAllowedPackages([
      "com.rekixo.app",
      "com.rekixo.app"
    ]),
    ["com.rekixo.app"]
  );
  assert.throws(
    () => normalizeAllowedOrigins(["javascript:alert(1)"]),
    /origin/
  );
});
