# Rekixo GeoLive

**Rekixo GeoLive** is project-neutral live-location infrastructure for Android apps, Flutter apps, websites, Cloudflare/Firebase/Node backends and future Rekixo products.

> Projects integrate through GeoLive API/SDK contracts. GeoLive does not read sibling-project private databases or require sibling repositories to share deployments, secrets or source trees.

## Current implementation

P0 + P1A + P1B + P1C + P1D + P1E now provide:

- project-scoped live-location ingestion
- durable PostgreSQL + PostGIS latest-state/history storage
- secure admin login and revocable sessions
- owner/admin/viewer account memberships
- project create/select/edit/suspend/soft-delete
- database-backed `rgl_live_...` API keys
- key expiry / rotate / revoke / origin/package restrictions
- PostgreSQL-distributed rate limits and quotas
- cursor pagination
- security events and operational metrics
- configurable retention worker
- **authenticated WebSocket project rooms**
- **ordered replay/resume using durable realtime sequences**
- **heartbeat, reconnect and backpressure controls**
- **optional Redis multi-instance realtime fanout**
- **server-side marker clustering for large projects**
- dashboard live reconnect/resume and clustered markers
- JavaScript / Android / Flutter adapters
- real PostgreSQL/PostGIS CI integration tests

Only `rekixo-geolive` is changed by this product. Existing FinWorkar, Rekixo AR3D, EntroNex, LudoProof and other repositories remain independently deployable.

## Production setup

Configure PostgreSQL/PostGIS:

```text
NODE_ENV=production
GEOLIVE_PERSISTENCE=postgres
DATABASE_URL=postgresql://...
DATABASE_SSL=verify-full
```

Then:

```bash
npm ci
npm run migrate
```

Create the first owner:

```bash
GEOLIVE_BOOTSTRAP_PASSWORD="your-strong-password" \
npm run admin:bootstrap -- admin@example.com "Admin Name" "Rekixo"
```

Open the dashboard, sign in, create/select a project, then configure API keys and Security & Operations.

## Production realtime

Integration clients connect to:

```text
wss://<host>/v1/realtime
```

The API key is **not** placed in the URL. After the socket opens, send:

```json
{
  "type": "authenticate",
  "token": "rgl_live_...",
  "resumeAfter": "12345"
}
```

A read key with `events:read` is required.

GeoLive emits:

- `ready`
- `location`
- `resync_required`
- `pong`

Each durable PostgreSQL location event has a monotonically increasing `sequence`. Clients persist the last applied sequence and send it as `resumeAfter` after reconnect.

If the replay gap exceeds the configured replay limit, GeoLive sends `resync_required`; the client should reload current state through REST and continue receiving new events.

The authenticated dashboard uses a same-origin admin WebSocket automatically.

## Multi-instance fanout

For more than one GeoLive application instance, configure Redis:

```text
GEOLIVE_REDIS_URL=redis://redis.internal:6379/0
GEOLIVE_REDIS_REQUIRED=true
```

`rediss://` is supported for TLS.

Each instance broadcasts locally and publishes durable events to a shared Redis channel. Messages originating from the same instance are ignored on subscriber echo.

If Redis is required but unavailable, `/ready` reports not-ready.

## Backpressure

Slow WebSocket clients do not receive unbounded queues.

GeoLive:

- coalesces queued location updates per user
- caps queued frames
- caps writable buffering
- closes persistently slow consumers with WebSocket code `1013`

Clients should reconnect with their last durable sequence.

## Marker clustering

Large projects use server-side geographic grid clustering. The dashboard automatically switches to cluster markers above 500 users when no user filter is active, and requests smaller grid cells as the globe zoom increases.

Public read-key clients can use:

```text
GET /v1/clusters?gridDegrees=8
```

## Realtime retention

Durable replay events default to 24 hours per project and are deleted by the existing trusted retention worker:

```bash
npm run retention
```

The retention period is editable in Security & Operations.

## Compatibility

`GET /v1/events` SSE remains available for compatibility, but multi-instance production realtime should use the P1E WebSocket path.

The old `GEOLIVE_KEYS_JSON` bridge remains migration-only. New production integrations should use database-backed keys.

## Verification

```bash
npm run check
```

CI applies all migrations and verifies PostGIS persistence, API-key lifecycle, quotas, pagination, realtime event replay, WebSocket delivery, clustering and retention.

See:

- [Architecture](ARCHITECTURE.md)
- [Security](SECURITY.md)
- [Integration guide](docs/INTEGRATION.md)
- [P1C API-key lifecycle](docs/P1C-API-KEY-LIFECYCLE.md)
- [P1D security & operations](docs/P1D-SECURITY-OPERATIONS.md)
- [P1E production realtime](docs/P1E-PRODUCTION-REALTIME.md)
- [Production roadmap](docs/PRODUCTION_ROADMAP.md)
- [OpenAPI](openapi.yaml)
