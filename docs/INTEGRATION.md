# Universal Integration Guide

GeoLive is designed so existing projects can integrate without architectural rewrites or direct database coupling.

## 1. Create project credentials

From the authenticated GeoLive dashboard, select a project and open **API Keys**.

Create separate credentials:

- ingest key: `location:write`
- read/realtime key: `users:read`, `summary:read`, `events:read`

The full `rgl_live_...` secret is displayed once. Store it in the consuming project's secret manager or trusted backend configuration.

Do not put admin credentials in client applications.

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
  "device": {
    "platform": "android",
    "appVersion": "2.27"
  }
}
```

The project is resolved from the authenticated key. The request body cannot choose another project.

Accepted responses include `eventSequence` when durable realtime persistence is active.

## 3. Production realtime WebSocket

Connect to:

```text
wss://geolive.example.com/v1/realtime
```

Do not place the API key in the WebSocket URL.

After the connection opens, authenticate:

```json
{
  "type": "authenticate",
  "token": "rgl_live_...",
  "packageId": "com.example.app",
  "resumeAfter": "12345"
}
```

The credential must include `events:read`.

The server replies with `ready`, then emits project-scoped `location` events.

Persist the latest applied numeric `sequence`. On reconnect, send it as `resumeAfter`.

If the replay gap is too large, GeoLive sends `resync_required`. Reload current state via REST and continue receiving new events.

## 4. Realtime event example

```json
{
  "type": "location",
  "sequence": "12346",
  "eventId": "f7d59f39-6cbd-4c8a-a88c-a1b146882003",
  "projectId": "5d1d0b97-5ef0-4d34-95f8-0c655675798d",
  "userId": "user_123",
  "payload": {
    "userId": "user_123",
    "latitude": 21.2514,
    "longitude": 81.6296,
    "status": "online"
  },
  "createdAt": "2026-09-28T05:00:01.000Z"
}
```

## 5. Backpressure and reconnect

GeoLive bounds WebSocket memory use.

Queued location updates can be coalesced per user. Persistently slow consumers may be closed with WebSocket code `1013`.

Reconnect using the last successfully applied sequence.

## 6. Large-map clustering

Read-key clients can request aggregate map cells:

```http
GET /v1/clusters?gridDegrees=8
Authorization: Bearer rgl_live_...
```

Each result contains a cluster center, user count and online/recent/offline/inactive counts.

Smaller `gridDegrees` produces finer cells.

## 7. Browser integrations

Configure exact allowed origins on the API key.

Browser `Origin` is checked during REST and WebSocket authentication.

Long-lived keys embedded in browser JavaScript can be extracted. For sensitive deployments, use a trusted backend and the future P2 short-lived token flow.

## 8. JavaScript SDK

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

## 9. Android

```kotlin
val geo = RekixoGeoLiveClient(
    baseUrl = "https://geolive.example.com",
    ingestToken = "<ingest-key-or-short-lived-token>",
    userId = userId,
    packageId = applicationContext.packageName
)
```

Package-header restrictions are defense-in-depth. P2 app attestation is required for stronger client identity.

The host app owns permission prompts and foreground/background location policy.

## 10. Flutter

```dart
final geo = RekixoGeoLiveClient(
  baseUrl: 'https://geolive.example.com',
  ingestToken: '<ingest-key-or-short-lived-token>',
  userId: userId,
  packageId: 'com.example.app',
);
```

## 11. Trusted server projects

Firebase Functions, Node services and other trusted backends can hold GeoLive credentials in their own secret manager and call the REST or WebSocket contracts.

Never log raw GeoLive credentials.

## 12. Multi-instance GeoLive

Client integrations do not change when GeoLive scales horizontally.

GeoLive instances can share Redis Pub/Sub for realtime fanout while PostgreSQL remains the durable replay source.

## 13. Compatibility boundary

GeoLive does not directly read sibling-project databases.

Existing FinWorkar, Rekixo AR3D, EntroNex, LudoProof and other repositories stay independent until they intentionally integrate through these contracts.
