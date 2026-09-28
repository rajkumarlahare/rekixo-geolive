# Rekixo GeoLive Security Rules

Location data is sensitive. GeoLive defaults to least privilege, explicit consent, project isolation and bounded operational access.

## Integration API keys

- Full `rgl_live_...` secrets are returned only on create/rotate.
- PostgreSQL stores the visible prefix and SHA-256 secret hash.
- Ingest and read scopes use separate keys.
- Revocation and expiry are enforced on authentication.
- Exact browser origins and optional package IDs can restrict credentials.
- Package headers remain defense-in-depth until app attestation exists.
- Legacy `GEOLIVE_KEYS_JSON` is migration-only.

## WebSocket authentication

The production integration WebSocket is `/v1/realtime`.

Do **not** put API keys into the URL/query string. The client opens the socket first and sends the key in the initial `authenticate` message over TLS.

The key must include `events:read`. Origin and package restrictions are re-applied to the WebSocket authentication.

Admin dashboard realtime uses the existing HttpOnly admin session cookie and account/project authorization.

Unauthenticated integration sockets have a short authentication timeout.

## Reconnect and replay

PostgreSQL stores a bounded durable `realtime_events` stream.

Clients resume using the last applied numeric sequence. Replay is bounded; when a gap is too large, the server sends `resync_required` rather than allocating an unbounded replay.

Realtime events are retention-controlled and are not a permanent audit log.

## Backpressure

Each WebSocket connection has bounded writable buffering and a bounded pending-frame queue.

Queued location updates are coalesced by user ID. A persistently slow consumer is closed with code `1013` and should reconnect using its last durable sequence.

## Multi-instance Redis

Redis fanout is optional for single-instance deployments and expected for multi-instance production realtime.

Supported configuration:

- `redis://`
- `rediss://`

Redis carries already-authorized project event envelopes; it does not receive raw API keys, admin session tokens or passwords.

When `GEOLIVE_REDIS_REQUIRED=true`, Redis connectivity participates in readiness.

## Admin control plane

- Scrypt password hashes with random salts.
- Opaque high-entropy session tokens; only hashes stored.
- HttpOnly + SameSite=Strict cookies; Secure in production.
- CSRF protection on state changes.
- Failed-login lock plus distributed login rate limiting.
- Owner/admin mutation roles; viewer is read-only.
- Project/API-key/limit changes are audited.

## Rate limits and quotas

Public authenticated traffic uses atomic PostgreSQL counters shared across application instances.

Per-project controls include ingest/read requests per minute, daily ingest quota and maximum live users.

## Clustering

Server-side marker clustering returns aggregate grid cells and activity counts; it does not expose extra user identities.

When filters require individual-user semantics, the dashboard falls back to the bounded individual-user view.

## Security events and metrics

GeoLive never copies raw API secrets, passwords, session tokens, CSRF tokens or exact location payloads into security/metrics tables.

## Retention

Location history, realtime replay events, security events and operational metrics have bounded retention. The retention worker runs only when invoked by trusted scheduling infrastructure.

## Remaining client-security gate

P2 still covers short-lived untrusted-client tokens, Android app attestation and replay/abuse protection.
