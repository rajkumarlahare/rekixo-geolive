# P2 — Client Security

Status: implemented foundation.

## Purpose

P2 lets untrusted mobile/client applications send live location without embedding a long-lived GeoLive ingest or admin credential.

The trusted product backend remains responsible for authenticating its own user. GeoLive then issues a short-lived project/user-bound ingest token.

## Trust model

```text
Client
  -> Product backend
       -> GeoLive /v1/client-tokens/exchange
          Bearer: database-backed tokens:issue key
  <- short-lived rgl_client_ token

Client
  -> GeoLive /v1/locations
     Bearer: rgl_client_ token
     timestamp + nonce + optional/required P-256 proof
```

A `tokens:issue` key is deliberately isolated from read and ingest scopes and must be database-backed.

## Short-lived token claims

The signed token includes:

- issuer/audience
- external user ID
- project ID
- location:write scope
- database issuer API-key ID
- issue/not-before/expiry times
- UUID token JTI
- optional package ID
- platform
- attestation result
- optional P-256 proof public key

Token lifetime defaults to 300 seconds and is limited to 60–3600 seconds.

GeoLive rechecks the issuer API key on every client-token authentication. Revoking or expiring that key invalidates outstanding child tokens.

## Signing-key rotation

Configure:

```text
GEOLIVE_CLIENT_TOKEN_KEYS_JSON=[
  {"kid":"new","secret":"<base64url-32+-byte-secret>"},
  {"kid":"old","secret":"<previous-secret>"}
]
```

The first key signs new tokens. All keys verify.

Safe rotation:

1. deploy new + old, with new first;
2. wait longer than the maximum configured client-token lifetime;
3. remove old.

Do not store these secrets in the repository.

## Token exchange replay protection

Exchange requests contain:

- one-time `clientNonce`
- `clientTimestampMs`

The timestamp must be within the project's maximum request age. The nonce is stored only as SHA-256 and atomically accepted once per project.

Token exchange has a separate per-project rate limit.

## Request replay protection

Every `rgl_client_` location write carries:

```text
X-GeoLive-Request-Timestamp
X-GeoLive-Request-Nonce
```

The nonce is atomically consumed once per `project + token JTI`.

The database stores only nonce hashes and expiry timestamps.

## P-256 proof-of-possession

Project policy defaults to `requireRequestProof=true`.

During exchange, the client supplies a base64url DER SubjectPublicKeyInfo for an EC P-256 public key. The token becomes bound to that public key.

For each location request, sign:

```text
RGL-PROOF-V1
POST
/v1/locations
<TIMESTAMP_MS>
<NONCE>
<BASE64URL_SHA256_EXACT_RAW_BODY>
```

with SHA256withECDSA.

GeoLive verifies the signature against the key in the short-lived token before consuming normal ingest quota or writing location state.

## Android Play Integrity

Per-project policy:

```text
androidAttestationMode = off | optional | required
```

Configured Android packages are supplied through deployment secrets in `GEOLIVE_PLAY_INTEGRITY_APPS_JSON`.

The client requests a standard Play Integrity token with this requestHash:

```text
SHA256_BASE64URL(
  RGL-TOKEN-EXCHANGE-V1
  <PROJECT_ID>
  <USER_ID>
  <PACKAGE_ID>
  <CLIENT_NONCE>
  <CLIENT_TIMESTAMP_MS>
  <P-256-PROOF-PUBLIC-KEY>
)
```

GeoLive decodes the token using Google Play Integrity server APIs and verifies:

- request package
- requestHash binding
- verdict timestamp freshness
- configured app-recognition verdict
- configured device-integrity verdicts
- optional licensing verdict

The opaque Integrity token and service-account private key are not written to security-event or metrics data.

## Project policy API

Read:

```http
GET /v1/admin/projects/:projectId/client-security
```

Update as owner/admin:

```http
PATCH /v1/admin/projects/:projectId/client-security
X-CSRF-Token: ...
Content-Type: application/json

{
  "clientTokenTtlSeconds": 300,
  "requestMaxAgeSeconds": 120,
  "tokenExchangeRequestsPerMinute": 120,
  "requireRequestProof": true,
  "androidAttestationMode": "optional"
}
```

The dashboard exposes the same policy under Security & Operations.

## SDK support

JavaScript:
- static `ingestToken` remains supported
- optional async `tokenProvider`
- optional `requestProofProvider`

Android:
- static token remains supported
- optional `GeoLiveTokenProvider`
- optional `GeoLiveRequestProofProvider`
- exchange requestHash / proof canonical helpers

Flutter:
- static token or async token provider
- proof callback receives exact body bytes

## Retention

Migration 006 adds replay-control nonce tables.

The bounded retention worker removes expired exchange/request nonces and records deletion counts in `retention_runs`.

## Compatibility and rollout

P2 is additive. Existing trusted `location:write` integrations do not automatically break.

Recommended migration for an untrusted mobile producer:

1. deploy signing keys;
2. create a dedicated `tokens:issue` key on the product backend;
3. integrate short-lived tokens while Android attestation is off;
4. enable P-256 request proof;
5. configure Play Integrity;
6. move attestation from optional to required after observing production traffic;
7. remove long-lived ingest credentials from the client package.
