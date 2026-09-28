# P1D — Security and Operations

Status: implemented foundation.

## Distributed rate limits

GeoLive uses PostgreSQL atomic fixed-window counters so multiple application instances share the same project limit.

Default project limits:

- ingest: 600 requests/minute
- read: 300 requests/minute
- daily ingest quota: 1,000,000 requests
- live users: 100,000
- history retention: 30 days
- security-event retention: 90 days
- metrics retention: 90 days

The Admin dashboard can edit these per project.

Rate-limit responses use HTTP 429 and expose:

- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`
- `Retry-After` when blocked

Rate counters use PostgreSQL time, not application-instance clocks.

## Quotas

Daily ingest quota is consumed atomically in PostgreSQL.

The live-user quota is enforced inside the location write transaction. New-user quota checks use a project-scoped PostgreSQL advisory transaction lock so concurrent first-seen users cannot race past the configured limit.

Existing users can continue updating location after the live-user cap is reached.

## Cursor pagination

`GET /v1/users` and the admin project-users endpoint support:

```text
?limit=100&cursor=<opaque-cursor>
```

Response:

```json
{
  "users": [],
  "nextCursor": "..."
}
```

Ordering is stable by latest receive time and external user ID. Cursors are opaque client state, not authorization credentials.

Security-event listing also uses cursor pagination.

## Security events

Project-scoped security events include:

- rate-limit blocks
- daily-ingest quota blocks
- live-user quota blocks
- origin restriction failures
- package restriction failures

Admin-login failures and login rate-limit events are also recorded without storing raw passwords, tokens or raw network addresses.

## Operational metrics

Hourly project metrics aggregate:

- request count
- error count / error rate
- average and maximum request latency
- route
- daily ingest/read usage
- recent project security-event totals

Raw API secrets, location payloads and exact coordinates are not copied into metrics.

## Retention

Run the one-shot retention worker from a trusted scheduler:

```bash
npm run retention
```

Optional controls:

```text
GEOLIVE_RETENTION_BATCH_SIZE=5000
GEOLIVE_RETENTION_MAX_BATCHES=20
```

The worker deletes in bounded batches:

- location history older than each project's retention policy
- security events older than policy
- hourly metrics older than policy
- expired rate-limit counters
- old daily usage counters
- expired/revoked admin sessions

Each run writes a `retention_runs` operational record.

The application server does not auto-run destructive retention on startup.

## Admin operations API

Authenticated account members may read:

- `GET /v1/admin/projects/:projectId/operations/limits`
- `GET /v1/admin/projects/:projectId/operations/metrics`
- `GET /v1/admin/projects/:projectId/operations/security-events`

Owner/admin may update:

- `PATCH /v1/admin/projects/:projectId/operations/limits`

## Legacy environment key bridge

P1C's `GEOLIVE_KEYS_JSON` compatibility path remains readable for migration safety.

Retirement procedure:

1. create database-backed ingest/read keys for every project;
2. migrate each consuming app/backend;
3. verify database-key `lastUsedAt` and operational metrics;
4. revoke/stop using legacy credentials;
5. remove `GEOLIVE_KEYS_JSON` from deployment configuration;
6. only then remove the compatibility code in a later release.

Do not create new production integrations on the legacy bridge.
