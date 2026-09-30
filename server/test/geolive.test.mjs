import test from "node:test";
import assert from "node:assert/strict";
import { MemoryGeoLiveStore } from "../src/store-memory.mjs";
import { presenceStatus } from "../src/status.mjs";
import { loadConfig, sha256 } from "../src/config.mjs";
import {
  authenticate,
  originAllowed,
  packageAllowed
} from "../src/auth.mjs";
import {
  createGeoLiveServer
} from "../src/server.mjs";

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

test("development credential resolves project from the key", () => {
  const secret = "rgl_test_123";
  const key = {
    id: "k1",
    projectId: "locked-project",
    hash: sha256(secret),
    scopes: ["location:write"],
    allowedOrigins: [],
    allowedPackages: []
  };
  const req = { headers: { authorization: `Bearer ${secret}` } };
  const auth = authenticate(req, [key], "location:write");
  assert.equal(auth.ok, true);
  assert.equal(auth.key.projectId, "locked-project");
});

test("production requires Postgres but no longer requires environment API keys", () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: "production" }),
    /GEOLIVE_PERSISTENCE=postgres/
  );

  const cfg = loadConfig({
    NODE_ENV: "production",
    GEOLIVE_PERSISTENCE: "postgres",
    DATABASE_URL: "postgresql://example.invalid/geolive",
    DATABASE_SSL: "disable"
  });
  assert.equal(cfg.persistence, "postgres");
  assert.equal(cfg.keys.length, 0);
});

test("legacy environment keys remain readable during P1C migration", () => {
  const cfg = loadConfig({
    NODE_ENV: "production",
    GEOLIVE_PERSISTENCE: "postgres",
    DATABASE_URL: "postgresql://example.invalid/geolive",
    DATABASE_SSL: "disable",
    GEOLIVE_KEYS_JSON: JSON.stringify([{
      id: "legacy",
      projectId: "p1",
      hash: "a".repeat(64),
      scopes: ["location:write"],
      allowedOrigins: ["https://app.example.com"]
    }])
  });
  assert.equal(cfg.keys.length, 1);
  assert.deepEqual(cfg.allowedOrigins, ["https://app.example.com"]);
});

test("per-key origin and package restrictions are exact", () => {
  const key = {
    allowedOrigins: ["https://app.example.com"],
    allowedPackages: ["com.rekixo.app"]
  };
  assert.equal(originAllowed("https://app.example.com", key, []), true);
  assert.equal(originAllowed("https://evil.example.com", key, []), false);
  assert.equal(packageAllowed("com.rekixo.app", key), true);
  assert.equal(packageAllowed("com.other.app", key), false);
  assert.equal(packageAllowed("", key), false);
});

test("proxy trust is opt-in", () => {
  const off = loadConfig({
    NODE_ENV: "test",
    GEOLIVE_PERSISTENCE: "memory",
    GEOLIVE_TRUST_PROXY: "false"
  });
  const on = loadConfig({
    NODE_ENV: "test",
    GEOLIVE_PERSISTENCE: "memory",
    GEOLIVE_TRUST_PROXY: "true"
  });
  assert.equal(off.admin.trustProxy, false);
  assert.equal(on.admin.trustProxy, true);
});

test("public readiness response does not expose sensitive deployment metadata", async () => {
  const config = loadConfig({
    NODE_ENV: "test",
    GEOLIVE_PERSISTENCE: "memory"
  });
  const server = createGeoLiveServer({
    config,
    store: new MemoryGeoLiveStore()
  });

  await new Promise((resolve) => {
    server.listen(
      0,
      "127.0.0.1",
      resolve
    );
  });

  try {
    const address = server.address();
    const response = await fetch(
      `http://127.0.0.1:${address.port}/ready`
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload, {
      ready: true,
      service: "rekixo-geolive",
      version: "0.17.0",
      persistence: "memory"
    });
    assert.equal(
      "environmentCredentialCount" in payload,
      false
    );
    assert.equal(
      "playIntegrityConfiguredPackages" in payload,
      false
    );
    assert.equal(
      "realtime" in payload,
      false
    );
  } finally {
    await new Promise((resolve) =>
      server.close(resolve)
    );
  }
});

test("P4C serves Google-only globe modules and no legacy Earth texture", async () => {
  const config = loadConfig({
    NODE_ENV: "test",
    GEOLIVE_PERSISTENCE: "memory",
    GEOLIVE_GOOGLE_MAPS_API_KEY: "test-browser-key"
  });
  const server = createGeoLiveServer({
    config,
    store: new MemoryGeoLiveStore()
  });

  await new Promise((resolve) => {
    server.listen(
      0,
      "127.0.0.1",
      resolve
    );
  });

  try {
    const address = server.address();
    const base =
      `http://127.0.0.1:${address.port}`;

    const runtimeConfigResponse =
      await fetch(
        `${base}/dashboard/runtime-config.js`
      );
    assert.equal(
      runtimeConfigResponse.status,
      200
    );
    assert.equal(
      runtimeConfigResponse.headers.get(
        "cache-control"
      ),
      "no-store"
    );
    assert.equal(
      runtimeConfigResponse.headers.get(
        "referrer-policy"
      ),
      "strict-origin-when-cross-origin"
    );
    assert.match(
      runtimeConfigResponse.headers.get(
        "content-security-policy"
      ) || "",
      /tile\.googleapis\.com/
    );
    const runtimeConfig =
      await runtimeConfigResponse.text();
    assert.match(
      runtimeConfig,
      /test-browser-key/
    );

    const moduleResponse =
      await fetch(
        `${base}/dashboard/globe-webgl.js`
      );
    assert.equal(
      moduleResponse.status,
      200
    );
    assert.match(
      moduleResponse.headers.get(
        "content-type"
      ) || "",
      /^text\/javascript/
    );
    assert.match(
      await moduleResponse.text(),
      /GeoGlobeRenderer/
    );

    const editorResponse =
      await fetch(
        `${base}/dashboard/geofence-editor.js`
      );
    assert.equal(
      editorResponse.status,
      200
    );
    assert.match(
      editorResponse.headers.get(
        "content-type"
      ) || "",
      /^text\/javascript/
    );
    assert.match(
      await editorResponse.text(),
      /screenToGeo/
    );

    const textureResponse =
      await fetch(
        `${base}/dashboard/earth-dark.svg`
      );
    assert.equal(
      textureResponse.status,
      404
    );

    // The synthetic Earth texture must stay removed; Google Photorealistic
    // 3D is the only globe renderer now.
  } finally {
    await new Promise((resolve) =>
      server.close(resolve)
    );
  }
});

