# Rekixo GeoLive Security Rules

Location data is sensitive. GeoLive defaults to least privilege, explicit consent, project isolation and bounded operational access.

## Integration API keys

- New production credentials are generated through the database-backed P1C lifecycle.
- Full `rgl_live_...` secrets are returned only on create/rotate and are not retrievable afterward.
- PostgreSQL stores only the visible prefix and SHA-256 hash.
- Ingest and read scopes use separate keys.
- Revocation and expiry are enforced on authentication.
- Exact browser origins and optional package IDs can restrict credentials.
- Package headers are defense-in-depth only until attestation exists.
- The legacy `GEOLIVE_KEYS_JSON` bridge is migration-only.

## Admin control plane

- Scrypt password hashing with random salts.
- High-entropy opaque sessions; only hashes stored.
- HttpOnly + SameSite=Strict cookies; Secure in production.
- CSRF token required for state changes.
- Failed-login account lock plus PostgreSQL-distributed login rate limiting.
- Owner/admin can mutate project/key/limit state; viewer is read-only.
- Project/API-key/limit mutations are audited.

## Rate limits and quotas

Public authenticated traffic is limited using atomic PostgreSQL counters shared across application instances.

Per-project controls include:

- ingest requests/minute
- read requests/minute
- daily ingest quota
- maximum live users

New-user quota checks are transactionally serialized per project to prevent concurrent quota races.

## Security events and metrics

GeoLive records bounded operational metadata for rate-limit blocks, quota blocks and client-restriction failures.

Do not store raw API secrets, passwords, session tokens, CSRF tokens or location payloads in security/metrics tables.

Admin-login source data is stored only as a one-way hash, not as a raw network address.

## Pagination and input safety

Large user/security-event lists use bounded cursor pagination.

Cursors are opaque state, not authorization credentials; authorization is re-evaluated on every request.

## Retention

Location history, project security events and operational metrics have per-project retention windows.

The retention worker is one-shot and batch-bounded. It must be invoked by trusted scheduling infrastructure and never runs automatically during server startup.

## Tenancy

Public API project identity comes from the authenticated key. Admin project access comes from account membership. Every project data query is scoped by `project_id`.

Suspended/deleted projects cannot ingest new observations.

## Remaining production gates

P1E/P2 still cover scaled realtime, short-lived untrusted-client tokens, mobile attestation, replay protection and broader operational load testing.
