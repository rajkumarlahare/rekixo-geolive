# P1E — Production Realtime

Status: implemented foundation.

## Goals

P1E adds realtime delivery that remains project-isolated and recoverable across reconnects and multiple application instances.

It does not change sibling product repositories.

## Integration WebSocket

Connect:

```text
wss://<geolive-host>/v1/realtime
```

Authenticate after the socket opens:

```json
{
  "type": "authenticate",
  "token": "rgl_live_...",
  "packageId": "com.example.app",
  "resumeAfter": "12345"
}
```

`packageId` is optional unless the key has an allowed-package restriction.

The credential needs `events:read`.

The API key is deliberately not accepted through the WebSocket URL.

## Event envelope

Location event:

```json
{
  "type": "location",
  "sequence": "12346",
  "eventId": "uuid",
  "projectId": "uuid",
  "userId": "user_123",
  "payload": {
    "userId": "user_123",
    "latitude": 21.2514,
    "longitude": 81.6296,
    "status": "online"
  },
  "createdAt": "2026-09-28T00:00:00.000Z"
}
```

`sequence` should be stored by the consumer after it has applied the event.

## Reconnect

Reconnect with the last applied sequence.

If the retained gap is within the replay bound, GeoLive replays missing events then sends:

```json
{
  "type": "ready",
  "projectId": "uuid",
  "latestSequence": "12360"
}
```

If the gap is too large:

```json
{
  "type": "resync_required",
  "reason": "replay_limit",
  "latestSequence": "13000"
}
```

Reload current state using REST, then continue from new live events.

## Backpressure

For a slow socket, queued location frames are coalesced per user. The connection is closed with code `1013` if bounded buffering still cannot keep up.

Reconnect/resume is the recovery mechanism.

## Redis

Single instance:

```text
GEOLIVE_REDIS_URL=
GEOLIVE_REDIS_REQUIRED=false
```

Multi-instance:

```text
GEOLIVE_REDIS_URL=rediss://user:password@redis.example.com:6380/0
GEOLIVE_REDIS_REQUIRED=true
```

Redis Pub/Sub is fanout only. PostgreSQL remains the durable replay source.

## Dashboard

The admin dashboard connects through:

```text
/v1/admin/realtime?projectId=<uuid>&after=<sequence>
```

Authentication is the existing HttpOnly admin session cookie.

Polling remains as a 60-second fallback.

## Clustering

Projects above 500 users use server-side aggregate markers when no user filter is active.

Endpoints:

- integration: `GET /v1/clusters`
- admin: `GET /v1/admin/projects/:projectId/clusters`

`gridDegrees` controls cell size and is bounded by the server.

## Retention

Default durable replay retention is 24 hours per project.

The existing `npm run retention` worker deletes old realtime events in bounded batches.

## SSE compatibility

`GET /v1/events` remains available. It is not the preferred multi-instance transport.
