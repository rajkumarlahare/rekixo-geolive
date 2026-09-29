# Rekixo GeoLive Architecture Contract

Status: **P4C PRODUCT-GRADE GEOSPATIAL CONSOLE**

## Runtime boundary

GeoLive 0.17.0 introduces a Cloudflare-native production runtime:

```text
Worker
  -> D1 durable data
  -> Durable Object realtime rooms
  -> Queue webhook delivery
  -> Cron dwell/retention jobs
  -> Worker Static Assets dashboard
```

The existing Node/PostgreSQL/PostGIS/Redis runtime remains a compatibility and
reference implementation during the Cloudflare port. The two runtimes must not
write to one production dataset.

Cloudflare parity currently covers core admin sessions/projects/API keys,
location ingestion, live users/search/clusters, history/heatmaps, operations
limits, geofences, signed webhook automation and WebSocket realtime. Short-lived
client tokens/Play Integrity and the commercial/support/platform plane still use
the legacy runtime until their Cloudflare phases land.

## Product boundary

GeoLive is reusable infrastructure. FinWorkar, EntroNex, LudoProof, Rekixo AR3D, Rekixo websites and future products are clients/tenants.

No sibling repository must share a database, deployment, secret or source tree with GeoLive.

## Control/data model

```text
Account
  -> Membership (owner/admin/viewer)
  -> Subscription -> Commercial Plan
  -> Entitlement Overrides
  -> Billing Usage Periods
  -> Invoices -> Invoice Items
  -> Support Cases -> Messages
  -> Project
      -> Integration API Keys
          -> tokens:issue issuer key
      -> Client Security Policy
      -> client exchange/request nonces
      -> Users
      -> live_user_state
      -> location_history
          -> movement-history reads
          -> historical heatmap aggregation
      -> realtime_events
      -> usage/security operational data

Admin User
  -> optional Platform Role
     superadmin | billing | support | viewer
```

Tenant account roles and GeoLive platform roles are separate authorization planes.

## P2 client trust split

Long-lived secrets stay on trusted infrastructure.

A product backend authenticates its own user, exchanges a database-backed `tokens:issue` key for a short-lived `rgl_client_...` token, and the client signs location writes with its proof key when required.

GeoLive does not need direct access to the product's user database.

## P3 commercial model

Commercial state is owned by the GeoLive account, not by individual projects.

A commercial plan contains reusable price/allowance/feature defaults. `account_subscriptions` selects the plan and period/status. `account_entitlement_overrides` changes only explicitly overridden effective values.

Existing accounts migrate onto a generous `legacy` plan. A database trigger also assigns that plan to newly-created accounts, avoiding accidental breakage before commercial onboarding.

### Entitlement enforcement

P3 currently enforces:

- maximum active/non-deleted projects at project creation;
- `realtime` for public integration SSE/WebSocket readers;
- `movementHistory` for retained movement-history reads;
- `heatmap` for retained historical heatmap aggregation;
- `clientTokens` before P2 short-lived token exchange;
- `androidAttestation` when Android attestation is supplied.

Existing trusted long-lived location ingestion remains compatible. Subscription rollout does not silently disable existing legacy integrations.

## P4A historical read model

P4A reads from the same project-scoped append-only `location_history` written by normal ingestion. It does not introduce a cross-product analytics database or a second indefinite raw-location archive.

Movement-history queries require one external user ID and a bounded time window. PostgreSQL orders by `received_at DESC, id DESC` and uses an opaque cursor containing those stable ordering fields. The query always includes `project_id`, so the same external user ID in another project remains isolated.

Historical heatmaps aggregate `location_history` server-side into latitude/longitude grid cells. Cells expose counts and distinct-user totals rather than expanding represented identities.

Public historical reads use the dedicated `history:read` API-key scope. Admin historical reads use the existing authenticated admin session and project membership. Both paths apply the account's P4A feature entitlements.

The API limits a single historical query window to 31 days. Actual available history may be shorter because P1D location-history retention remains authoritative.

## Metering and invoice boundary

Operational usage remains the source of truth. P3 snapshots account usage into `billing_usage_periods` for a calendar period.

The authoritative billable metering model currently includes:

- ingest requests from the long-retained daily usage counter;
- read requests from the long-retained daily usage counter;
- distinct tracked users from a dedicated daily billing meter.

Tracked-user membership is written transactionally by a PostgreSQL trigger when location history is inserted, so normal location-history/realtime retention does not erase the billing basis. The migration backfills the current calendar month on rollout.

Finalized usage snapshots are immutable from later rollups.

Invoice generation uses the effective entitlement allowances plus the plan's prices. The invoice ledger is provider-neutral; no external card/bank charge is performed by P3.

Revenue summaries are grouped by currency. GeoLive does not add USD, INR or other currencies into a single meaningless total.

## Platform control plane

The existing secure admin session is reused, but cross-account access requires a separate row in `platform_roles`.

- `superadmin`: plans, entitlements, subscriptions, invoices, support.
- `billing`: subscription and invoice operations plus read access.
- `support`: support queue/update/replies plus read access.
- `viewer`: cross-account read-only commercial/support views.

Platform role assignment is an explicit CLI/bootstrap operation.

## Support isolation

Tenant support routes first resolve account membership. Tenant message reads exclude `internal=true` messages.

Platform support roles can read internal notes and update status/priority/assignment.

## Durable location write path

In the Cloudflare runtime, a restricted integration key resolves the project,
D1 enforces project/quota state, and one D1 batch writes user identity, latest
live state, append-only history and a durable realtime event. The event is then
broadcast to that project's Durable Object room. Geofence transitions persist in
D1 and schedule signed webhook jobs onto Cloudflare Queues.

In the legacy runtime, the equivalent durable write path remains
PostgreSQL/PostGIS plus Redis fanout.

## Next boundary

The remaining P4C product boundary is route/trip analytics plus export workflows. The durable geospatial, realtime, geofence automation, webhook observability and commercial foundations are already in place.

External payment collection, tax calculation, refunds/credits and customer checkout are deliberately left for a future payment-provider layer.
