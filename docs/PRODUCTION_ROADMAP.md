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

## Completed — P2 client security
- dedicated database-backed `tokens:issue` issuer keys
- short-lived `rgl_client_...` location-write tokens
- project/user/package/platform token binding
- issuer-key revocation invalidates child tokens
- configurable token TTL, maximum one hour
- request timestamp freshness checks
- one-time exchange nonce replay protection
- one-time per-token request nonce replay protection
- optional/default P-256 proof-of-possession for location writes
- Android Google Play Integrity standard-token verification option
- Play Integrity requestHash binding to token-exchange data
- per-project Android attestation mode: off / optional / required
- dashboard client-security policy controls
- JavaScript, Android and Flutter token/proof adapter support
- bounded retention for replay nonce tables

## Completed — P3 commercial layer
- commercial plan catalog
- account subscriptions with backward-compatible legacy plan
- account-level entitlement overrides
- project-count and client-security feature entitlement enforcement
- calendar-period billable usage snapshots
- frozen finalized usage periods
- provider-neutral invoice ledger and line items
- base-price and usage-overage invoice calculation
- currency-safe platform revenue summaries
- account billing/support dashboard
- tenant support cases and replies
- internal platform support notes
- platform roles: superadmin / billing / support / viewer
- platform plan/account/subscription/invoice/support APIs
- super-admin commercial dashboard controls
- idempotent billing usage rollup worker
- PostgreSQL commercial integration tests

## Next — Advanced geospatial
- movement history
- heatmap
- geofence
- alerts
- webhooks

## Later — Product administration
- team/invite management
- white-label dashboard
- external payment-provider adapter and webhooks
- tax engine / credit notes / refunds
- customer self-service checkout portal
