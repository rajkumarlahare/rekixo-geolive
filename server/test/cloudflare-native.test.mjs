import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  decodeCursor,
  encodeCursor,
  geofenceContains,
  haversineMeters,
  pointInPolygon,
  presenceStatus
} from "../../cloudflare/src/geo.mjs";

test("Cloudflare geospatial helpers preserve core GeoLive behavior", () => {
  assert.ok(
    haversineMeters(
      21.203,
      81.634,
      21.204,
      81.634
    ) > 100
  );

  const polygon = [
    [81.62, 21.19],
    [81.65, 21.19],
    [81.65, 21.22],
    [81.62, 21.22],
    [81.62, 21.19]
  ];
  assert.equal(
    pointInPolygon(
      21.203,
      81.634,
      polygon
    ),
    true
  );
  assert.equal(
    geofenceContains(
      {
        shape_type: "circle",
        center_lat: 21.203,
        center_lng: 81.634,
        radius_m: 500
      },
      21.204,
      81.634
    ),
    true
  );

  const now =
    new Date(
      "2026-09-29T10:00:00Z"
    );
  assert.equal(
    presenceStatus(
      "2026-09-29T09:59:30Z",
      now.getTime()
    ),
    "online"
  );
  assert.equal(
    presenceStatus(
      "2026-09-29T09:50:00Z",
      now.getTime()
    ),
    "recent"
  );

  const cursor = encodeCursor({
    receivedAt:
      "2026-09-29T09:59:30Z",
    userId: "user-1"
  });
  assert.deepEqual(
    decodeCursor(cursor),
    {
      receivedAt:
        "2026-09-29T09:59:30Z",
      userId: "user-1"
    }
  );
});

test("Cloudflare production contract uses D1, Durable Objects, Queues and static assets", async () => {
  const [
    configText,
    migration,
    worker,
    realtime,
    webhooks,
    admin,
    packageJson
  ] = await Promise.all([
    readFile(
      "cloudflare/wrangler.jsonc",
      "utf8"
    ),
    readFile(
      "cloudflare/migrations/0001_core.sql",
      "utf8"
    ),
    readFile(
      "cloudflare/src/index.mjs",
      "utf8"
    ),
    readFile(
      "cloudflare/src/realtime-room.mjs",
      "utf8"
    ),
    readFile(
      "cloudflare/src/webhooks.mjs",
      "utf8"
    ),
    readFile(
      "cloudflare/src/admin.mjs",
      "utf8"
    ),
    readFile("package.json", "utf8")
  ]);

  const config = JSON.parse(configText);
  assert.equal(
    config.name,
    "rekixo-geolive"
  );
  assert.equal(
    config.d1_databases?.[0]
      ?.binding,
    "DB"
  );
  assert.equal(
    config.durable_objects
      ?.bindings?.[0]?.name,
    "REALTIME"
  );
  assert.equal(
    config.queues?.producers?.[0]
      ?.binding,
    "WEBHOOK_QUEUE"
  );
  assert.equal(
    config.assets?.binding,
    "ASSETS"
  );
  assert.deepEqual(
    config.triggers?.crons,
    ["* * * * *"]
  );

  for (const table of [
    "accounts",
    "projects",
    "api_keys",
    "users",
    "live_user_state",
    "location_history",
    "realtime_events",
    "geofences",
    "geofence_events",
    "webhook_endpoints",
    "webhook_deliveries",
    "security_events",
    "rate_limit_windows"
  ]) {
    assert.match(
      migration,
      new RegExp(
        `CREATE TABLE IF NOT EXISTS ${table}\\s*\\(`
      )
    );
  }

  assert.doesNotMatch(
    migration,
    /PostGIS|geography\(|geometry\(|ST_DWithin|ST_Covers/i
  );
  assert.match(
    worker,
    /runtime:"cloudflare-workers"/
  );
  assert.match(
    worker,
    /enforceProjectRate/
  );
  assert.match(
    realtime,
    /setWebSocketAutoResponse/
  );
  assert.match(
    realtime,
    /serializeAttachment/
  );
  assert.match(
    webhooks,
    /GEOLIVE_WEBHOOK_SIGNING_SECRET/
  );
  assert.match(
    webhooks,
    /message\.retry/
  );
  assert.match(
    admin,
    /handleAutomationAdmin/
  );

  const pkg =
    JSON.parse(packageJson);
  assert.equal(
    pkg.version,
    "0.17.0"
  );
  assert.ok(
    pkg.scripts[
      "build:cloudflare"
    ]
  );
  assert.ok(
    pkg.scripts[
      "cloudflare:deploy"
    ]
  );
});

test("Cloudflare production config never stores deployment secrets", async () => {
  const config = await readFile(
    "cloudflare/wrangler.jsonc",
    "utf8"
  );

  for (const secretName of [
    "GEOLIVE_BOOTSTRAP_TOKEN",
    "GEOLIVE_WEBHOOK_SIGNING_SECRET",
    "GEOLIVE_GOOGLE_MAPS_API_KEY"
  ]) {
    assert.equal(
      config.includes(secretName),
      false,
      `${secretName} must be set with Worker secrets, not committed vars`
    );
  }
});
