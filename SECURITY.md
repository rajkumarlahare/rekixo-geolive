# Rekixo GeoLive Security Rules

Location and billing data are sensitive. GeoLive defaults to least privilege, explicit tenant isolation, short credential lifetimes for untrusted clients and role-separated commercial administration.

## Credential classes

GeoLive has three integration credential classes:

1. database-backed `rgl_live_...` API keys for trusted services and controlled integrations;
2. dedicated `tokens:issue` API keys used only by trusted token-exchange backends;
3. short-lived `rgl_client_...` location-write tokens for untrusted/mobile clients.

Full database API-key secrets are returned only on create/rotate. PostgreSQL stores their visible prefix and SHA-256 secret hash.

A `tokens:issue` key cannot be mixed with ingest or read scopes. The legacy environment-key bridge cannot mint client tokens.

## Short-lived client tokens

A client token is bound to one project, one external user ID, `location:write`, the database issuer key, optional package ID, platform, optional P-256 proof public key and a short expiry.

Revoking or expiring the issuer invalidates its child tokens. Signing-key rotation uses a key ring.

## Request proof and replay protection

For `rgl_client_...` location writes, timestamp and one-time nonce headers are required. Proof-bound requests sign the exact raw JSON body hash using P-256 SHA256withECDSA.

Replay nonces are stored only as hashes.

## Android Google Play Integrity

Android attestation may be `off`, `optional` or `required` per project. GeoLive verifies the configured package, requestHash, freshness, app/device verdicts and optional licensing verdict server-side.

Service-account private keys live only in deployment secrets.

## Admin and platform authorization

The tenant admin plane uses:

- Scrypt password hashes with random salts;
- opaque hashed server-side sessions;
- HttpOnly + SameSite=Strict cookies, Secure in production;
- CSRF checks for mutations;
- login lock/rate limits;
- account owner/admin/viewer authorization.

P3 adds a separate `platform_roles` authorization plane. Tenant account membership does not grant cross-account commercial access.

Platform roles are:

- `superadmin`
- `billing`
- `support`
- `viewer`

Sensitive plan, entitlement, subscription, invoice and support mutations are audited.

## Commercial integrity

Existing/new accounts default to the backward-compatible `legacy` subscription until deliberately reassigned.

Effective entitlements come from plan defaults plus explicit account overrides. Project creation and selected P2 features fail closed when the active/trialing subscription does not permit them.

Finalized `billing_usage_periods` do not overwrite their metrics on later rollups. This prevents retention/source-data changes from silently rewriting an already-finalized billing basis.

Invoice generation uses server-computed usage and server-stored price/entitlement data. Clients cannot submit their own calculated subtotal.

## Payment-data boundary

P3 is a provider-neutral billing/invoice ledger.

GeoLive does not store payment-card numbers, CVV, bank credentials or payment-provider secret keys in commercial tables.

Optional provider customer/subscription/invoice references are opaque external identifiers only. Actual payment collection and provider webhooks require a future dedicated payment adapter.

## Support privacy

Tenant support APIs verify account membership.

Messages marked `internal=true` are available only through platform support APIs and are excluded from tenant message responses.

## Rate limits, events and secrets

Public authenticated traffic uses PostgreSQL-backed distributed limits.

GeoLive does not copy raw API secrets, client tokens, Play Integrity tokens, passwords, admin sessions, CSRF tokens, payment secrets or exact location payloads into security/metrics tables.

## Retention

Location history, realtime replay events, P2 replay nonces, security events and operational metrics have bounded cleanup. Commercial invoice/support records are not deleted by the generic retention worker because they represent business records and require an explicit retention policy before automatic deletion.

## Compatibility

Existing trusted `location:write` integrations continue to work. P2/P3 are additive, and the legacy plan preserves pre-commercial accounts.
