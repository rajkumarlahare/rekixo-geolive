# Rekixo GeoLive

**Rekixo GeoLive** is project-neutral live-location infrastructure for Android apps, Flutter apps, websites, trusted backends and future Rekixo products.

> Products integrate through GeoLive API/SDK contracts. GeoLive does not read sibling-project private databases or require sibling repositories to share deployments, secrets or source trees.

## Current implementation

P0 through the P4C console foundation now provide:

- project-scoped live-location ingestion
- PostgreSQL/PostGIS latest-state and append-only history
- secure admin control plane and project isolation
- database-backed revocable `rgl_live_...` API keys
- distributed rate limits, quotas, security events and metrics
- cursor pagination and bounded retention
- authenticated WebSocket rooms with durable replay/resume
- optional Redis multi-instance fanout
- server-side live-map clustering
- dedicated `tokens:issue` issuer keys
- short-lived `rgl_client_...` location-write tokens
- P-256 proof-of-possession and replay protection
- optional/required Android Google Play Integrity verification
- **commercial plans and account subscriptions**
- **effective account entitlements and project-count enforcement**
- **billable usage snapshots and provider-neutral invoice ledger**
- **tenant support cases plus platform support workflow**
- **separate superadmin / billing / support / viewer platform roles**
- **billing/support and commercial platform dashboard controls**
- **cursor-paginated project/user movement history**
- **project-scoped historical heatmap aggregation**
- **dashboard movement trails and historical heatmap overlays**
- **circle/polygon geofences with enter, exit and dwell events**
- **durable signed webhook delivery with retries and dead-letter handling**
- **SSRF-resistant production webhook networking and one-time signing-secret reveal**
- **dashboard geofence, alert-rule, endpoint, event and delivery controls**
- **self-hosted dependency-free WebGL globe renderer with 2D fallback**
- **optional Google Photorealistic 3D Tiles renderer through CesiumJS for the public demo**
- **automatic fallback to the local WebGL globe when no browser key is configured or the external renderer fails**
- **shared projection for live markers, clusters, heatmaps, movement trails and the photorealistic Earth view**
- **pointer drag + deep wheel zoom interaction with server-side clustering refresh**

Only `rekixo-geolive` is changed by this product. Existing FinWorkar, Rekixo AR3D, EntroNex, LudoProof and other repositories remain independently deployable.

## Production setup

Configure PostgreSQL/PostGIS:

```text
NODE_ENV=production
GEOLIVE_PERSISTENCE=postgres
DATABASE_URL=postgresql://...
DATABASE_SSL=verify-full
```

Then:

```bash
npm ci
npm run migrate
```

Create the first account owner:

```bash
GEOLIVE_BOOTSTRAP_PASSWORD="your-strong-password" \
npm run admin:bootstrap -- admin@example.com "Admin Name" "Rekixo"
```

All existing and newly-created accounts are assigned the backward-compatible `legacy` commercial plan until a platform administrator deliberately changes the subscription.

To give an existing admin user a platform role:

```bash
npm run platform:grant -- admin@example.com superadmin
```

Supported platform roles are `superadmin`, `billing`, `support` and `viewer`.

## P2 short-lived client tokens

For mobile/browser producers, keep long-lived credentials on trusted infrastructure.

Create a dedicated API key in the dashboard with:

```text
tokens:issue
```

Do not embed that issuer key in the client application.

Configure a signing key ring in deployment secrets:

```text
GEOLIVE_CLIENT_TOKEN_KEYS_JSON=[{"kid":"2026-09","secret":"<base64url-secret-at-least-32-bytes>"}]
```

A trusted product backend exchanges the issuer key at `POST /v1/client-tokens/exchange`. GeoLive returns a short-lived `rgl_client_...` token. Project policy can configure a 60–3600 second lifetime.

Projects may require P-256 proof-of-possession and Android Google Play Integrity. See the P2 guide for canonical request signing and attestation details.

## P3 commercial layer

Commercial data is account-scoped.

A plan defines:

- monthly price in currency minor units
- included ingest requests
- included read requests
- included tracked users
- maximum projects
- optional ingest/read/user overage prices
- feature flags such as realtime, movement history, heatmap, geofences, webhooks, client tokens, Android attestation and priority support

