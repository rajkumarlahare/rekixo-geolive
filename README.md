# Rekixo GeoLive

**Rekixo GeoLive** is a project-neutral live-location platform designed to work across Android apps, Flutter apps, websites, Cloudflare Workers, Firebase backends, Node services and future Rekixo products without copying GeoLive code into every project.

The core boundary is:

> Projects integrate with GeoLive through a stable API/SDK contract. GeoLive does not directly depend on, edit, or share private databases with sibling products.

## Current foundation

Implemented:

- project-scoped location ingestion
- project-scoped user list and summary APIs
- online / recent / offline / inactive presence states
- server-sent real-time events
- dark live-globe dashboard prototype
- JavaScript SDK
- Android/Kotlin transport adapter
- Flutter/Dart transport adapter
- **durable PostgreSQL + PostGIS store**
- latest-state + append-only history transaction
- immutable checksum-verified database migrations
- PostGIS indexes
- graceful database shutdown/readiness
- OpenAPI contract
- CI with real PostGIS integration tests

Memory persistence remains available for local demos only. **Production refuses to use the memory store.**

## Durable Postgres setup

1. Create a PostgreSQL database with PostGIS available.
2. Configure:

```text
GEOLIVE_PERSISTENCE=postgres
DATABASE_URL=postgresql://...
DATABASE_SSL=verify-full
```

3. Apply immutable migrations:

```bash
npm ci
npm run migrate
```

4. Until the Admin/Project UI is built, provision a project from the operator CLI:

```bash
npm run db:bootstrap -- finworkar "FinWorkar"
```

The command prints the database project UUID. Use that UUID as the `projectId` in the currently configured hashed runtime key record.

5. Start:

```bash
npm start
```

The production process fails closed if Postgres/PostGIS/migrations are not ready.

## Repository boundary

Only this repository contains GeoLive changes. Existing sibling repositories remain read-only references for compatibility and do not need to be modified or redeployed.

## Credential model

A credential is bound to exactly one project and minimal scopes:

- ingestion: `location:write`
- dashboard: `users:read`, `summary:read`, `events:read`

The client does not select its authoritative tenant through an arbitrary request-body `projectId`; authentication resolves it first.

The next control-plane phase will move key lifecycle (generate/revoke/rotate) fully into Postgres/Admin APIs. Until then, production runtime keys remain supplied as hashed `GEOLIVE_KEYS_JSON`.

## Verification

```bash
npm run check
```

CI also boots a real PostGIS database, applies migrations and verifies that the same external user ID can exist in two projects without crossing tenant boundaries.

See:

- [Architecture](ARCHITECTURE.md)
- [Security](SECURITY.md)
- [Integration guide](docs/INTEGRATION.md)
- [P1A durable Postgres](docs/P1A-DURABLE-POSTGRES.md)
- [Production roadmap](docs/PRODUCTION_ROADMAP.md)
- [Sibling repository safety](docs/REPOSITORY-SAFETY.md)
- [OpenAPI](openapi.yaml)
