# Rekixo GeoLive

**Rekixo GeoLive** is a project-neutral live-location platform designed to work across Android apps, Flutter apps, websites, Cloudflare Workers, Firebase backends, Node services and future Rekixo products without copying GeoLive code into every project.

The core boundary is:

> Projects integrate with GeoLive through a stable API/SDK contract. GeoLive does not directly depend on, edit, or share private databases with sibling products.

## Current implementation

P0 + P1A + P1B now provide:

- project-scoped location ingestion
- online / recent / offline / inactive presence
- durable PostgreSQL + PostGIS live/history storage
- immutable checksum-verified migrations
- dark live-globe dashboard
- admin login with Scrypt password hashing
- database-backed revocable admin sessions
- HttpOnly SameSite session cookie + rotating CSRF token
- account memberships: owner/admin/viewer
- project create/select/edit/suspend/soft-delete
- account/project authorization on dashboard reads
- audit records for admin/project mutations
- JavaScript, Android/Kotlin and Flutter integration adapters
- CI against a real PostGIS service

Only the `rekixo-geolive` repository is changed by this product. Existing sibling repositories remain independently deployable.

## Production database setup

Configure PostgreSQL/PostGIS:

```text
NODE_ENV=production
GEOLIVE_PERSISTENCE=postgres
DATABASE_URL=postgresql://...
DATABASE_SSL=verify-full
```

Apply migrations:

```bash
npm ci
npm run migrate
```

## Create the first owner

There is no public unauthenticated admin-signup endpoint.

Create the first owner through the operator command:

```bash
GEOLIVE_BOOTSTRAP_PASSWORD="your-strong-password" \
npm run admin:bootstrap -- admin@example.com "Admin Name" "Rekixo"
```

Then open the dashboard and sign in.

If a P1A account already exists, set:

```text
GEOLIVE_BOOTSTRAP_ACCOUNT_ID=<account-uuid>
```

before running the bootstrap command.

## Project lifecycle

Projects are tenant data inside GeoLive.

- `active`: ingestion allowed
- `suspended`: new ingestion is rejected; admins can still inspect historical/current state
- `deleted`: hidden from normal project lists; data is retained for an explicit later deletion workflow

Creating a new customer project does not create a new code repository or deployment.

## Integration credentials

Admin sessions and integration API keys are separate security domains.

P1B still uses the hashed `GEOLIVE_KEYS_JSON` bridge for app/server integration credentials. **P1C is the next phase**: database-backed `rgl_live_...` key generate/revoke/rotate lifecycle and dashboard controls.

## Verification

```bash
npm run check
```

CI runs both normal verification and Postgres/PostGIS integration tests, including admin role enforcement and project isolation.

See:

- [Architecture](ARCHITECTURE.md)
- [Security](SECURITY.md)
- [Integration guide](docs/INTEGRATION.md)
- [P1A durable Postgres](docs/P1A-DURABLE-POSTGRES.md)
- [P1B admin control plane](docs/P1B-ADMIN-CONTROL-PLANE.md)
- [Production roadmap](docs/PRODUCTION_ROADMAP.md)
- [OpenAPI](openapi.yaml)
