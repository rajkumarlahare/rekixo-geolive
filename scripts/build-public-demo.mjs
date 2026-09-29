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
    'src="/dashboard/runtime-config.js"',
    'src="./runtime-config.js"'
  )
  .replace(
    'src="/dashboard/app.js"',
    'src="./app.js"'
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
    "runtime-config.js"
  ),
  `globalThis.__GEOLIVE_PUBLIC_CONFIG__ = Object.freeze(${JSON.stringify({
    demoMode: true,
    googleMapsApiKey
  })});\n`,
  "utf8"
);

if (
  index === sourceIndex ||
  index.includes("/dashboard/styles.css") ||
  index.includes("/dashboard/app.js") ||
  !index.includes("./runtime-config.js") ||
  index.includes("/dashboard/runtime-config.js")
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
  "GeoLive public demo build:",
  "0.16.1-production-correctness"
);
console.log(
  "Photorealistic Earth:",
  googleMapsApiKey
    ? "configured"
    : "not configured; local WebGL fallback remains active"
);
