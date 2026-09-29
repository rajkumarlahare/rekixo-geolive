# GeoLive Public Demo on Cloudflare Pages

GeoLive's public demo is a static, read-only showcase. It uses synthetic data only and does not require PostgreSQL, Redis, WebSockets, API secrets, or outbound webhook access.

## Build locally

```bash
npm ci
npm run build:demo
```

The generated site is written to `dist-demo/`.

For a local static-server preview, open the generated site with `?demo=1`. On a `*.pages.dev` hostname demo mode enables automatically.

## Cloudflare Pages settings

Create a Pages project from the GitHub repository and use:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Framework preset | None |
| Root directory | repository root |
| Build command | `npm run build:demo` |
| Build output directory | `dist-demo` |
| Environment variables | none required for the base demo; optional `GOOGLE_MAPS_API_KEY` enables Google Photorealistic 3D Tiles |

The Pages deployment will receive a stable `*.pages.dev` URL. Demo mode automatically activates on that hostname.


## Optional real Earth renderer

The demo keeps the local WebGL globe as a zero-dependency fallback. To enable the Google Earth-style photorealistic renderer:

1. In Google Cloud, enable billing for the project and enable the **Map Tiles API**.
2. Create a browser API key.
3. Restrict the key to **Websites / HTTP referrers**. Add the exact public Pages origin, for example `https://rekixo-geolive.pages.dev/*`, and add the custom domain later if one is attached.
4. Restrict the key's API access to **Map Tiles API**.
5. In Cloudflare Pages, add `GOOGLE_MAPS_API_KEY` to the production build environment and redeploy.

The build writes the browser key only into generated `dist-demo/demo-config.js`; it is never committed to Git. Browser map keys are visible to site visitors by design, so referrer and API restrictions are mandatory.

When the key is configured, GeoLive loads pinned CesiumJS assets and Google's Photorealistic 3D Tiles. The renderer keeps Google/Cesium attribution visible and projects GeoLive clusters, users, heatmaps, movement trails and geofences into the same screen space. If loading fails, the dashboard automatically falls back to the existing local WebGL globe.

## Safety model

- Session identity is a synthetic viewer.
- Account and project roles are read-only.
- All displayed users, locations, invoices, support cases, API keys, events, webhook deliveries, and analytics are synthetic.
- State-changing API calls are rejected with `demo_read_only`.
- No outbound webhook is sent.
- No real API secret is generated or displayed.
- No production database, Redis instance, or realtime socket is required.
- Static Pages security headers are defined in `dashboard/_headers`.

## Production separation

The production Node service continues serving the real dashboard from `/dashboard`. The demo build rewrites only the generated copy in `dist-demo`, so static-hosting paths do not change production routes.

Do not deploy `dist-demo` as a replacement for the real backend. It is a product demonstration surface only.
