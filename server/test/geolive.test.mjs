import test from "node:test";
import assert from "node:assert/strict";
import { MemoryGeoLiveStore } from "../src/store-memory.mjs";
import { presenceStatus } from "../src/status.mjs";
import { loadConfig, sha256 } from "../src/config.mjs";
import { authenticate } from "../src/auth.mjs";

test("presence states follow configured thresholds", () => {
  const now = new Date("2026-09-28T00:00:00Z");
  assert.equal(presenceStatus("2026-09-27T23:59:30Z", now), "online");
  assert.equal(presenceStatus("2026-09-27T23:50:00Z", now), "recent");
  assert.equal(presenceStatus("2026-09-27T22:00:00Z", now), "offline");
  assert.equal(presenceStatus("2026-09-26T00:00:00Z", now), "inactive");
});

test("memory store isolates projects", async () => {
  const store = new MemoryGeoLiveStore();

  await store.upsertLocation("project-a", {
    userId: "same-user",
    latitude: 20,
    longitude: 80,
    receivedAt: new Date().toISOString()
  });
  await store.upsertLocation("project-b", {
    userId: "same-user",
    latitude: 30,
    longitude: 70,
    receivedAt: new Date().toISOString()
  });

  const a = await store.listUsers("project-a");
  const b = await store.listUsers("project-b");
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  assert.equal(a[0].latitude, 20);
  assert.equal(b[0].latitude, 30);
});

test("credential resolves project from the key", () => {
  const secret = "rgl_test_123";
  const key = {
    id: "k1",
    projectId: "locked-project",
    hash: sha256(secret),
    scopes: ["location:write"],
    allowedOrigins: []
  };
  const req = { headers: { authorization: `Bearer ${secret}` } };
  const auth = authenticate(req, [key], "location:write");
  assert.equal(auth.ok, true);
  assert.equal(auth.key.projectId, "locked-project");
});

test("production refuses to start without configured keys", () => {
  assert.throws(() => loadConfig({ NODE_ENV: "production" }), /GEOLIVE_KEYS_JSON/);
});


test("configured key origins are included in preflight allowlist", () => {
  const cfg = loadConfig({
    NODE_ENV: "production",
    GEOLIVE_PERSISTENCE: "postgres",
    DATABASE_URL: "postgresql://example.invalid/geolive",
    DATABASE_SSL: "disable",
    GEOLIVE_KEYS_JSON: JSON.stringify([{
      id: "k1",
      projectId: "p1",
      hash: "a".repeat(64),
      scopes: ["location:write"],
      allowedOrigins: ["https://app.example.com"]
    }])
  });
  assert.deepEqual(cfg.allowedOrigins, ["https://app.example.com"]);
});
