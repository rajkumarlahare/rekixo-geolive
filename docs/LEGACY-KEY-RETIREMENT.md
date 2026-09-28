# Legacy API-Key Retirement

The environment-backed `GEOLIVE_KEYS_JSON` bridge exists only to avoid an outage while pre-P1C integrations migrate.

For every project:

1. Generate a database-backed `location:write` key.
2. Generate a separate database-backed read key if the project needs read APIs.
3. Put new secrets only in the consuming system's secret store.
4. Roll out the consuming project independently.
5. Confirm requests appear in GeoLive operational metrics and the database key shows recent use.
6. Stop the old environment credential.
7. Observe for a safe migration window.
8. Remove the old entry from `GEOLIVE_KEYS_JSON`.

When all projects are migrated, remove the environment variable from the GeoLive deployment. A later release can delete the compatibility authentication branch.

Never rotate all projects at once unless a credential compromise requires emergency revocation.
