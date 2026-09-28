# Universal Integration Guide

GeoLive is designed so existing projects can integrate without architectural rewrites or direct database coupling.

## 1. Pick the correct credential model

For trusted backends or controlled server integrations, database-backed `rgl_live_...` keys remain supported.

For untrusted mobile/browser producers, use P2:

```text
Product backend -> GeoLive tokens:issue exchange -> short-lived rgl_client_ token -> client location writes
```

Never put a `tokens:issue` key in an APK, Flutter bundle or browser JavaScript.

## 2. Create project credentials

From the GeoLive dashboard, create separate credentials:

- ingest key: `location:write` for trusted/legacy ingest;
- read key: `users:read`, `summary:read`, `events:read`;
- client-token issuer: `tokens:issue` only.

The full `rgl_live_...` secret is displayed once.

Issuer keys may include allowed package IDs such as:

```text
com.example.app
```

## 3. Short-lived token exchange

The product backend authenticates its own user, then exchanges its trusted issuer key:

```http
POST /v1/client-tokens/exchange
Authorization: Bearer rgl_live_<issuer>
Content-Type: application/json

{
  "userId": "user_123",
  "platform": "android",
  "packageId": "com.example.app",
  "clientNonce": "<random-url-safe-nonce>",
  "clientTimestampMs": 1790553600000,
  "proofPublicKey": "<base64url-DER-P256-SPKI>"
}
```

Response:

```json
{
  "token": "rgl_client_...",
  "tokenType": "Bearer",
  "expiresAt": "2026-09-28T05:05:00.000Z",
  "projectId": "...",
  "userId": "user_123",
  "attested": false,
  "proofRequired": true
}
```

Client tokens are `location:write` only. Their project and user ID cannot be selected by the later location body.

Revoking the issuer key invalidates its child tokens.

## 4. P-256 request proof

When the project requires proof, generate a P-256 key pair in the client security/keystore layer. Send the public SPKI during token exchange and keep the private key non-exportable when the platform supports it.

For every location request, create a fresh timestamp and nonce. Sign this exact canonical value:

```text
RGL-PROOF-V1
POST
/v1/locations
<TIMESTAMP_MS>
<NONCE>
<BASE64URL_SHA256_OF_EXACT_RAW_JSON_BODY>
```

Send:

```http
POST /v1/locations
Authorization: Bearer rgl_client_...
Content-Type: application/json
X-GeoLive-Package: com.example.app
X-GeoLive-Request-Timestamp: 1790553600123
X-GeoLive-Request-Nonce: <one-time-url-safe-nonce>
X-GeoLive-Request-Signature: <base64url-DER-ECDSA-signature>

{"userId":"user_123","latitude":21.2514,"longitude":81.6296,"device":{"platform":"android"}}
```

The signature must be calculated over the exact bytes sent as the HTTP body.

## 5. Android Play Integrity

For Android projects, set attestation policy in **Security & Operations -> Client Security**.

The progression can be:

```text
off -> optional -> required
```

For a standard Play Integrity request, compute the requestHash over:

```text
RGL-TOKEN-EXCHANGE-V1
<PROJECT_ID>
<USER_ID>
<PACKAGE_ID>
<CLIENT_NONCE>
<CLIENT_TIMESTAMP_MS>
<P-256-PROOF-PUBLIC-KEY>
```

using SHA-256 encoded as base64url.

The Android SDK includes `GeoLiveClientSecurity.exchangeRequestHash(...)` so the host app can pass the correct request hash to its Play Integrity integration without GeoLive forcing a Play library dependency into every project.

Send the resulting standard Integrity token to your trusted backend along with the same exchange fields. The backend calls GeoLive with:

```json
"attestation": {
  "provider": "google-play-integrity",
  "token": "<opaque-integrity-token>"
}
```

GeoLive performs server-side decode/verification before issuing the client token.

## 6. JavaScript SDK

Existing static-key use continues to work.

For P2, provide a rotating token provider and request-proof provider:

```js
const geo = new GeoLiveClient({
  baseUrl: "https://geolive.example.com",
  userId: "user_123",
  packageId: "com.example.web",
  tokenProvider: async () => getCurrentShortLivedToken(),
  requestProofProvider: async ({ method, path, body }) => {
    return signGeoLiveRequest({ method, path, body });
  }
});
```

The proof provider returns:

```js
{ timestamp, nonce, signature }
```

## 7. Android SDK

Legacy:

```kotlin
val geo = RekixoGeoLiveClient(
    baseUrl = "https://geolive.example.com",
    ingestToken = trustedToken,
    userId = userId,
    packageId = applicationContext.packageName
)
```

P2 can use `GeoLiveTokenProvider` and `GeoLiveRequestProofProvider` so the host app controls token refresh and private-key operations. `GeoLiveClientSecurity` exposes the exchange requestHash and request-proof canonical helpers.

The host app still owns runtime permission prompts, foreground/background policy and location acquisition.

## 8. Flutter SDK

Flutter supports either `ingestToken` or an async `tokenProvider`.

A `GeoLiveRequestProofProvider` receives the exact UTF-8 request-body bytes and returns timestamp, nonce and signature headers. This keeps the adapter dependency-neutral while allowing the host app/plugin to use secure platform keys.

## 9. Production realtime readers

Connect:

```text
wss://geolive.example.com/v1/realtime
```

Authenticate after open with a read key containing `events:read`, and persist the last applied event sequence for reconnect/resume.

## 10. Large-map clustering

Read-key clients may use:

```http
GET /v1/clusters?gridDegrees=8
Authorization: Bearer rgl_live_...
```

Cluster responses contain aggregate user/activity counts rather than extra user identities.

## 11. Trusted server projects

Firebase Functions, Node services and other trusted backends should keep GeoLive API keys only in their own secret manager.

The product backend is also the correct location for a P2 `tokens:issue` key because it can authenticate the product user before requesting a GeoLive client token.

## 12. Compatibility boundary

GeoLive does not directly read sibling-project databases.

FinWorkar, Rekixo AR3D, EntroNex, LudoProof and other repositories stay independent until they intentionally integrate through these contracts.
