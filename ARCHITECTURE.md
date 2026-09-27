# Rekixo GeoLive Architecture Contract

Status: **FOUNDATION**

## Product boundary

GeoLive is reusable infrastructure. FinWorkar, EntroNex, LudoProof, Rekixo AR3D, Rekixo websites and future products are clients/tenants, not the identity of this codebase.

No sibling repository is required to share a database, deployment, secret or source tree with GeoLive.

## Non-invasive integration

Integration happens only through explicit API/SDK contracts:

- HTTPS REST API
- JavaScript SDK
- Android/Kotlin adapter
- Flutter/Dart adapter
- future webhooks/realtime SDKs

GeoLive must never read a sibling project's Firebase, D1, PostgreSQL, R2, Firestore or private application database directly.

## Tenancy

```text
Account
  -> Project
      -> Credentials
      -> Users
      -> live_user_state
      -> location_history
```

Every mutable record is keyed by `project_id`. A normal request does not choose its authoritative project by sending `projectId`; authentication resolves the project first.

## Credentials

Credentials are separated by purpose:

- `location:write` for ingestion
- `users:read`, `summary:read`, `events:read` for dashboards
- future control-plane scopes for project/admin management
- future operator scopes for Rekixo super-admin

Production stores only a hash of long-lived secrets. Browser/mobile production integrations should use short-lived ingest tokens or platform attestation rather than embedding privileged secrets.

## Location and presence

Required observation fields are external user ID, latitude and longitude. Optional fields include accuracy, altitude, heading, speed, capture time, city/state/country, device/app details and bounded metadata.

Default states are configurable:

- online: <= 120 seconds
- recent: <= 15 minutes
- offline: <= 24 hours
- inactive: > 24 hours

## Data separation

Production storage keeps:

- `live_user_state`: one latest row per project/user
- `location_history`: append-only observations with retention

The live dashboard must not scan full history to discover current state.

## Realtime

The dependency-light foundation uses Server-Sent Events. Production may add WebSocket/Socket.IO rooms keyed by project. Authorization happens before subscription regardless of transport.

## Scale direction

The product blueprint's production target remains:

- PostgreSQL + PostGIS
- Redis where hot state/aggregates justify it
- project-specific realtime rooms
- marker clustering and pagination
- rate limits
- retention workers
- queue/batch ingestion at high volume
- precomputed heatmap/dashboard aggregates at very large scale

## Dashboard

The dashboard is itself a client of the same tenant-scoped contract. Target capabilities: project selector, total/online/recent/offline statistics, search, country/state/city filters, colored globe markers, user detail, recent activity and live update state.

## Sibling-project safety

GeoLive development must not modify production code or infrastructure in sibling repositories merely to make GeoLive work. Each project adopts the API/SDK independently.

## Production gate

The included memory store is only for contract/demo development. Before real tracking: durable PostGIS persistence, admin auth/project lifecycle, key rotation/revocation, rate limiting, short-lived ingest tokens/attestation, retention jobs, audit logging, privacy controls and load testing are required.
