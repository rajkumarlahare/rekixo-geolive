# Universal Integration Guide

GeoLive is designed so existing projects can integrate without architectural rewrites.

## REST ingestion

```http
POST /v1/locations
Authorization: Bearer <ingest credential or short-lived ingest token>
Content-Type: application/json

{
  "userId": "user_123",
  "latitude": 21.2514,
  "longitude": 81.6296,
  "accuracyM": 12.5,
  "capturedAt": "2026-09-28T05:00:00.000Z",
  "device": { "platform": "android", "appVersion": "2.27" }
}
```

The project comes from the credential, not from the request body.

## JavaScript

```js
import { GeoLiveClient } from "./sdk/javascript/index.mjs";

const geo = new GeoLiveClient({
  baseUrl: "https://geolive.example.com",
  ingestToken: "<short-lived-token>",
  userId: "user_123"
});

await geo.sendLocation({
  latitude: 21.2514,
  longitude: 81.6296,
  accuracyM: 10
});
```

Call browser tracking only after explicit user permission.

## Android and Flutter

The adapters accept a location observation supplied by the host application. They do not own location permission, background policy or platform location acquisition. This keeps them reusable across FinWorkar and future mobile apps.

## Server projects

Firebase Functions, Node services and Cloudflare Workers can call the REST contract using server-held credentials.

Recommended browser/mobile production path:

```text
App/Web -> own trusted backend -> short-lived GeoLive ingest token -> GeoLive
```

## Compatibility reviewed read-only

Current sibling repositories were inspected without changing them:

- FinWorkar Android: native Kotlin/Android, Google location services, OkHttp capability
- FinWorkar backend: Node 22 Firebase Functions
- FinWorkar web / Rekixo site: static Firebase-hosted web surfaces
- EntroNex: Node 22 API with tenant-scoped credential discipline
- LudoProof: Kotlin Android + Cloudflare Worker backend
- Rekixo AR3D Platform: Next/React/Cloudflare multi-project platform
- Rekixo AR3D Engine: Node/React/Vite/Cloudflare project-neutral engine

No sibling repository needs modification for the GeoLive foundation.