Account-specific entitlement overrides can change limits/features without mutating the shared plan.

Project creation is checked against the account's effective `maxProjects`. Public integration realtime, P2 client-token exchange and Android attestation are checked against their feature entitlements.

### Usage metering

GeoLive builds calendar-period snapshots from the operational/location data already stored by the platform.

Run current-month rollup:

```bash
npm run billing:rollup -- current
```

Finalize the previous month:

```bash
npm run billing:rollup -- previous
```

A finalized usage period is frozen so a later cleanup or source-data change does not silently rewrite previously billed usage.

### Invoices

P3 contains a **provider-neutral invoice ledger**. It calculates draft invoice line items from plan price, finalized usage and overages.

It does **not** collect card/bank payments or call Stripe/Razorpay/another payment processor. Provider references are reserved for a future payment adapter.

Invoice status workflow supports `draft`, `open`, `paid`, `void` and `uncollectible`.

### Support and platform console

Tenant account users can view billing status/invoices and create support cases from the dashboard.

Platform-role users get a separate commercial console for plans, subscriptions, account entitlement overrides, invoice generation/status transitions and support conversations. Internal support notes are never returned through tenant message APIs.

An entitlement override can be reset to **Inherit**, which deletes the account override and resumes the shared plan value. Billing-role users can manage subscriptions/invoices but do not receive support-case metadata through commercial account detail.

## P4A advanced geospatial reads

P4A turns the existing retained `location_history` into bounded, project-scoped historical read APIs.

Create a read key with:

```text
users:read
history:read
summary:read
events:read
```

Movement history:

```http
GET /v1/history?userId=user_123&from=2026-09-27T00:00:00.000Z&to=2026-09-28T00:00:00.000Z&limit=250
Authorization: Bearer rgl_live_<read-key>
```

The response is newest-first and cursor paginated. Query windows are limited to 31 days.

Historical heatmap:

```http
GET /v1/heatmap?from=2026-09-27T00:00:00.000Z&to=2026-09-28T00:00:00.000Z&gridDegrees=2
Authorization: Bearer rgl_live_<read-key>
```

Heatmap cells contain aggregate point counts and distinct-user counts. They do not return additional user identities.

Both public APIs derive the project from the authenticated integration key; clients cannot select another project in the query. Tenant dashboard equivalents use the authenticated admin session and account membership.

Movement-history and heatmap access are independent commercial feature entitlements. The compatibility `legacy` plan enables both so upgrading to P4A does not remove existing access.

Historical visibility is still bounded by the project's location-history retention. P4A does not create a second indefinite copy of raw location history.

See [P4A advanced geospatial](docs/P4A-ADVANCED-GEOSPATIAL.md).

## P4B geofence automation

P4B evaluates project geofences as location observations are committed. Circle and polygon definitions support enter, exit and dwell events. The geofence state transition and the location observation share one PostgreSQL transaction, while dwell events are claimed safely across multiple server instances.

Alert rules connect geofence event types to signed webhook endpoints. Production webhook targets must use HTTPS and pass public-network DNS checks before each attempt. Requests are pinned to the validated address, redirects are not followed, and endpoint signing secrets are derived from deployment-held master keys instead of being stored in plaintext.

Configure a webhook signing key ring in deployment secrets:

```text
GEOLIVE_WEBHOOK_SIGNING_KEYS_JSON=[{"kid":"2026-09","secret":"<base64url-secret-at-least-32-bytes>"}]
```

The first key signs newly created or rotated endpoint secrets. Keep older keys in the ring until every endpoint that references them has been rotated.

Webhook delivery is at least once. Failed attempts use bounded exponential backoff and eventually enter a `dead` state. Authorized tenant admins can explicitly retry a dead-letter delivery from the dashboard.

See [Integration guide](docs/INTEGRATION.md) for the event envelope, signature verification and idempotency contract.

## P4C geospatial console foundation

The tenant dashboard now renders the Earth with a self-hosted WebGL sphere and a locally served dark Earth texture. No external map/CDN token is required for the globe renderer. Live markers, clusters, historical heatmap cells and movement trails continue to use the same geographic projection so overlays remain aligned while the globe rotates or zooms.

