# P4A — Advanced Geospatial Reads

Status: implemented foundation.

## Purpose

P4A adds historical location exploration without weakening GeoLive's project isolation or creating an unbounded analytics store.

It implements two capabilities:

- cursor-paginated movement history for one project user;
- server-side historical heatmap aggregation.

Geofences, alerts and outbound webhooks are intentionally deferred to P4B.

## Data source

Both capabilities read the existing `location_history` table.

P4A adds indexes for:

```text
(project_id, received_at DESC, id DESC)
(project_id, external_user_id, received_at DESC, id DESC)
```

Migration 008 is explicitly marked nontransactional so these indexes are built with `CREATE INDEX CONCURRENTLY`, avoiding a long write lock on an existing production history table. The migration runner only splits files that opt in with the GeoLive nontransactional marker; each split statement in such a migration must be retry-safe/idempotent.

No sibling-project database is accessed and no second raw-location copy is created.

## Authorization

Public integration APIs use a dedicated read scope:

```text
history:read
```

A normal production read key may contain:

```text
users:read
history:read
summary:read
events:read
```

The authenticated key supplies the project ID. A caller cannot choose another project through query parameters.

Tenant dashboard routes use the existing secure admin session and project membership checks.

## Commercial feature gates

P4A adds two effective entitlement keys:

- `movementHistory`
- `heatmap`

They can be supplied by a plan or overridden per account. A `null` override restores plan inheritance.

Migration 008 enables both flags on the compatibility `legacy` plan so existing accounts are not silently denied after the migration.

## Movement history API

Public:

```http
GET /v1/history
```

Admin:

```http
GET /v1/admin/projects/:projectId/history
```

Query fields:

- `userId` — required, maximum 160 characters;
- `from` — optional ISO timestamp;
- `to` — optional ISO timestamp;
- `limit` — 1–1,000, default 250;
- `cursor` — optional opaque pagination cursor.

When no time range is supplied, the API reads the previous 24 hours ending at the request time. A requested window may not exceed 31 days.

Results are newest-first using stable ordering:

```text
received_at DESC, id DESC
```

The cursor preserves those two ordering fields.

## Historical heatmap API

Public:

```http
GET /v1/heatmap
```

Admin:

```http
GET /v1/admin/projects/:projectId/heatmap
```

Query fields:

- `from`, `to` — same bounded history window;
- `gridDegrees` — 0.25–45, default 2;
- `userId` — optional project-user filter.

A cell contains:

```text
latitude
longitude
count
uniqueUsers
firstSeenAt
lastSeenAt
```

The API returns at most 10,000 aggregate cells per request.

## Retention boundary

P4A does not override P1D retention.

If a project keeps location history for 7 days, asking P4A for 30 days can only return retained rows from those 7 days. Billing's separate tracked-user meter remains independent and is not used to reconstruct movement history.

## Dashboard

The live globe adds a History Analytics area:

- 1h / 6h / 24h / 7d / 30d range selection;
- historical heatmap overlay;
- per-user movement trail overlay;
- clear-overlay action.

The movement trail currently renders the newest 1,000 points in the selected window and reports when another cursor page exists.

## Failure model

Relevant machine-readable errors include:

```text
missing_credential
invalid_credential
insufficient_scope
subscription_not_active
feature_not_entitled
user_id_required
invalid_history_from
invalid_history_to
invalid_history_window
history_window_too_large
invalid_history_limit
invalid_heatmap_grid
invalid_cursor
rate_limited
```

## Verification targets

P4A tests cover:

- query validation and 31-day bounding;
- memory-store project/user isolation;
- cursor pagination;
- memory heatmap aggregation;
- PostgreSQL project/user history isolation;
- PostgreSQL cursor pagination;
- PostgreSQL heatmap project isolation;
- legacy-plan movement-history/heatmap entitlement compatibility.

## Next

P4B should add geofence definitions, enter/exit/dwell evaluation, alert rules, signed outbound webhooks, retry/idempotency state and dead-letter handling.
