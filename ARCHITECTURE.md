# Rekixo GeoLive Architecture Contract

Status: **P1C DATABASE CREDENTIAL LIFECYCLE**

## Product boundary

GeoLive is reusable infrastructure. FinWorkar, EntroNex, LudoProof, Rekixo AR3D, Rekixo websites and future products are clients/tenants, not the identity of this codebase.

No sibling repository is required to share a database, deployment, secret or source tree with GeoLive.

## Non-invasive integration

Integration happens through explicit REST/SDK contracts. GeoLive does not directly read a sibling project's Firebase, D1, PostgreSQL, R2, Firestore or other private application database.

## Tenancy

```text
Account
  -> Membership (owner/admin/viewer)
  -> Project
      -> Integration API Keys
      -> Users
      -> live_user_state
      -> location_history
```

Public API project identity is resolved from the authenticated API key. Admin access is resolved from account membership.

## Admin authentication

Admin auth and integration-key auth are separate security domains.

Admin:
- Scrypt password hash
- opaque DB-backed session token
- HttpOnly SameSite cookie
- rotating CSRF token
- revocable session

Integration:
- `rgl_live_<prefix>_<secret>`
- public lookup prefix
- SHA-256 full-secret hash at rest
- explicit scopes
- optional origin/package restrictions
- expiry/revocation
- last-used metadata

The full integration secret is one-time output only.

## Scope separation

Ingest keys use:

- `location:write`

Read keys use one or more of:

- `users:read`
- `summary:read`
- `events:read`

Write + read scopes are deliberately not combined on one key.

## Project lifecycle

- `active`: API-key authentication and ingestion can proceed.
- `suspended`: integration authentication is denied; admin inspection remains available.
- `deleted`: hidden from ordinary control-plane lists; data remains for explicit retention/deletion processing.

## Persistence

PostgreSQL/PostGIS stores:

- accounts/projects/memberships
- admin users/sessions
- integration API-key metadata/hashes
- live user state
- append-only location history
- audit log

Migrations are immutable and checksum verified.

## Compatibility

The environment-key bridge remains temporarily readable so an existing P0/P1A/P1B deployment can migrate without an immediate outage. All new credentials should use the P1C database lifecycle.

## Realtime

The foundation currently exposes project-scoped SSE for integration readers. Production scale work may add authenticated WebSocket project rooms and Redis fanout.

## Remaining production gates

P1D/P1E/P2 include distributed rate limits, pagination, retention, quotas, operational monitoring, scaled realtime, short-lived ingest tokens, app attestation and replay protection.
