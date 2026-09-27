# Rekixo GeoLive Security Rules

Location data is sensitive. GeoLive defaults to least privilege and explicit consent.

- Never embed dashboard/admin credentials in Android, Flutter, browser bundles, GitHub, screenshots, logs or analytics.
- Bind every credential to exactly one project and explicit scopes.
- Production stores credential hashes, not raw long-lived secrets.
- Use separate ingestion and administration credentials.
- Prefer short-lived client ingest tokens for browser/mobile production usage.
- The host application owns permission prompts and must explain why location is collected.
- Background location must never be enabled implicitly.
- Never trust a client-supplied `projectId` as the authorization boundary.
- Every database read/write must include `project_id`.
- Production browser access uses explicit origin allowlists; CORS is an extra control, not authentication.
- Validate latitude/longitude and bound optional numeric/text/metadata fields.
- Do not log raw API credentials. Avoid exact-coordinate logging outside approved protected data stores.
- Apply project/plan retention to location history.

The current in-memory foundation is not a production data store and must not be used for real customer tracking.
