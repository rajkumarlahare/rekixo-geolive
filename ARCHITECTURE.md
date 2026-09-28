# Rekixo GeoLive Architecture Contract

Status: **P1D SECURITY & OPERATIONS FOUNDATION**

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
      -> usage/security operational data
```

## Authentication boundaries

Admin authentication and integration-key authentication remain separate.

Integration project identity is resolved from the authenticated credential. Admin project access is resolved from account membership.

## Durable data

PostgreSQL/PostGIS stores:

- accounts/projects/memberships
- admin users/sessions
- integration key metadata/hashes
- project limits
- live user state
- append-only location history
- distributed rate counters
- daily usage counters
- hourly API metrics
- project/global security events
- retention-run records
- audit log

## P1D rate limiting

Fixed-window counters are incremented atomically in PostgreSQL. Window boundaries use PostgreSQL time, so multiple server instances share one project limit without relying on each instance clock.

This is deliberately database-backed at current scale. A later high-throughput deployment may move hot counters to Redis while retaining the same API semantics.

## Quota enforcement

Daily ingest quota is atomic in PostgreSQL.

Live-user capacity is enforced inside the location transaction. Only first-seen users acquire a project-scoped advisory transaction lock for quota checking; existing user updates avoid that serialization.

## Pagination

Latest users are ordered by:

1. `received_at DESC`
2. `external_user_id DESC`

The opaque cursor contains only continuation state. Project authorization and filters are still enforced by the server.

## Metrics and security events

Operational metrics aggregate by project/key/route/hour and status class.

Security events are separate from the immutable admin audit trail:

- audit log = authorized administrative changes
- security events = denied/risky operational signals

Neither table stores raw API secrets or location payloads.

## Retention

The retention worker runs outside normal request handling and deletes bounded batches according to project retention policy.

Startup never automatically executes destructive retention.

## Compatibility

The legacy environment-key bridge remains readable only for migration safety. New credentials are database-backed. Follow the documented staged retirement procedure before deleting compatibility code.

## Next boundary

P1E adds scaled realtime transport: authenticated project rooms, reconnect/resume, backpressure and Redis fanout where multi-instance scale requires it.
