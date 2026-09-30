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
    "rekixo-geolive-prod"
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
  assert.equal(
    config.vars?.GEOLIVE_CANONICAL_ORIGIN,
    "https://geolive.rekixo.com"
  );
  assert.equal(
    config.vars?.GEOLIVE_ALLOWED_ORIGINS,
    "https://geolive.rekixo.com"
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
    worker,
    /GEOLIVE_CANONICAL_ORIGIN/
  );
  assert.match(
    worker,
    /"referrer-policy": "no-referrer"/
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

test("Photorealistic Earth uses an authenticated same-origin Google Tiles proxy in production", async () => {
  const [renderer, globe, app, worker, admin] =
    await Promise.all([
      readFile(
        "dashboard/photorealistic-earth.js",
        "utf8"
      ),
      readFile(
        "dashboard/globe-webgl.js",
        "utf8"
      ),
      readFile(
        "dashboard/app.js",
        "utf8"
      ),
      readFile(
        "cloudflare/src/index.mjs",
        "utf8"
      ),
      readFile(
        "cloudflare/src/admin.mjs",
        "utf8"
      )
    ]);

  assert.match(
    renderer,
    /tilesRootUrl/
  );
  assert.match(
    renderer,
    /google_tiles_proxy_auth/
  );
  assert.match(
    renderer,
    /RETRY_DELAYS_MS/
  );
  assert.match(
    globe,
    /ensurePhotorealistic/
  );
  assert.match(
    app,
    /googleTilesRootUrl/
  );
  assert.match(
    app,
    /ensurePhotorealistic/
  );
  assert.match(
    worker,
    /handleGoogle3dTiles/
  );
  assert.match(
    worker,
    /"\/v1\/3dtiles\/root\.json"/
  );
  assert.match(
    worker,
    /https:\/\/tile\.googleapis\.com/
  );
  assert.match(
    worker,
    /googleTilesRootUrl/
  );
  assert.doesNotMatch(
    worker,
    /googleMapsApiKey:/
  );
  assert.match(
    admin,
    /touch = true/
  );
  assert.match(
    worker,
    /touch: false/
  );
});

test("GeoLive eye branding is code-drawn across header, profile and favicon", async () => {
  const [
    html,
    css,
    favicon,
    cloudflareBuild,
    demoBuild
  ] = await Promise.all([
    readFile("dashboard/index.html", "utf8"),
    readFile("dashboard/styles.css", "utf8"),
    readFile("dashboard/geolive-favicon.svg", "utf8"),
    readFile("scripts/build-cloudflare-production.mjs", "utf8"),
    readFile("scripts/build-public-demo.mjs", "utf8")
  ]);

  assert.match(
    html,
    /<symbol id="geolive-eye-mark" viewBox="0 0 120 74">/
  );
  assert.equal(
    (html.match(/href="#geolive-eye-mark"/g) || []).length,
    3
  );
  assert.match(
    html,
    /href="\.\/geolive-favicon\.svg"/
  );
  assert.match(
    html,
    /class="geolive-mark profile-eye-mark"/
  );
  assert.match(
    css,
    /\.brand-icon \.geolive-mark\{width:34px;height:22px\}/
  );
  assert.match(
    css,
    /\.auth-logo \.geolive-mark\{width:52px;height:32px\}/
  );
  assert.match(
    css,
    /\.profile-icon \.profile-eye-mark\{width:38px;height:24px\}/
  );
  assert.match(
    favicon,
    /<svg[^>]+viewBox="0 0 120 74"/
  );
  assert.match(
    favicon,
    /stroke="#12eee7"/
  );
  assert.match(
    cloudflareBuild,
    /"geolive-favicon\.svg"/
  );
  assert.match(
    demoBuild,
    /"geolive-favicon\.svg"/
  );

  const brandedMarkup =
    [
      html.match(/<div class="brand">[\s\S]*?<\/div>/)?.[0] || "",
      html.match(/<div class="profile-icon"[\s\S]*?<\/div>/)?.[0] || "",
      html.match(/<div class="auth-logo"[\s\S]*?<\/div>/)?.[0] || ""
    ].join("\n");
  assert.doesNotMatch(
    brandedMarkup,
    /<img\b|\.png|\.jpe?g|\.webp/i
  );
});

test("Photorealistic globe drag sensitivity decreases with deep zoom", async () => {
  const [renderer, globe, app] =
    await Promise.all([
      readFile(
        "dashboard/photorealistic-earth.js",
        "utf8"
      ),
      readFile(
        "dashboard/globe-webgl.js",
        "utf8"
      ),
      readFile(
        "dashboard/app.js",
        "utf8"
      )
    ]);

  assert.match(
    renderer,
    /dragSensitivity\(/
  );
  assert.match(
    renderer,
    /cameraHeightForZoom/
  );
  assert.match(
    renderer,
    /groundMetersPerPixel/
  );
  assert.match(
    renderer,
    /0\.000015/
  );
  assert.match(
    globe,
    /dragSensitivity\(/
  );
  assert.match(
    app,
    /globeRenderer\s*\.dragSensitivity/
  );
  assert.doesNotMatch(
    app,
    /deltaX \* 0\.35/
  );
  assert.doesNotMatch(
    app,
    /deltaY \* 0\.22/
  );
});

test("GeoLive dashboard is Google Photorealistic 3D only with no synthetic globe fallback", async () => {
  const [
    html,
    css,
    globe,
    renderer,
    app,
    cloudflareBuild,
    demoBuild
  ] = await Promise.all([
    readFile(
      "dashboard/index.html",
      "utf8"
    ),
    readFile(
      "dashboard/styles.css",
      "utf8"
    ),
    readFile(
      "dashboard/globe-webgl.js",
      "utf8"
    ),
    readFile(
      "dashboard/photorealistic-earth.js",
      "utf8"
    ),
    readFile(
      "dashboard/app.js",
      "utf8"
    ),
    readFile(
      "scripts/build-cloudflare-production.mjs",
      "utf8"
    ),
    readFile(
      "scripts/build-public-demo.mjs",
      "utf8"
    )
  ]);

  assert.doesNotMatch(
    html,
    /id="earthGlobe"|class="globe-surface"/
  );
  assert.match(
    html,
    /id="googleEarthState"/
  );
  assert.doesNotMatch(
    css,
    /\.globe-surface/
  );
  assert.doesNotMatch(
    globe,
    /getContext\(["']webgl/
  );
  assert.doesNotMatch(
    globe,
    /sphereGeometry|VERTEX_SHADER|FRAGMENT_SHADER/
  );
  assert.doesNotMatch(
    globe,
    /3D WebGL|2D fallback/
  );
  assert.match(
    renderer,
    /mode: "google-unavailable"/
  );
  assert.doesNotMatch(
    renderer,
    /using the local WebGL fallback/
  );
  assert.match(
    app,
    /Google Photorealistic 3D unavailable/
  );
  assert.doesNotMatch(
    cloudflareBuild,
    /earth-dark\.svg/
  );
  assert.doesNotMatch(
    demoBuild,
    /earth-dark\.svg/
  );
});

test("Cloudflare production config keeps runtime secret values out of committed vars", async () => {
  const configText = await readFile(
    "cloudflare/wrangler.jsonc",
    "utf8"
  );
  const config = JSON.parse(configText);
  assert.deepEqual(
    config.compatibility_flags,
    ["nodejs_compat"]
  );
  assert.equal(
    config.name,
    "rekixo-geolive-prod"
  );
  const committedVars =
    config.vars || {};
  for (const secretName of [
    "GEOLIVE_BOOTSTRAP_TOKEN",
    "GEOLIVE_WEBHOOK_SIGNING_SECRET",
    "GEOLIVE_GOOGLE_MAPS_API_KEY"
  ]) {
    assert.equal(
      Object.hasOwn(
        committedVars,
        secretName
      ),
      false,
      `${secretName} must not have a committed value`
    );
  }
});
