# P3 — Commercial Layer

Status: implemented foundation.

## Purpose

P3 adds the account-level SaaS control plane needed to package GeoLive commercially without coupling it to a specific payment provider.

It covers plans, effective entitlements, usage metering, invoices, tenant support workflows and cross-account platform administration.

## Data model

Migration `007_commercial_layer.sql` adds:

- `commercial_plans`
- `account_subscriptions`
- `account_entitlement_overrides`
- `billing_usage_periods`
- `billing_invoices`
- `billing_invoice_items`
- `platform_roles`
- `support_cases`
- `support_case_messages`

Existing accounts are assigned the `legacy` plan. A database trigger assigns the same default to future accounts.

## Plans and entitlements

Plan configuration supports:

- currency
- monthly price in minor units
- included ingest
- included read
- included tracked users
- maximum projects
- ingest/read overage price per 1,000
- tracked-user overage price
- feature flags

Account entitlement overrides take precedence over plan defaults for supported limit/feature keys.

Current enforced entitlements include project count, public integration realtime, P2 client tokens and Android attestation.

## Subscription states

Subscriptions support:

```text
trialing
active
past_due
canceled
```

New project creation and entitled P2 features require an active or trialing subscription.

The legacy plan is intentionally broad so P3 does not break existing installations on migration.

## Metering

`billing:rollup` materializes account usage by calendar period:

```bash
npm run billing:rollup -- current
npm run billing:rollup -- previous
```

Current-period snapshots may refresh. Previous-period rollup finalizes the row.

Once finalized, the stored usage metrics stay frozen even if operational tables later change.

Authoritative billable fields currently include ingest requests, read requests and distinct tracked users.

Tracked users are written into a dedicated daily billing meter by a PostgreSQL trigger in the same transaction as location-history insertion. This keeps the billing basis independent of the shorter location-history/realtime retention windows. Migration 007 also best-effort backfills the current calendar month from retained history.

## Invoice engine

A platform billing/superadmin operator may generate a draft invoice for an account and period.

The server:

1. finalizes/reads the usage snapshot;
2. loads subscription plan and effective entitlement allowances;
3. calculates base monthly price;
4. calculates configured overages;
5. writes invoice and line items atomically.

Invoice statuses:

```text
draft -> open -> paid
              -> uncollectible

draft/open -> void
```

Paid and void invoices are treated as final by the status updater.

Multi-currency platform summaries remain separated by currency.

## Payment-provider boundary

P3 does not charge customers.

Fields for provider customer/subscription/invoice references are intentionally generic so a later Stripe/Razorpay/other adapter can attach without changing the core tenant/billing model.

Do not store provider secret keys or payment card/bank credentials in these tables.

## Tenant APIs

Account members can access:

- `GET /v1/admin/accounts/:accountId/commercial`
- `GET /v1/admin/accounts/:accountId/invoices`
- `GET /v1/admin/accounts/:accountId/support-cases`
- `POST /v1/admin/accounts/:accountId/support-cases`
- support-case message read/reply routes

The dashboard exposes account plan/subscription/usage, invoices and support case creation.

## Platform roles

Grant an existing admin user an explicit cross-account platform role:

```bash
npm run platform:grant -- admin@example.com superadmin
```

Roles:

- `superadmin`: full P3 controls
- `billing`: subscription/invoice operations
- `support`: support queue operations
- `viewer`: cross-account read-only

The platform role is separate from account owner/admin/viewer membership.

## Platform API

P3 exposes platform endpoints for:

- overview
- plan list/create/update
- account/subscription list/update
- entitlement overrides
- invoice generation/status
- support queue/messages/status/priority/assignment

All mutations use the existing admin CSRF protection and write audit records where business state changes.

## Support workflow

Tenant messages are public to that tenant case.

Platform replies may be public or `internal=true`. Internal messages are excluded from tenant reads.

Cases support priority, category, assignment and status transitions.

## Dashboard

The existing dashboard now includes:

- **Billing & Support** for tenant accounts
- **Commercial Console** for users with a platform role

The platform console exposes plan creation, account subscription management, previous-month invoice generation and support queue actions.

## Operations

Recommended production scheduling:

- run `npm run billing:rollup -- current` periodically during a month;
- run `npm run billing:rollup -- previous` after month close;
- review/finalize invoice workflow through the platform control plane;
- keep payment collection outside GeoLive until a dedicated provider adapter is deployed.

## Verification

P3 integration tests exercise:

- legacy-plan assignment
- platform-role authorization
- plan creation
- subscription assignment
- entitlement override resolution
- project-count enforcement
- usage aggregation
- invoice/overage calculation
- finalized usage immutability
- support-case privacy for internal notes
- invoice paid transition
- platform overview

CI also runs the billing rollup CLI against migrated PostgreSQL/PostGIS.
