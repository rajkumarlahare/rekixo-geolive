# Production Roadmap

## P0 — universal contract and isolation
- stable ingestion contract
- scope-bound credentials
- project-derived authorization
- latest-state model
- presence logic
- basic live globe dashboard
- JS/Android/Flutter adapters
- regression tests

## P1 — durable control plane
- admin signup/login
- project create/edit
- hashed key generate/revoke/rotate
- PostgreSQL/PostGIS store
- immutable migrations
- audit log
- pagination
- retention worker

## P1 — production realtime
- Redis where needed
- WebSocket project rooms
- reconnect/resume
- backpressure
- distributed rate limits
- marker clustering

## P2 — client security
- short-lived ingest tokens
- Android app attestation option
- origin/package restrictions
- replay/abuse protection
- per-project quotas

## P2 — commercial layer
- plans/limits
- usage metering
- billing/invoices
- support
- super-admin

## P3 — advanced geospatial
- movement history
- heatmap
- geofence
- alerts
- webhooks
- team roles
- white-label dashboard
