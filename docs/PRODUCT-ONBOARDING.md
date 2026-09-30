# GeoLive customer onboarding

GeoLive is a hosted location API product. D1 migrations, Worker deployment,
Cloudflare resources and platform secrets are operator responsibilities. They are
not repeated for every customer.

## Customer path

A tenant owner or admin uses **Quick Setup** in the GeoLive dashboard:

1. Enter a project name.
2. Choose Backend, Website, Android, iOS, Flutter or React Native.
3. GeoLive atomically creates the isolated project, default limits, integration
   profile, a `location:write` ingest key and a separate `privacy:delete` key.
4. Copy each one-time secret into trusted server secret storage.
5. Send the first location and use **Check connection**.

No tenant needs access to D1, Wrangler, Cloudflare Workers, GeoLive migrations or
the GeoLive source repository.

## Credential modes

### Backend / server

The backend can call `POST /v1/locations` directly with the generated ingest
key.

### Website

The current Cloudflare runtime uses a backend relay. The long-lived GeoLive
secret must not be embedded in browser JavaScript. The website calls its own
backend and that backend calls GeoLive.

### Android, iOS, Flutter and React Native

The current Cloudflare runtime also uses a backend relay. Long-lived GeoLive
secrets must not be shipped in APKs or app bundles.

The onboarding model already records platform and app identifier separately from
the credential mode. When Cloudflare P2 client-token exchange, proof-of-possession
and attestation are ported, those projects can migrate from `server_relay` to
`client_token` without changing their project identity or historical data.

## API key isolation

Quick Setup creates two keys because location ingestion and privacy erasure have
different blast radii:

- **Production ingest** — `location:write`
- **Privacy delete** — `privacy:delete`

The privacy scope is never mixed into an operational key. Full secrets are shown
once and only hashes are stored in D1.

## Integration metadata

`project_integrations` stores only non-secret setup metadata:

- platform
- credential mode
- app identifier, when relevant
- website origin, when relevant
- setup status and timestamps

This lets the dashboard evolve into SDK-specific guidance without coupling tenant
projects to one client technology.

## Connection verification

`GET /v1/admin/projects/:projectId/integration-setup` returns project-scoped
setup metadata, active credential prefixes and first/last received location
status. It never returns full API secrets.

## Platform upgrades vs customer onboarding

Platform upgrades may require migrations and Worker deployment once for GeoLive
itself. Existing and future tenants automatically receive the upgraded behavior.

Customer onboarding should remain:

```
Create project -> choose platform -> copy server secret -> send location -> done
```

The setup flow must not expose internal deployment steps to customers.
