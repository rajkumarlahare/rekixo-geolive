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
| Environment variables | none required |

The Pages deployment will receive a stable `*.pages.dev` URL. Demo mode automatically activates on that hostname.

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
