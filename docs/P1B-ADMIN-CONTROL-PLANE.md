# P1B — Admin Control Plane

Status: implemented foundation.

## Scope

P1B adds a durable, account-scoped admin layer on top of the P1A PostGIS runtime.

Implemented:

- admin users with Scrypt password hashing;
- failed-login lockout state;
- server-side admin sessions stored only as token hashes;
- HttpOnly, SameSite=Strict session cookie;
- rotating CSRF token for mutation requests;
- account memberships with owner/admin/viewer roles;
- project create, list, edit, suspend and soft-delete;
- project-scoped dashboard reads authorized through membership;
- audit records for bootstrap, login/logout and project mutations;
- bootstrap-owner CLI;
- admin login/project-management dashboard flow;
- real Postgres integration tests for role enforcement.

## Initial owner bootstrap

There is intentionally no unauthenticated public signup endpoint.

After migrations:

```bash
GEOLIVE_BOOTSTRAP_PASSWORD="use-a-strong-password" \
npm run admin:bootstrap -- admin@example.com "Admin Name" "Rekixo"
```

The password is supplied through an environment variable so it does not need to appear as a positional command-line argument.

If an existing account from P1A must be reused:

```text
GEOLIVE_BOOTSTRAP_ACCOUNT_ID=<existing-account-uuid>
```

## Session security

The browser receives an opaque random session token only through an HttpOnly cookie.

Postgres stores only SHA-256 of the session token.

State-changing calls additionally require a rotating CSRF token. The dashboard obtains a fresh CSRF token from `GET /v1/admin/me` after reload.

Default session lifetime: 12 hours.

Default failed-login lock: 5 failed attempts -> 15 minutes.

## Roles

`owner`
- project read/write
- future account/security management

`admin`
- project read/write

`viewer`
- project/dashboard read only

P1B does not yet include invitations or role-assignment UI. The schema is ready for that future control-plane work.

## Project lifecycle

Projects are data, not code deployments.

- create -> `active`
- suspend -> `suspended`
- delete -> soft-delete as `deleted`

Deletion does not destroy live/history rows. A later retention/deletion workflow can handle destructive data removal explicitly.

## API

Browser control-plane endpoints:

- `POST /v1/admin/login`
- `GET /v1/admin/me`
- `POST /v1/admin/logout`
- `GET /v1/admin/projects`
- `POST /v1/admin/projects`
- `PATCH /v1/admin/projects/:projectId`
- `DELETE /v1/admin/projects/:projectId`
- `GET /v1/admin/projects/:projectId/users`
- `GET /v1/admin/projects/:projectId/summary`

No sibling Rekixo/FinWorkar project database is queried by these endpoints.
