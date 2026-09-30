import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production photorealistic Earth stays Google-only and safely attributed", async () => {
  const [renderer, index, worker] =
    await Promise.all([
      readFile(
        "dashboard/photorealistic-earth.js",
        "utf8"
      ),
      readFile(
        "dashboard/index.html",
        "utf8"
      ),
      readFile(
        "cloudflare/src/index.mjs",
        "utf8"
      )
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
    index,
    /id="realEarth"/
  );
  assert.match(
    index,
    /id="realEarthCredits"/
  );
  assert.match(
    worker,
    /https:\/\/tile\.googleapis\.com/
  );
  assert.match(
    worker,
    /"referrer-policy": "strict-origin-when-cross-origin"/
  );
});
