# Rekixo GeoLive Architecture Contract

Status: **P1E PRODUCTION REALTIME FOUNDATION**

## Product boundary

GeoLive is reusable infrastructure. FinWorkar, EntroNex, LudoProof, Rekixo AR3D, Rekixo websites and future products are clients/tenants.

No sibling repository must share a database, deployment, secret or source tree with GeoLive.

## Control/data model

```text
Account
  -> Membership (owner/admin/viewer)
  -> Project
      -> Integration API Keys
      -> Project Limits / Quotas
      -> Users
      -> live_user_state
      -> location_history
      -> realtime_events
      -> usage/security operational data
```

## Durable write path

For PostgreSQL production persistence, a location update transaction writes:

1. user identity/upsert
2. latest live state
3. append-only location history
4. durable realtime event

The realtime event is committed in the same transaction as the accepted location state.

After commit, the event is delivered to the local project room and optionally published to Redis for other application instances.

## WebSocket project rooms

Two WebSocket entry points exist:

- `/v1/realtime` — integration read key authenticates in the first WebSocket message
- `/v1/admin/realtime` — same-origin admin session cookie + project membership

Both join only one authorized project room.

## Sequence / resume

`realtime_events.id` is the durable monotonic sequence.

A reconnecting client presents its last applied sequence. The server:

1. joins the room in replay-hold mode
2. reads durable events after the sequence
3. buffers concurrent live events for that peer
4. emits replay in sequence order
5. flushes held live events in order
6. sends `ready`

If the bounded replay window is exceeded, the server sends `resync_required`. Current state is then reloaded via REST.

## Redis fanout

Each instance has a unique instance ID.

On a committed location event:

```text
Postgres commit
   -> local project room
   -> Redis PUBLISH
        -> other GeoLive instances
             -> their local project rooms
```

Subscriber echo from the publishing instance is ignored.

Redis is optional for one instance. Multi-instance deployments should configure a shared Redis endpoint and may set `GEOLIVE_REDIS_REQUIRED=true`.

## Backpressure

The server does not maintain an unbounded WebSocket queue.

- location frames can be coalesced by external user ID
- writable buffering is capped
- queued frame count is capped
- persistently slow clients are disconnected and resume by durable sequence

## Heartbeat

Server ping frames detect dead sockets. Clients that do not answer with WebSocket pong within the heartbeat timeout are closed.

## Marker clustering

Large-project visualization uses project-scoped server-side latitude/longitude grid aggregation with activity counts.

The dashboard changes requested grid size with zoom and uses clusters only when no individual-user filter is active.

## Compatibility

SSE `/v1/events` remains a compatibility transport. The P1E WebSocket path is the multi-instance production realtime contract.

## Next boundary

P2 introduces short-lived ingest tokens, app attestation and replay/abuse protection for untrusted mobile/browser producers.
