# Sibling Repository Safety

The GeoLive foundation was designed after read-only inspection of the owner's current repositories.

Rules:

- do not modify sibling repositories while building GeoLive;
- do not couple GeoLive to sibling databases;
- do not reuse sibling production secrets;
- do not change sibling Cloudflare/Firebase resources;
- do not require sibling deployment for GeoLive to deploy;
- integrate later through explicit API/SDK contracts.

This keeps GeoLive usable across present and future products while allowing each project to adopt it independently.
