# Rekixo GeoLive

**Rekixo GeoLive** is project-neutral live-location infrastructure for Android apps, Flutter apps, websites, Cloudflare/Firebase/Node backends and future Rekixo products.

> Projects integrate through GeoLive API/SDK contracts. GeoLive does not read sibling-project private databases or require sibling repositories to share deployments, secrets or source trees.

## Current implementation

P0 + P1A + P1B + P1C + P1D now provide:

- project-scoped live-location ingestion
- online / recent / offline / inactive presence
- durable PostgreSQL + PostGIS latest-state/history storage
- immutable checksum-verified migrations
- secure admin login and DB-backed revocable sessions
- owner/admin/viewer account memberships
- project create/select/edit/suspend/soft-delete
- database-backed `rgl_live_...` API keys
- one-time full-secret reveal, hash-only storage, rotate/revoke/expiry
- exact browser-origin and optional package restrictions
- **PostgreSQL-distributed project rate limits**
- **daily ingest + live-user quotas**
- **cursor pagination**
- **hourly operational metrics**
- **project security-event monitoring**
- **per-project retention policies + bounded retention worker**
- dashboard controls for API keys, quotas, limits and security signals
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

## P1D operations model

Default project controls:

- ingest: 600 requests/minute
- reads: 300 requests/minute
- daily ingest: 1,000,000
- live users: 100,000
- history retention: 30 days
- security/metrics retention: 90 days

These are editable per project by owner/admin roles.

Run retention from a trusted scheduler:

```bash
npm run retention
```

Optional worker bounds:

```text
GEOLIVE_RETENTION_BATCH_SIZE=5000
GEOLIVE_RETENTION_MAX_BATCHES=20
```

The server does not run destructive retention automatically at startup.

## Pagination

User-list endpoints support:

```text
?limit=100&cursor=<opaque-cursor>
```

Responses include `nextCursor` when more rows remain.

## Legacy API-key migration

The pre-P1C `GEOLIVE_KEYS_JSON` bridge remains temporarily readable to prevent outages during migration. Do not create new production integrations on it.

See [Legacy key retirement](docs/LEGACY-KEY-RETIREMENT.md).

## Verification

```bash
npm run check
```

CI starts a real PostGIS service, applies all migrations, runs project/admin/API-key/P1D operations tests and executes the retention worker.

See:

- [Architecture](ARCHITECTURE.md)
- [Security](SECURITY.md)
- [Integration guide](docs/INTEGRATION.md)
- [P1A durable Postgres](docs/P1A-DURABLE-POSTGRES.md)
- [P1B admin control plane](docs/P1B-ADMIN-CONTROL-PLANE.md)
- [P1C API-key lifecycle](docs/P1C-API-KEY-LIFECYCLE.md)
- [P1D security & operations](docs/P1D-SECURITY-OPERATIONS.md)
- [Production roadmap](docs/PRODUCTION_ROADMAP.md)
- [OpenAPI](openapi.yaml)
