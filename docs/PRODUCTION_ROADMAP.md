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
- project create/select/edit/suspend/soft-delete
- admin dashboard authorization
- audit log foundation

## Next — P1C integration key lifecycle
- database-backed API key generation
- one-time secret display
- key prefix + hash storage
- separate ingest/read scopes
- rotate/revoke/expire
- allowed-origin/package restrictions
- dashboard key management

## P1D security and operations
- distributed rate limits
- admin/API security event monitoring
- pagination/cursors
- retention worker
- quotas
- operational metrics

## P1E production realtime
- authenticated project rooms
- WebSocket where justified
- Redis fanout at multi-instance scale
- reconnect/resume
- backpressure
- marker clustering

## P2 client security
- short-lived ingest tokens
- Android app attestation option
- replay/abuse protection

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
