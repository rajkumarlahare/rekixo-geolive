# P1C — Database-backed Integration API Keys

Status: implemented foundation.

## Key format

New integration credentials use:

```text
rgl_live_<12-hex-prefix>_<high-entropy-secret>
```

Only the prefix and SHA-256 hash are stored. The complete secret is returned exactly when the key is created or rotated and is never retrievable afterward.

## Scopes

Supported integration scopes:

- `location:write`
- `users:read`
- `summary:read`
- `events:read`

Admin sessions are not API keys and cannot be used as integration credentials.

## Lifecycle

Project owner/admin can:

- create
- list metadata
- edit name/restrictions/expiry
- rotate
- revoke

Viewer can list key metadata but cannot mutate keys.

Rotation creates a fresh secret and revokes the previous key atomically.

Revocation and expiry are enforced during every database-backed authentication.

## Restrictions

Browser keys may define exact HTTP(S) origins.

Mobile/server keys may define package identifiers. When packages are configured, callers must send:

```text
X-GeoLive-Package: com.example.app
```

Package headers are defense-in-depth only because a generic HTTP client can forge them. Strong mobile binding requires the later app-attestation phase.

## Production

Production authentication is database-backed. Legacy `GEOLIVE_KEYS_JSON` credentials are development-only after P1C.

CORS preflight may reflect a syntactically valid HTTP(S) origin so the real authenticated request can proceed. The actual public request is then checked against the key's allowed-origin restriction.

## Dashboard

The project Key Manager shows only metadata:

- name
- visible prefix
- scopes
- restrictions
- expiry
- last use
- status

A newly created or rotated secret is displayed in a one-time reveal panel and should be copied immediately.
