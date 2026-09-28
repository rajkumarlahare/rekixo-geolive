# Rekixo GeoLive

**Rekixo GeoLive** is project-neutral live-location infrastructure for Android apps, Flutter apps, websites, Cloudflare/Firebase/Node backends and future Rekixo products.

> Projects integrate through GeoLive API/SDK contracts. GeoLive does not read sibling-project private databases or require sibling repositories to share deployments, secrets or source trees.

## Current implementation

P0 + P1A + P1B + P1C now provide:

- project-scoped live-location ingestion
- online / recent / offline / inactive presence
- durable PostgreSQL + PostGIS latest-state/history storage
- immutable checksum-verified migrations
- secure admin login and DB-backed revocable sessions
- owner/admin/viewer account memberships
- project create/select/edit/suspend/soft-delete
- **database-backed `rgl_live_...` integration API keys**
- one-time full-secret reveal
- key prefix + SHA-256 hash storage
- separate ingest and read scopes
- key rotate / revoke / expiry
- exact browser-origin restrictions
- optional app-package restrictions
- API-key last-used metadata
- key lifecycle audit events
- dashboard API-key manager
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

Open the dashboard, sign in, create/select a project, then open **API Keys**.

## P1C key model

A new key looks like:

```text
rgl_live_<public-prefix>_<secret>
```

The complete secret is shown only on create/rotate. PostgreSQL stores the visible prefix and a SHA-256 hash, never the retrievable secret.

Use separate keys:

- ingest: `location:write`
- read: `users:read`, `summary:read`, `events:read`

Do not combine write and read scopes in one key.

Browser integrations can restrict exact allowed origins. Mobile integrations can require `X-GeoLive-Package`; this is defense-in-depth only until app attestation is added.

Pre-P1C `GEOLIVE_KEYS_JSON` remains a transitional compatibility bridge so an existing deployment is not broken during migration. New production keys should be created in Postgres through the dashboard.

## Verification

```bash
npm run check
```

CI also starts a real PostGIS service, applies all migrations and tests project isolation, admin roles and key create/authenticate/rotate/revoke behavior.

See:

- [Architecture](ARCHITECTURE.md)
- [Security](SECURITY.md)
- [Integration guide](docs/INTEGRATION.md)
- [P1A durable Postgres](docs/P1A-DURABLE-POSTGRES.md)
- [P1B admin control plane](docs/P1B-ADMIN-CONTROL-PLANE.md)
- [P1C API-key lifecycle](docs/P1C-API-KEY-LIFECYCLE.md)
- [Production roadmap](docs/PRODUCTION_ROADMAP.md)
- [OpenAPI](openapi.yaml)
