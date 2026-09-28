# Rekixo GeoLive Architecture Contract

Status: **P1B CONTROL-PLANE FOUNDATION**

## 1. Product boundary

GeoLive is reusable infrastructure. FinWorkar, EntroNex, LudoProof, Rekixo AR3D, Rekixo websites and future products are clients/tenants, not the identity of this codebase.

No sibling repository is required to share a database, deployment, secret or source tree with GeoLive.

## 2. Non-invasive integration

Integration happens only through explicit API/SDK contracts:

- HTTPS REST API
- JavaScript SDK
- Android/Kotlin adapter
- Flutter/Dart adapter
- future webhooks/realtime SDKs

GeoLive must never read a sibling project's Firebase, D1, PostgreSQL, R2, Firestore or private application database directly.

## 3. Tenancy and control plane

```text
Account
  -> Membership (owner/admin/viewer)
  -> Project
      -> Integration Credentials
      -> Users
      -> live_user_state
      -> location_history
```

Every mutable location record is keyed by `project_id`.

Admin users do not gain access merely by knowing a project ID. Project access is derived from `account_memberships`.

## 4. Admin authentication

Admin authentication is separate from integration API keys.

- passwords: Scrypt + random salt
- sessions: opaque random token, hash at rest
- browser cookie: HttpOnly + SameSite=Strict; Secure in production
- mutations: rotating CSRF token
- login lockout: configurable failed-attempt threshold
- sessions: database-backed and revocable

There is no unauthenticated public admin-signup endpoint in P1B. The first owner is provisioned through the operator bootstrap command.

## 5. Project lifecycle

Projects are tenant data, not repositories or deployments.

Supported states:

- `active`: ingestion allowed
- `suspended`: ingestion blocked; admins may still inspect data
- `deleted`: hidden from normal admin lists; data is retained until an explicit deletion/retention process

## 6. Integration credentials

Current P1B runtime keeps the P0/P1A hashed environment credential bridge.

P1C will move generate/revoke/rotate lifecycle into the database and dashboard. Integration credentials remain separate from admin sessions.

## 7. Location model

A location update is an observation, not an identity authority.

Required:

- external user ID
- latitude
- longitude

Optional:

- accuracy
- altitude
- heading
- speed
- capture time
- city/state/country
- device/app metadata
- caller-defined safe metadata

The server records receive time independently.

## 8. Presence model

Default derived states:

- online: last seen <= 120 seconds
- recent: <= 15 minutes
- offline: <= 24 hours
- inactive: > 24 hours

Thresholds are configuration, not hard-coded tenant identity.

## 9. Durable data separation

Production uses PostgreSQL/PostGIS:

- `live_user_state`: one latest row per project/user
- `location_history`: append-only observations
- `admin_users`, `admin_sessions`, `account_memberships`: control plane
- `audit_log`: admin mutation trail

The live dashboard must not reconstruct current state by scanning full history.

## 10. Realtime

The public API-key foundation exposes Server-Sent Events. Production evolution may add authenticated project rooms with WebSocket/Redis. Admin dashboard data in P1B uses authenticated project reads with refresh polling.

## 11. Sibling-project safety

GeoLive development must not modify production code or infrastructure in sibling repositories merely to make GeoLive work. Each sibling project adopts the API/SDK independently.

## 12. Production gate

Before broad customer rollout, remaining gates include database-backed integration key lifecycle, distributed rate limits, short-lived mobile/web ingest tokens, retention jobs, realtime scale testing, privacy controls and operational monitoring.
