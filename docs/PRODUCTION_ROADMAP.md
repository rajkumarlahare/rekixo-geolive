# Production Roadmap

## Completed — P0 universal contract and isolation
- stable ingestion contract
- scope-bound credentials
- project-derived authorization
- latest-state model
- presence logic
- live globe dashboard foundation
- JS/Android/Flutter adapters
- regression tests

## Completed — P1A durable persistence
- PostgreSQL/PostGIS store
- latest-state + append-only history transaction
- immutable checksum migrations
- readiness and graceful shutdown
- real PostGIS integration tests

## Completed — P1B admin control plane
- admin login
- Scrypt password hashing
- database-backed revocable sessions
- CSRF protection
- account memberships
- project lifecycle
- audit log foundation

## Completed — P1C integration key lifecycle
- database-backed API key generation
- one-time secret display
- key prefix + hash storage
- separate ingest/read scopes
- rotate/revoke/expire
- exact allowed-origin restrictions
- optional package restrictions
- dashboard key management

## Completed — P1D security and operations
- PostgreSQL-distributed rate limits
- admin-login rate limiting
- daily ingest quota
- concurrency-safe live-user quota
- cursor pagination
- project security-event monitoring
- hourly API metrics
- configurable retention policies
- bounded retention worker
- legacy environment-key retirement procedure

## Completed — P1E production realtime
- authenticated integration WebSocket
- same-origin authenticated admin WebSocket
- project rooms
- durable ordered realtime event sequence
- reconnect/resume replay
- bounded replay with resync-required path
- heartbeat and stale-client cleanup
- backpressure with per-user coalescing
- optional Redis multi-instance fanout
- Redis-required readiness gate
- server-side geographic marker clustering
- dashboard live updates with polling fallback
- realtime-event retention

## Next — P2 client security
- short-lived ingest tokens
- Android app attestation option
- replay/abuse protection
- client token exchange

## P2 commercial layer
- plans/limits
- usage metering
- billing/invoices
- support
- super-admin

## P3 advanced geospatial
- movement history
- heatmap
- geofence
- alerts
- webhooks
- team/invite management
- white-label dashboard
