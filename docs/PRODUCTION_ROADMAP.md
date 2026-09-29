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
- project-count plus realtime/client-security feature entitlement enforcement
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

## Completed — P4A advanced geospatial reads
- dedicated `history:read` integration scope
- bounded 31-day historical query windows
- cursor-paginated project/user movement history
- PostgreSQL history indexes for project/time and project/user/time reads
- server-side historical heatmap aggregation
- optional heatmap user filter
- movement-history and heatmap commercial feature entitlements
- legacy-plan compatibility for both geospatial features
- authenticated tenant-admin history/heatmap routes
- dashboard movement-trail overlay
- dashboard historical-heatmap overlay
- memory and PostgreSQL isolation/pagination coverage

## Completed — P4B geofence automation
- circle and polygon geofence definitions
- project-scoped active/paused lifecycle
- transactionally ordered enter / exit evaluation
- due dwell scheduler with multi-instance row claiming
- durable geofence event history
- project/geofence alert rules
- one-time endpoint signing-secret reveal and rotation
- signed outbound webhooks
- SSRF-resistant DNS validation and pinned delivery
- exponential retries with idempotent delivery IDs
- terminal dead-letter state and attempt history
- geofence/webhook commercial entitlement enforcement
- tenant admin APIs for geofences, rules, endpoints, events and deliveries
- PostgreSQL transition/isolation coverage plus webhook signing/worker tests

## In progress — P4C product-grade geospatial console
Completed foundation:
- self-hosted dependency-free WebGL/3D earth renderer
- 2D fallback when WebGL is unavailable
- shared projection for markers, clusters, heatmap and movement trails
- pointer drag, wheel/button zoom and reset/pause controls
- real Today Active and 24-hour API-request dashboard metrics
- server-side user filtering/facets and large-project clustering
- WebGL dashboard assets covered by server regression tests
- direct circle/polygon geofence drawing on the globe
- direct redraw/edit workflow for existing geofences
- geodesic circle radius calculation and polygon vertex undo/finish controls
- active/paused geofence boundary overlays aligned with the globe projection
- geofence editor geometry and asset regression coverage
- filtered geofence-event observability by type, geofence and user
- filtered webhook-delivery observability by status, endpoint and event type
- cursor pagination controls for automation history
- project-scoped webhook delivery inspector
- completed-attempt timeline with response status, latency and failure reason
- explicit dead-letter inspection and audited retry path
- concurrent production indexes for observability filters
- explicit cursor pagination UX for broad text-search result sets
- backwards page navigation using a client-side cursor stack
- stale-search response invalidation across filter/project changes
- current-page preservation during realtime and polling refreshes
- memory/PostgreSQL parity coverage for search pagination above 500 matches

Remaining P4C work:
- route/trip analytics and export workflows

## Later — Product administration
- team/invite management
- white-label dashboard
- external payment-provider adapter and webhooks
- tax engine / credit notes / refunds
- customer self-service checkout portal
