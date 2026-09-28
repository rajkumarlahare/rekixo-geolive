# Rekixo GeoLive

**Rekixo GeoLive** is project-neutral live-location infrastructure for Android apps, Flutter apps, websites, trusted backends and future Rekixo products.

> Products integrate through GeoLive API/SDK contracts. GeoLive does not read sibling-project private databases or require sibling repositories to share deployments, secrets or source trees.

## Current implementation

P0 + P1A + P1B + P1C + P1D + P1E + P2 now provide:

- project-scoped live-location ingestion
- PostgreSQL/PostGIS latest-state and append-only history
- secure admin control plane and project isolation
- database-backed revocable `rgl_live_...` API keys
- distributed rate limits, quotas, security events and metrics
- cursor pagination and bounded retention
- authenticated WebSocket rooms with durable replay/resume
- optional Redis multi-instance fanout
- server-side live-map clustering
- **dedicated `tokens:issue` issuer keys**
- **short-lived `rgl_client_...` location-write tokens**
- **project/user/package/platform token binding**
- **P-256 proof-of-possession and one-time request nonces**
- **optional/required Android Google Play Integrity verification**
- **issuer revocation propagation to already-issued client tokens**
- dashboard controls for client token TTL, proof and attestation policy
- JavaScript / Android / Flutter adapters for rotating tokens and request proof

Only `rekixo-geolive` is changed by this product. Existing FinWorkar, Rekixo AR3D, EntroNex, LudoProof and other repositories remain independently deployable.

## Production setup

Configure PostgreSQL/PostGIS:

```text
NODE_ENV=production
GEOLIVE_PERSISTENCE=postgres
DATABASE_URL=postgresql://...
DATABASE_SSL=verify-full
```

Then:

```bash
npm ci
npm run migrate
```

Create the first owner:

```bash
GEOLIVE_BOOTSTRAP_PASSWORD="your-strong-password" \
npm run admin:bootstrap -- admin@example.com "Admin Name" "Rekixo"
```

## P2 short-lived client tokens

For mobile/browser producers, keep long-lived credentials on trusted infrastructure.

Create a dedicated API key in the dashboard with:

```text
tokens:issue
```

Do not embed that issuer key in the client application.

Configure a signing key ring in deployment secrets:

```text
GEOLIVE_CLIENT_TOKEN_KEYS_JSON=[{"kid":"2026-09","secret":"<base64url-secret-at-least-32-bytes>"}]
```

The first key signs new client tokens and every listed key can verify tokens, which allows safe key rotation.

A trusted product backend exchanges the issuer key:

```http
POST /v1/client-tokens/exchange
Authorization: Bearer rgl_live_...
Content-Type: application/json

{
  "userId": "user_123",
  "platform": "android",
  "packageId": "com.example.app",
  "clientNonce": "<one-time-url-safe-nonce>",
  "clientTimestampMs": 1790553600000,
  "proofPublicKey": "<base64url-P256-SPKI>"
}
```

GeoLive returns a short-lived `rgl_client_...` bearer token. Default lifetime is 5 minutes; project policy can configure 60–3600 seconds.

## Proof-bound location writes

Short-lived client tokens always use a timestamp and one-time request nonce. Projects default to requiring P-256 proof-of-possession.

The client signs a canonical string containing the exact raw JSON-body SHA-256 and sends:

```text
Authorization: Bearer rgl_client_...
X-GeoLive-Package: com.example.app
X-GeoLive-Request-Timestamp: <epoch-ms>
X-GeoLive-Request-Nonce: <one-time-nonce>
X-GeoLive-Request-Signature: <base64url-ECDSA-signature>
```

Replay nonces are stored only as hashes and are consumed atomically.

## Android Play Integrity

Per project, Android attestation can be:

- `off`
- `optional`
- `required`

GeoLive supports Google Play Integrity standard tokens. The client uses a GeoLive-derived requestHash that binds project, user, package, nonce, timestamp and proof public key. GeoLive decodes the token server-side and checks the configured app/device/licensing verdict policy.

The Play Integrity service-account private key must live only in deployment secrets:

```text
GEOLIVE_PLAY_INTEGRITY_APPS_JSON=[{"packageName":"com.example.app","serviceAccount":{"client_email":"...","private_key":"<secret>"},"requiredDeviceVerdicts":["MEETS_DEVICE_INTEGRITY"]}]
```

## Production realtime

Integration readers connect to:

```text
wss://<host>/v1/realtime
```

After the socket opens, send a read key with `events:read` in the authenticate message. Do not put API keys in the URL.

GeoLive provides durable sequence replay, reconnect/resume, heartbeat, bounded backpressure and optional Redis fanout.

## Large-map clustering

Projects with large user sets can use:

```text
GET /v1/clusters?gridDegrees=8
```

The admin dashboard automatically changes clustering resolution with globe zoom.

## Retention

Run bounded cleanup from trusted scheduling infrastructure:

```bash
npm run retention
```

This cleans location history, realtime replay events, operational data, expired sessions and expired P2 replay-nonce records according to configured policies.

## Compatibility

Existing database-backed `location:write` keys continue to work for trusted/controlled integrations. P2 is additive and is the preferred ingest path for untrusted clients.

The legacy `GEOLIVE_KEYS_JSON` bridge remains migration-only.

## Verification

```bash
npm run check
```

CI applies all migrations and verifies PostgreSQL/PostGIS, API-key lifecycle, rate limits/quotas, realtime replay, Redis fanout, short-lived client tokens, P-256 request proof, replay guards and Play Integrity verification logic.

See:

- [Architecture](ARCHITECTURE.md)
- [Security](SECURITY.md)
- [Integration guide](docs/INTEGRATION.md)
- [P2 client security](docs/P2-CLIENT-SECURITY.md)
- [P1E production realtime](docs/P1E-PRODUCTION-REALTIME.md)
- [Production roadmap](docs/PRODUCTION_ROADMAP.md)
- [OpenAPI](openapi.yaml)
