# Rekixo GeoLive Architecture Contract

Status: **P2 CLIENT SECURITY FOUNDATION**

## Product boundary

GeoLive is reusable infrastructure. FinWorkar, EntroNex, LudoProof, Rekixo AR3D, Rekixo websites and future products are clients/tenants.

No sibling repository must share a database, deployment, secret or source tree with GeoLive.

## Control/data model

```text
Account
  -> Membership (owner/admin/viewer)
  -> Project
      -> Integration API Keys
          -> tokens:issue issuer key
      -> Client Security Policy
      -> client exchange nonces
      -> client request nonces
      -> Users
      -> live_user_state
      -> location_history
      -> realtime_events
      -> usage/security operational data
```

## P2 trust split

Long-lived secrets stay on trusted infrastructure.

```text
User/App
   -> product backend authenticates its own user
   -> product backend calls GeoLive token exchange
        Authorization: trusted tokens:issue key

GeoLive
   -> verifies package/origin/policy
   -> optionally verifies Play Integrity
   -> issues short-lived rgl_client_ token
      bound to project + user + package + platform + proof key

User/App
   -> signs each location request with P-256 proof key
   -> POST /v1/locations
        Bearer rgl_client_...
        timestamp + nonce + signature
```

GeoLive never needs direct access to the product's user database. The product backend decides which authenticated product user may request a GeoLive client token.

## Client token signing

Client tokens use a server-side signing key ring.

- first configured key signs;
- all configured keys verify;
- `kid` selects the verification key;
- each token has an opaque UUID `jti`;
- token lifetime is capped at one hour.

The token records the database issuer API-key ID. Authentication rechecks that issuer in PostgreSQL, so issuer revocation propagates to active short-lived tokens.

## Proof-of-possession

A short-lived token may be bound to an EC P-256 SubjectPublicKeyInfo public key.

The exact raw location JSON is SHA-256 hashed into the request canonical string. The server verifies the ECDSA signature and then atomically consumes a per-token request nonce.

Timestamp freshness plus nonce uniqueness prevents accepted requests from being replayed inside or outside the ordinary request path.

## Android attestation

Android Play Integrity is a project policy, not a global forced dependency.

The client obtains a standard Integrity token using a requestHash supplied by the GeoLive exchange binding. A trusted backend forwards that token to the GeoLive exchange endpoint.

GeoLive uses a Google service account to decode the token, then checks package, requestHash, timestamp, app recognition, configured device verdicts and optional licensing verdict.

Projects can migrate gradually:

```text
off -> optional -> required
```

## Durable location write path

After client authentication/proof succeeds, the existing P1D ingest controls run. For PostgreSQL persistence, an accepted update transaction writes:

1. user identity/upsert;
2. latest live state;
3. append-only location history;
4. durable realtime event.

The P1E realtime and Redis fanout model remains unchanged.

## Client-security persistence

PostgreSQL stores only policy and replay-control state:

- `project_client_security`
- hashed `client_exchange_nonces`
- hashed `client_request_nonces`

Expired nonce records are removed by the bounded retention worker.

## SDK boundary

GeoLive SDK adapters accept either legacy/static ingest credentials or a token provider. Request proof is supplied through platform-specific proof callbacks/helpers, so client apps can keep private-key operations in their platform keystore/security layer.

Android includes the exact GeoLive requestHash/canonical helpers needed to bind Play Integrity and request proof without making Play libraries mandatory for every project.

## Compatibility

Database-backed long-lived keys remain available for trusted integrations. Client-token security is additive.

SSE and P1E WebSocket read paths remain independent of the P2 ingest-token flow.

## Next boundary

The next roadmap layer is commercial operations: plans, entitlements, billable usage, invoices/support and super-admin controls.
