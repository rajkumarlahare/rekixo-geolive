# Rekixo GeoLive

**Rekixo GeoLive** is project-neutral live-location infrastructure for Android apps, Flutter apps, websites, trusted backends and future Rekixo products.

> Products integrate through GeoLive API/SDK contracts. GeoLive does not read sibling-project private databases or require sibling repositories to share deployments, secrets or source trees.

## Current implementation

P0 through P3 now provide:

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
- feature flags such as realtime, client tokens, Android attestation and priority support

Account-specific entitlement overrides can change limits/features without mutating the shared plan.

Project creation is checked against the account's effective `maxProjects`. P2 client-token exchange and Android attestation are checked against their feature entitlements.

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

Platform-role users get a separate commercial console for plans, subscriptions, invoice generation and support queue operations. Internal support notes are never returned through tenant message APIs.

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

Existing trusted database-backed `location:write` integrations continue to work. P2 and P3 are additive.

The `legacy` commercial plan intentionally preserves existing accounts while commercial subscriptions are introduced.

The legacy `GEOLIVE_KEYS_JSON` credential bridge remains migration-only.

## Verification

```bash
npm run check
```

CI applies all migrations and verifies PostgreSQL/PostGIS, API-key lifecycle, quotas, realtime replay, Redis fanout, P2 client security, P3 plans/entitlements/metering/invoices/support and the billing rollup worker.

See:

- [Architecture](ARCHITECTURE.md)
- [Security](SECURITY.md)
- [Integration guide](docs/INTEGRATION.md)
- [P2 client security](docs/P2-CLIENT-SECURITY.md)
- [P3 commercial layer](docs/P3-COMMERCIAL-LAYER.md)
- [P1E production realtime](docs/P1E-PRODUCTION-REALTIME.md)
- [Production roadmap](docs/PRODUCTION_ROADMAP.md)
- [OpenAPI](openapi.yaml)
