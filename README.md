# Rekixo GeoLive

**Rekixo GeoLive** is a project-neutral live-location platform designed to work across Android apps, Flutter apps, websites, Cloudflare Workers, Firebase backends, Node services and future Rekixo products without copying GeoLive code into every project.

The core boundary is:

> Projects integrate with GeoLive through a stable API/SDK contract. GeoLive does not directly depend on, edit, or share private databases with sibling products.

## What is implemented in this foundation

- project-scoped location ingestion
- project-scoped user list and summary APIs
- online / recent / offline / inactive presence states
- server-sent real-time events
- dark live-globe dashboard prototype based on the supplied GeoLive visual direction
- zero-runtime-dependency JavaScript SDK
- Android/Kotlin transport adapter
- Flutter/Dart transport adapter
- PostgreSQL + PostGIS production-direction schema
- OpenAPI contract
- security and architecture rules
- regression tests for project isolation and credential scoping

The included Node server intentionally uses an **in-memory development store**. It is enough to exercise the contract and UI, but it is not approved for real customer tracking. Production must wire durable PostgreSQL/PostGIS storage and the remaining security/control-plane gates in the roadmap.

## Repository boundary

Only this repository contains GeoLive changes. Existing sibling repositories are read-only references for compatibility. They do not need to be modified or redeployed for the GeoLive foundation.

## Local run

Node.js 22:

```bash
# Configure environment values from .env.example using your preferred shell/env loader.
npm test
npm start
```

Open:

```text
http://localhost:8787/
```

Health/readiness:

```text
GET /health
GET /ready
```

## Credential model

A credential is bound to exactly one project and minimal scopes.

- ingestion: `location:write`
- dashboard: `users:read`, `summary:read`, `events:read`

The client does **not** choose its authoritative project by submitting an arbitrary `projectId`; the authenticated credential resolves the project first. This is a key tenant-isolation rule.

Do not embed dashboard/admin credentials in Android, Flutter or browser bundles. The production client model will use short-lived ingest tokens or equivalent attestation.

## Universal integration modes

1. Trusted backend → GeoLive REST API.
2. Android/Flutter/Web → short-lived ingest token → GeoLive.
3. Local/demo direct development key.

See:

- [Architecture](ARCHITECTURE.md)
- [Security](SECURITY.md)
- [Integration guide](docs/INTEGRATION.md)
- [Production roadmap](docs/PRODUCTION_ROADMAP.md)
- [Sibling repository safety](docs/REPOSITORY-SAFETY.md)
- [OpenAPI](openapi.yaml)
