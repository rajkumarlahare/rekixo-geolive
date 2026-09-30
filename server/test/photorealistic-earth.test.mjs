import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("public demo photorealistic Earth stays optional and safely attributed", async () => {
  const [
    renderer,
    build,
    index,
    headers
  ] = await Promise.all([
    readFile("dashboard/photorealistic-earth.js", "utf8"),
    readFile("scripts/build-public-demo.mjs", "utf8"),
    readFile("dashboard/index.html", "utf8"),
    readFile("dashboard/_headers", "utf8")
  ]);

  assert.match(
    renderer,
    /tile\.googleapis\.com\/v1\/3dtiles\/root\.json/
  );
  assert.match(
    renderer,
    /showCreditsOnScreen:\s*true/
  );
  assert.doesNotMatch(
    renderer,
    /local WebGL fallback|3D WebGL|2D fallback/
  );
  assert.match(
    renderer,
    /mode: "google-unavailable"/
  );
  assert.match(
    build,
    /GOOGLE_MAPS_API_KEY/
  );
  assert.match(
    build,
    /runtime-config\.js/
  );
  assert.match(
    index,
    /id="realEarth"/
  );
  assert.match(
    index,
    /id="realEarthCredits"/
  );
  assert.match(
    headers,
    /https:\/\/tile\.googleapis\.com/
  );
  assert.match(
    headers,
    /Referrer-Policy: strict-origin-when-cross-origin/
  );
});
