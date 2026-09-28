# Universal Integration Guide

GeoLive is designed so existing projects can integrate without architectural rewrites or direct database coupling.

## 1. Create a project key

From the authenticated GeoLive dashboard, select a project and open **API Keys**.

Create separate credentials:

- ingest key: `location:write`
- read key: `users:read`, `summary:read`, `events:read`

The full `rgl_live_...` secret is displayed once. Store it in the consuming project's secret manager or trusted backend configuration.

Do not put read/admin credentials in a mobile or browser bundle.

## 2. REST ingestion

```http
POST /v1/locations
Authorization: Bearer rgl_live_<prefix>_<secret>
Content-Type: application/json
X-GeoLive-Package: com.example.app

{
  "userId": "user_123",
  "latitude": 21.2514,
  "longitude": 81.6296,
  "accuracyM": 12.5,
  "capturedAt": "2026-09-28T05:00:00.000Z",
  "device": { "platform": "android", "appVersion": "2.27" }
}
```

`X-GeoLive-Package` is required only when the key has package restrictions.

The project is resolved from the authenticated key. The request body cannot choose another project.

## 3. Browser integrations

Configure exact allowed origins on the key, for example:

```text
https://app.example.com
```

Do not include paths.

The browser's Origin header is checked on the authenticated request.

Long-lived secrets in browser JavaScript can be extracted by users. For sensitive production deployments, prefer:

```text
Browser -> trusted backend -> future short-lived GeoLive token -> GeoLive
```

## 4. JavaScript SDK

```js
import { GeoLiveClient } from "./sdk/javascript/index.mjs";

const geo = new GeoLiveClient({
  baseUrl: "https://geolive.example.com",
  ingestToken: "<ingest-key-or-short-lived-token>",
  userId: "user_123"
});

await geo.sendLocation({
  latitude: 21.2514,
  longitude: 81.6296,
  accuracyM: 10
});
```

Call browser geolocation only after explicit user permission.

## 5. Android

The Android adapter accepts an optional package ID:

```kotlin
val geo = RekixoGeoLiveClient(
    baseUrl = "https://geolive.example.com",
    ingestToken = "<ingest-key-or-short-lived-token>",
    userId = userId,
    packageId = applicationContext.packageName
)
```

Package-header restrictions are defense-in-depth, not cryptographic app identity. The later attestation phase is required for strong binding.

The host Android app owns runtime permission prompts, foreground/background policy and location acquisition.

## 6. Flutter

The Flutter adapter also accepts `packageId`:

```dart
final geo = RekixoGeoLiveClient(
  baseUrl: 'https://geolive.example.com',
  ingestToken: '<ingest-key-or-short-lived-token>',
  userId: userId,
  packageId: 'com.example.app',
);
```

## 7. Trusted server projects

Firebase Functions, Node services and other trusted backends can call GeoLive with server-held keys.

For server-to-server usage, keep the key only in the platform's secret store/environment and never log it.

## 8. Key lifecycle

- create -> copy full secret once
- rotate -> old key is revoked atomically, new secret shown once
- revoke -> authentication fails immediately
- expire -> authentication fails after expiry
- last-used metadata -> visible in dashboard

## 9. Compatibility boundary

GeoLive does not require direct access to a sibling product database. Each product opts in through the API/SDK contract.

Existing sibling repositories remain unchanged until their owners intentionally add a GeoLive integration.
