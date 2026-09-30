# GeoLive Cloudflare-Native Production

GeoLive 0.17.0 introduces a Cloudflare-native production runtime. Real tenant traffic, the authenticated dashboard and the API are served by the Cloudflare Worker.

## Canonical production domain

The canonical production origin is:

```text
https://geolive.rekixo.com
```

Production Google Photorealistic 3D Tiles are fetched through an
authenticated same-origin Worker proxy at `/v1/3dtiles/*`. The Google Map Tiles
API key remains a Cloudflare **Secret** and is never published in dashboard
runtime config or browser JavaScript.

For the production key:

- keep the **API restriction** limited to **Map Tiles API**
- do **not** use a Websites / HTTP referrer application restriction for Map
  Tiles API; Google documents Map Tiles as an IP-restricted web service
- while Cloudflare Workers do not provide a dedicated stable egress IP for this
  Worker, leave the application restriction unset and rely on the private
  Worker secret plus authenticated, path-limited proxy
- if a stable outbound IP is introduced later, restrict the Google key to that
  IP and keep the same Worker proxy
- store `GEOLIVE_GOOGLE_MAPS_API_KEY` as type **Secret**, never as a plaintext
  dashboard Variable; Cloudflare preserves secrets across Wrangler deploys

The proxy accepts only authenticated admin GET/HEAD requests under
`/v1/3dtiles/*`, strips any caller-supplied `key` parameter, injects the
production secret server-side, does not cache Google tile content, and preserves
Google/Cesium attribution behavior.

Use it for the authenticated dashboard and all new production integrations:

- dashboard: `https://geolive.rekixo.com/dashboard/`
- API: `https://geolive.rekixo.com/v1/...`
- health: `https://geolive.rekixo.com/health`
- readiness: `https://geolive.rekixo.com/ready`
- realtime: `wss://geolive.rekixo.com/v1/realtime`

The generated `workers.dev` hostname remains an operational fallback. Browser
entry points on that hostname redirect to the canonical dashboard; API and
health endpoints remain directly reachable for rollback/diagnostics.

## Production topology

```text
Client apps / SDKs
        |
        v
Cloudflare Worker
  |-- Admin + integration HTTP API
  |-- Static production dashboard
  |-- Google Photorealistic 3D runtime config
  |
  +--> D1
  |     accounts, projects, API keys, sessions
  |     live state, history, usage, geofences
  |     webhook state, audit/security records
  |
  +--> Durable Objects
  |     project-scoped WebSocket rooms
  |     hibernating live connections + replay
  |
  +--> Queues
  |     signed outbound webhook delivery
  |     retry + dead-letter handling
  |
  +--> Cron
        dwell checks every minute
        retention/session cleanup hourly
```

The legacy Node/PostgreSQL/PostGIS/Redis runtime remains in the repository as a
reference and compatibility path. Do not run both runtimes against the same
production dataset.

## What is already ported

The Cloudflare Worker currently implements:

- production admin login/session/CSRF and account/project membership isolation;
- project create/update/delete;
- D1-backed API-key create/list/rotate/revoke;
- real location ingestion;
- live user list/search/filter/cursor pagination;
- summary, facets and server-side geographic clustering;
- movement history and historical heatmap;
- per-project ingest/read rate limits, daily ingest quota and live-user quota;
- usage metering, operations limits and security-event history;
- circle/polygon geofences and enter/exit/dwell evaluation;
- webhook endpoints, alert rules, signed Queue delivery, retry, DLQ and attempt history;
- Durable Object WebSocket rooms and durable event replay;
- the real admin dashboard as Worker Static Assets;
- Google Photorealistic 3D runtime configuration;
- scheduled dwell processing and retention.

The current Cloudflare port deliberately does **not** claim parity for:

- short-lived client-token exchange, P-256 request proof and Play Integrity;
- SSE `/v1/events` (use the WebSocket endpoint in this runtime);
- the commercial billing/support/platform console;
- team invitations, password recovery and MFA;
- route/trip analytics and CSV/JSON export.

Keep those controls disabled or internal until the matching Cloudflare phase is
implemented.

## Resource creation

The configuration file is:

```text
cloudflare/wrangler.jsonc
```

The D1 schema is:

```text
cloudflare/migrations/0001_core.sql
```

Create the D1 database:

```bash
npx wrangler@latest d1 create rekixo-geolive-production
```

Cloudflare prints the database UUID. Replace only:

```text
REPLACE_WITH_D1_DATABASE_ID
```

inside `cloudflare/wrangler.jsonc`.

Create the producer queue:

```bash
npx wrangler@latest queues create rekixo-geolive-webhooks
```

The configured dead-letter queue is `rekixo-geolive-webhooks-dlq`. Wrangler/
Cloudflare can create a missing DLQ from consumer configuration, but creating it
explicitly before cutover makes the resource visible and auditable:

```bash
npx wrangler@latest queues create rekixo-geolive-webhooks-dlq
```

## Required secrets

