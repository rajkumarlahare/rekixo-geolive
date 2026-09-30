import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateIdempotencyKey } from "../../cloudflare/src/geo.mjs";

test("idempotency keys are optional but strictly bounded", () => {
  assert.equal(validateIdempotencyKey(null), "");
  assert.equal(
    validateIdempotencyKey("finworkar:fwl_0123456789abcdef"),
    "finworkar:fwl_0123456789abcdef"
  );
  for (const invalid of [
    "short",
    "contains space",
    "slash/not/allowed",
    "x".repeat(201)
  ]) {
    assert.throws(
      () => validateIdempotencyKey(invalid),
      (error) => error?.code === "invalid_idempotency_key"
    );
  }
});

test("Cloudflare ingest has durable replay, stale-order and privacy-delete guards", async () => {
  const [store, worker, migration, auth, admin, openapi] = await Promise.all([
    readFile("cloudflare/src/d1-store.mjs", "utf8"),
    readFile("cloudflare/src/index.mjs", "utf8"),
    readFile("cloudflare/migrations/0002_finworkar_bridge_safety.sql", "utf8"),
    readFile("cloudflare/src/auth.mjs", "utf8"),
    readFile("cloudflare/src/admin.mjs", "utf8"),
    readFile("openapi.yaml", "utf8")
  ]);

  assert.match(migration, /CREATE TABLE IF NOT EXISTS location_ingest_idempotency/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS user_privacy_tombstones/);
  assert.match(migration, /user_hash TEXT NOT NULL/);
  assert.doesNotMatch(
    migration.match(/CREATE TABLE IF NOT EXISTS user_privacy_tombstones[\s\S]*?\);/)?.[0] || "",
    /external_user_id/
  );
  assert.match(store, /privacyUserHash/);
  assert.match(store, /canonicalLocationRequestHash/);
  assert.match(store, /idempotency_key_reused/);
  assert.match(store, /COALESCE\(live_user_state\.captured_at,live_user_state\.received_at\)/);
  assert.match(store, /export async function deleteTrackedUser/);
  assert.match(store, /DELETE FROM geofence_events WHERE project_id=\? AND external_user_id=\?/);
  assert.match(store, /user_privacy_tombstones/);
  assert.match(worker, /idempotency-key/i);
  assert.match(worker, /privacy:delete/);
  assert.match(worker, /record\.liveUpdated !== false/);
  assert.match(auth, /Idempotency-Key/);
  assert.match(admin, /"privacy:delete"/);
  assert.match(openapi, /\/v1\/users\/\{userId\}:/);
  assert.match(openapi, /IdempotencyKeyHeader:/);
  assert.match(openapi, /privacy:delete/);
});

test("privacy keys cannot be mixed with operational scopes", async () => {
  const admin = await readFile("cloudflare/src/admin.mjs", "utf8");
  assert.match(
    admin,
    /scopes\.includes\("privacy:delete"\) && scopes\.length !== 1/
  );
  assert.match(admin, /mixed_key_scopes_not_allowed/);
});
