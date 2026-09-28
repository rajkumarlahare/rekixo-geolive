# Rekixo GeoLive Security Rules

Location data is sensitive. GeoLive defaults to least privilege, explicit consent, project isolation, short credential lifetimes for untrusted clients and bounded operational access.

## Credential classes

GeoLive has three integration credential classes:

1. database-backed `rgl_live_...` API keys for trusted services and controlled integrations;
2. dedicated `tokens:issue` API keys used only by trusted token-exchange backends;
3. short-lived `rgl_client_...` location-write tokens for untrusted/mobile clients.

Full database API-key secrets are returned only on create/rotate. PostgreSQL stores their visible prefix and SHA-256 secret hash.

A `tokens:issue` key cannot be mixed with ingest or read scopes. The exchange endpoint also requires that issuer to be database-backed; the legacy environment-key bridge cannot mint client tokens.

## Short-lived client tokens

A client token is signed by the GeoLive client-token signing key ring and is bounded to:

- one project;
- one external user ID;
- `location:write` only;
- the issuing database API-key ID;
- optional package ID;
- client platform;
- optional P-256 proof public key;
- short expiry, default 5 minutes and never more than 1 hour.

Revoking, expiring or otherwise deactivating the issuer API key causes already-issued child tokens to fail authentication.

Signing-key rotation is supported by a key ring: the first configured key signs new tokens while all configured keys may verify existing tokens. Retire an old signing key only after its maximum child-token lifetime has elapsed.

## Token exchange

`POST /v1/client-tokens/exchange` requires a trusted backend credential with only `tokens:issue`.

The exchange request includes a user ID, platform, one-time client nonce, client timestamp, optional package ID, optional P-256 public key and optional attestation token.

Exchange nonces are SHA-256 hashed before storage and may be consumed only once per project.

The issuer key can restrict allowed package IDs. Browser origins remain subject to the issuer key/global origin rules.

Do not embed a `tokens:issue` key inside an APK, browser bundle or other untrusted client.

## Request proof and replay protection

For `rgl_client_...` location writes, GeoLive always requires:

- `X-GeoLive-Request-Timestamp`
- `X-GeoLive-Request-Nonce`

The timestamp must fall within the project's configured freshness window. The nonce is consumed once for the client token's `jti` and stored only as a hash.

Projects default to requiring proof-of-possession. A proof-bound token contains a P-256 public key. The location request must include `X-GeoLive-Request-Signature`, a SHA256withECDSA signature over:

```text
RGL-PROOF-V1
POST
/v1/locations
<TIMESTAMP>
<NONCE>
<BASE64URL-SHA256-OF-EXACT-RAW-JSON-BODY>
```

The signature is checked before normal ingest quota is consumed. Replayed requests fail before location state is written.

## Android Google Play Integrity

Android attestation is configurable per project as `off`, `optional` or `required`.

When supplied, GeoLive verifies a Google Play Integrity standard token server-side. The decoded verdict must match the configured package and a server-recomputed `requestHash` built from:

```text
RGL-TOKEN-EXCHANGE-V1
<PROJECT_ID>
<USER_ID>
<PACKAGE_ID>
<CLIENT_NONCE>
<CLIENT_TIMESTAMP_MS>
<P-256-PROOF-PUBLIC-KEY>
```

GeoLive validates freshness, the configured app-recognition verdict, required device-integrity verdicts and optional licensing verdict.

Service-account private keys belong only in deployment secrets. They are not returned through the dashboard or API.

## WebSocket authentication

The production integration WebSocket is `/v1/realtime`.

Do not put API keys into the URL/query string. The client opens the socket first and sends the read key in the initial authenticate message over TLS.

The key must include `events:read`. Origin and package restrictions are re-applied.

Admin dashboard realtime uses the existing HttpOnly admin session cookie and account/project authorization.

## Admin control plane

- Scrypt password hashes with random salts.
- Opaque high-entropy session tokens; only hashes stored.
- HttpOnly + SameSite=Strict cookies; Secure in production.
- CSRF protection on state changes.
- Failed-login lock plus distributed login rate limiting.
- Owner/admin mutation roles; viewer is read-only.
- Project/API-key/limit/client-security changes are audited.

## Rate limits and quotas

Public authenticated traffic uses atomic PostgreSQL counters shared across application instances.

Client-token exchange has a separate per-project requests-per-minute policy in addition to normal ingest/read controls.

## Security events and secrets

GeoLive does not copy raw API secrets, short-lived client tokens, Play Integrity tokens, passwords, admin session tokens, CSRF tokens or exact location payloads into security/metrics tables.

Attestation failures and client replay/proof failures are recorded as bounded security-event metadata.

## Retention

Location history, realtime replay events, client replay nonces, security events and operational metrics have bounded cleanup. The retention worker runs only when invoked by trusted scheduling infrastructure.

## Compatibility

Existing trusted integrations using database-backed `location:write` keys continue to work. The short-lived client-token path is additive and is the preferred path for untrusted mobile/client producers.

The legacy `GEOLIVE_KEYS_JSON` bridge remains migration-only.