If WebGL is unavailable or the context is lost, the existing 2D globe path remains available as a functional fallback.

GeoLive 0.12.0 adds direct geofence drawing and editing on this globe. Tenant owners/admins can start a circle or polygon from the automation console, place geometry directly on the visible Earth, undo/redraw it, finish polygons, and save through the existing project-scoped geofence API. Existing geofences are rendered as live globe overlays; paused boundaries are shown distinctly. The editor preserves the user's prior rotation pause state and uses the same sphere projection as users, clusters, heatmaps and trails.

Circle drawing uses a center click followed by an edge click and computes a geodesic radius. Polygon drawing accepts globe vertices, closes only after at least three points, and reuses the backend's existing validation and entitlement enforcement. Manual coordinate entry remains available for precision workflows.

GeoLive 0.13.0 adds an automation observability layer to the same tenant console. Geofence event history can be filtered by event type, geofence and exact user ID. Webhook delivery history can be filtered by delivery status, endpoint and originating geofence event type, with cursor pagination for older records.

Each webhook delivery can now be inspected in a project-scoped detail view that exposes endpoint/rule/event context, latest response or error state, scheduling state, the safely rendered response excerpt, and the completed attempt timeline with HTTP status, latency and failure reason. Dead-letter retries remain explicit audited mutations. Production query indexes for the new filters are created concurrently during migration.

GeoLive 0.14.0 completes the broad user-search paging UX. Text searches now render bounded 200-user pages instead of silently stopping at the first 500 matches. The globe exposes explicit Previous / Next controls, keeps an in-memory cursor stack for backwards navigation, preserves the current search page across polling/realtime refreshes, and invalidates stale requests when the project or filters change. Non-search large projects continue to use server-side geographic clustering.

The memory and PostgreSQL stores both implement the same cursor contract, and integration coverage verifies that pages do not overlap while traversing more than 500 matching users.

Trip/route analytics and export workflows remain follow-up work rather than being represented as complete.

## Production realtime

Integration readers connect to:

```text
wss://<host>/v1/realtime
```

Authenticate after open with a read key containing `events:read`. Do not put API keys in the URL.

## Retention

Run bounded cleanup from trusted scheduling infrastructure:

```bash
npm run retention
```

This cleans location history, realtime replay events, operational data, expired sessions and P2 replay nonce records according to configured policies.

## Compatibility

Existing trusted database-backed `location:write` integrations continue to work. P2, P3, P4A, P4B, the P4C console foundation, the globe geofence editor, the automation observability layer and the 0.14.0 user-search pagination UX are additive.

The `legacy` commercial plan intentionally preserves existing accounts while commercial subscriptions are introduced.

The legacy `GEOLIVE_KEYS_JSON` credential bridge remains migration-only.

## Verification

```bash
npm run check
```

CI applies all migrations and verifies PostgreSQL/PostGIS, API-key lifecycle, quotas, realtime replay, Redis fanout, P2 client security, P3 commercial controls, P4A geospatial isolation, P4B geofence/webhook validation and PostgreSQL transitions, P4E filtered automation history and delivery-attempt inspection, webhook signing/delivery behavior, dashboard asset serving, and the billing rollup worker.

See:

- [Architecture](ARCHITECTURE.md)
- [Security](SECURITY.md)
- [Integration guide](docs/INTEGRATION.md)
- [P2 client security](docs/P2-CLIENT-SECURITY.md)
- [P3 commercial layer](docs/P3-COMMERCIAL-LAYER.md)
- [P4A advanced geospatial](docs/P4A-ADVANCED-GEOSPATIAL.md)
- [P1E production realtime](docs/P1E-PRODUCTION-REALTIME.md)
- [Production roadmap](docs/PRODUCTION_ROADMAP.md)
- [OpenAPI](openapi.yaml)


## Public demo

A safe synthetic-data demo can be built without PostgreSQL or Redis:

```bash
npm run build:demo
```

Deploy `dist-demo/` to Cloudflare Pages. On `*.pages.dev`, the dashboard automatically enters read-only public demo mode. See [docs/cloudflare-pages-demo.md](docs/cloudflare-pages-demo.md) for the exact settings and safety model.