The production Worker uses these runtime secrets. Their names are documented here,
but no secret values are committed to Git:

- `GEOLIVE_BOOTSTRAP_TOKEN`
- `GEOLIVE_WEBHOOK_SIGNING_SECRET`
- `GEOLIVE_GOOGLE_MAPS_API_KEY`

`GEOLIVE_GOOGLE_MAPS_API_KEY` is also declared as a required Wrangler secret so
a production release fails fast instead of publishing a dashboard with a broken
Google globe. Bootstrap and webhook secrets remain runtime-managed because
bootstrap may already be complete and webhook automation can be independently
enabled.

Set them interactively. Never place their values in Git, screenshots, chat, shell
arguments or Wrangler `vars`.

```bash
npx wrangler@latest secret put GEOLIVE_BOOTSTRAP_TOKEN --config cloudflare/wrangler.jsonc
npx wrangler@latest secret put GEOLIVE_WEBHOOK_SIGNING_SECRET --config cloudflare/wrangler.jsonc
npx wrangler@latest secret put GEOLIVE_GOOGLE_MAPS_API_KEY --config cloudflare/wrangler.jsonc
```

Use independent random values for the bootstrap and webhook master secrets.
The Google browser key must remain restricted to **Map Tiles API** and to the
exact production Worker/custom-domain HTTP referrer. The browser receives this
key by design; its API/referrer restrictions are the security boundary.

For local Worker development, use `cloudflare/.dev.vars`. That path is ignored
by Git.

## First Worker creation

Use the Worker name `rekixo-geolive-prod`. This Worker is the only supported GeoLive deployment target.

The first Worker deployment is allowed before runtime secrets exist. In that
state bootstrap is denied, webhook signing is unavailable, and the dashboard
falls back if the Google map key is missing. Add the three runtime secrets in
the Worker dashboard immediately after the Worker is created, then redeploy
before creating any admin or production API key.

## Build, migrate and deploy

Build the Worker Static Assets:

```bash
npm run build:cloudflare
```

For Cloudflare Git builds, the production deploy command is intentionally
migration-first so schema changes land before the Worker version:

```bash
npx wrangler@latest d1 migrations apply DB --remote --config cloudflare/wrangler.jsonc && npx wrangler@latest deploy --config cloudflare/wrangler.jsonc
```

For local/manual release work, use the migration-first release command:

```bash
npm run cloudflare:release
```

It runs the remote D1 migrations first and only then builds/deploys the Worker.
The split commands remain available for diagnostics, but production releases
should prefer the combined command to prevent code/schema ordering mistakes.

A deployment is not production-ready until both return:

```text
GET /health -> 200
GET /ready  -> 200
```

The readiness response must report:

```json
{
  "ready": true,
  "service": "rekixo-geolive-cloudflare",
  "version": "0.17.0",
  "persistence": "d1",
  "realtime": "durable-objects"
}
```

## First bootstrap

Bootstrap is intentionally one-shot. `POST /internal/bootstrap` requires
`Authorization: Bearer <GEOLIVE_BOOTSTRAP_TOKEN>` and refuses to run after an
admin already exists.

The body requires:

```json
{
  "email": "admin@example.com",
  "displayName": "Admin",
  "password": "<strong password>",
  "accountName": "Rekixo",
  "projectName": "GeoLive Production",
  "projectSlug": "production"
}
```

The response returns one production integration key **once**. Store that secret
in the consuming application's secret storage. Never embed an admin credential
or unrestricted production key in an Android/Web client.

After bootstrap, open:

```text
https://geolive.rekixo.com/dashboard/
```

and sign in with the bootstrapped admin account.

## Real-location cutover test

Before connecting a production app:

1. Create a dedicated ingest key with only `location:write`.
2. Restrict its package/origin where applicable.
3. Send one known test user to `POST /v1/locations`.
4. Confirm it appears in D1 `live_user_state` and `location_history`.
5. Open the real dashboard and confirm the user appears on the photorealistic globe.
6. Keep the dashboard open and send a second point; confirm the Durable Object
   WebSocket moves the marker without a page refresh.
7. Create a small test geofence and confirm enter/exit/dwell events.
8. Point a webhook at a controlled HTTPS receiver and verify signature, retry and
   delivery-attempt history.
9. Only after these checks should a real mobile app key be enabled.

## Rollback


If a Worker release is unhealthy:

- roll back the Worker deployment;
- do not roll back an already-applied D1 migration by editing its SQL;
- create a forward migration for schema corrections;
- keep API keys and webhook signing secrets stable across a code rollback;
- verify `/ready` before restoring client traffic.

## Security notes

- Admin cookies are `Secure`, `HttpOnly`, `SameSite=Strict`.
- Mutating admin requests require CSRF.
- Integration secrets are stored only as SHA-256 hashes in D1.
- Webhook secrets are derived from a Worker secret and are not stored in D1.
- Webhook targets must be HTTPS and literal private/local network targets are
  rejected.
- Public API origin/package rules are enforced per API key.
