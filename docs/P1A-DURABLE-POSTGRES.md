# P1A — Durable PostgreSQL/PostGIS Persistence

Status: implemented foundation.

## What changed

GeoLive now has a production-direction durable store:

- PostgreSQL connection pool using `pg`
- PostGIS geography points for live and historical locations
- atomic transaction for user upsert + latest state + history append
- one latest row per `project_id + external_user_id`
- append-only history rows
- project-scoped list, summary and history queries
- GiST geospatial indexes
- time/project indexes
- readiness check for PostGIS and required tables
- graceful pool shutdown
- checksum-verified immutable migration runner
- CI integration test against a real PostGIS service

## Persistence modes

`memory`
- development/demo only
- no durability
- production startup rejects it

`postgres`
- durable mode
- requires `DATABASE_URL`
- production default SSL expectation is `verify-full`

## Migration discipline

Run:

```bash
npm run migrate
```

Applied migration names and SHA-256 checksums are stored in `geolive_schema_migrations`.

If an already-applied migration file changes later, migration execution fails. Fixes must be additive new migration files, never edits to production migration history.

Automatic migration on server startup is deliberately disabled.

## Current boundary

P1A does not yet implement the full Admin control plane. The runtime key configuration still comes from hashed `GEOLIVE_KEYS_JSON`.

A temporary operator bootstrap command exists only to create an account/project row before P1B:

```bash
npm run db:bootstrap -- project-slug "Project Name"
```

P1B should replace manual provisioning with authenticated Admin account/project APIs.

## Tenant isolation

Every live/history query contains `project_id`.

The CI integration test creates two projects with the same external user ID, writes different locations, then proves each project sees only its own record/history.
