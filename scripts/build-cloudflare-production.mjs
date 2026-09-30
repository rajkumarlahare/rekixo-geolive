import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const source = path.join(root, "dashboard");
const output = path.join(root, "dist-cloudflare", "dashboard");

await rm(path.join(root, "dist-cloudflare"), {
  recursive: true,
  force: true
});
await mkdir(output, { recursive: true });

const files = [
  "index.html",
  "styles.css",
  "app.js",
  "globe-webgl.js",
  "photorealistic-earth.js",
  "geofence-editor.js",
  "geolive-favicon.svg"
];

for (const file of files) {
  await cp(
    path.join(source, file),
    path.join(output, file)
  );
}

console.log(
  "GeoLive Cloudflare production assets ready:",
  path.relative(root, output)
);
