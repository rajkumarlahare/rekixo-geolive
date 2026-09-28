# Rekixo GeoLive Security Rules

Location data is sensitive. GeoLive defaults to least privilege, explicit consent and project isolation.

## API credentials

- Never embed dashboard/admin API credentials in Android, Flutter, browser bundles, GitHub, screenshots, logs or analytics.
- Bind every integration credential to exactly one project and explicit scopes.
- Production stores credential hashes, not raw long-lived secrets.
- Use separate ingestion and administration/read credentials.
- Prefer short-lived client ingest tokens for browser/mobile production usage.
- Never trust a client-supplied `projectId` as the authorization boundary.
- Every database read/write must include `project_id`.

## Admin control plane

- Admin passwords use Scrypt with a per-password random salt.
- Password plaintext is never stored.
- Admin sessions use high-entropy opaque tokens; Postgres stores only SHA-256 of the session token.
- Browser sessions are delivered in HttpOnly, SameSite=Strict cookies and use Secure cookies in production.
- State-changing admin requests additionally require a rotating CSRF token.
- Failed admin logins are locked temporarily after a configurable threshold.
- Owner/admin roles may change project state; viewer is read-only.
- Project deletion is a soft delete and does not silently erase location history.
- Admin mutations are written to `audit_log`.

## Browser controls

Production browser access to public API-key endpoints must use an explicit origin allowlist. CORS is an extra browser control, not authentication.

The dashboard is served with a same-origin Content Security Policy, frame denial, no-referrer policy and restrictive browser permissions.

## Input controls

Latitude: -90..90.  
Longitude: -180..180.  
Accuracy/speed/heading/metadata must be bounded before storage.  
Unknown JSON fields must not silently become privileged fields.

## Logging

Do not log raw API credentials, session tokens, CSRF tokens or passwords. Avoid logging exact coordinates unless the log itself is an approved protected data store with an explicit retention purpose.

## Retention

History retention is project/plan policy. Latest live state may remain while old history is deleted by a background retention job.

## Production gate

Production requires PostgreSQL/PostGIS and the admin-control-plane migrations. Memory persistence is development-only.
