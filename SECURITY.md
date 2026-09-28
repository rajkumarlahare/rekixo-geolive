# Rekixo GeoLive Security Rules

Location data is sensitive. GeoLive defaults to least privilege, explicit consent and project isolation.

## Integration API keys

- New production credentials are generated in PostgreSQL through the P1C lifecycle.
- Full `rgl_live_...` secrets are returned only on create/rotate and are never retrievable afterward.
- Store only the public prefix and SHA-256 secret hash.
- Use separate ingest and read credentials; mixed write/read scopes are rejected.
- Revocation and expiry are enforced on every database-backed authentication.
- Exact browser-origin restrictions are enforced on the authenticated request.
- Optional `X-GeoLive-Package` restrictions are defense-in-depth only; HTTP headers are forgeable without app attestation.
- Never put read/admin credentials in Android, Flutter or browser bundles.
- Prefer future short-lived tokens + attestation for untrusted mobile/browser clients.
- The legacy `GEOLIVE_KEYS_JSON` path exists only for migration compatibility; do not create new keys there.

## Admin control plane

- Admin passwords use Scrypt with a per-password random salt.
- Password plaintext is never stored.
- Admin sessions use high-entropy opaque tokens; Postgres stores only SHA-256 of the session token.
- Browser sessions are HttpOnly + SameSite=Strict and Secure in production.
- State-changing admin requests require a rotating CSRF token.
- Failed admin logins are temporarily locked after a configurable threshold.
- Owner/admin roles may mutate project/key state; viewer is read-only.
- Project deletion is a soft delete.
- Project and API-key mutations are written to `audit_log`.

## Tenancy

- Never trust a client-supplied project ID as an API authorization boundary.
- Public API project identity comes from the authenticated integration key.
- Admin project access comes from account membership.
- Every live/history database read/write includes `project_id`.
- A suspended/deleted project cannot ingest new location observations.

## Browser controls

CORS preflight can reflect a valid HTTP(S) origin so the real request can reach authentication. The authenticated request must still pass the key's exact origin restriction.

The dashboard is same-origin and served with CSP, frame denial, no-referrer and restrictive browser permissions.

## Logging

Never log raw API secrets, session tokens, CSRF tokens or passwords. Avoid exact-coordinate logging outside approved protected location storage.

## Production gate

Production requires PostgreSQL/PostGIS plus P1B/P1C migrations. Remaining rollout gates include rate limiting, short-lived client tokens/attestation, retention jobs, security monitoring and load testing.
