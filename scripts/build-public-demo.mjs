import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const source = path.join(root, "dashboard");
const output = path.join(root, "dist-demo");

const files = [
  "styles.css",
  "app.js",
  "globe-webgl.js",
  "photorealistic-earth.js",
  "geofence-editor.js",
  "demo-mode.js",
  "earth-dark.svg",
  "_headers"
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const file of files) {
  await cp(
    path.join(source, file),
    path.join(output, file)
  );
}

const sourceIndex = await readFile(
  path.join(source, "index.html"),
  "utf8"
);
const index = sourceIndex
  .replace(
    'href="/dashboard/styles.css"',
    'href="./styles.css"'
  )
  .replace(
    '  <script type="module" src="/dashboard/app.js"></script>',
    '  <script src="./demo-config.js"></script>\\n  <script type="module" src="./app.js"></script>'
  );

const googleMapsApiKey =
  String(
    process.env
      .GOOGLE_MAPS_API_KEY ||
    ""
  ).trim();

await writeFile(
  path.join(
    output,
    "demo-config.js"
  ),
  `globalThis.__GEOLIVE_PUBLIC_CONFIG__ = Object.freeze(${JSON.stringify({
    googleMapsApiKey
  })});\\n`,
  "utf8"
);

if (
  index === sourceIndex ||
  index.includes("/dashboard/styles.css") ||
  index.includes("/dashboard/app.js") ||
  !index.includes("./demo-config.js")
) {
  throw new Error(
    "public_demo_asset_rewrite_failed"
  );
}

await writeFile(
  path.join(output, "index.html"),
  index,
  "utf8"
);

console.log(
  "GeoLive public demo bundle ready:",
  path.relative(root, output)
);
console.log(
  "Photorealistic Earth:",
  googleMapsApiKey
    ? "configured"
    : "not configured; local WebGL fallback remains active"
);
