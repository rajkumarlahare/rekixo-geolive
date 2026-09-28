import { MemoryGeoLiveStore } from "./store-memory.mjs";
import { createPgPool } from "./database.mjs";
import { PostgresGeoLiveStore } from "./store-postgres.mjs";

export async function createConfiguredStore(config) {
  if (config.persistence === "postgres") {
    const pool = createPgPool({
      url: config.database.url,
      sslMode: config.database.sslMode,
      maxPoolSize: config.database.maxPoolSize
    });
    return new PostgresGeoLiveStore({ pool });
  }

  if (config.isProduction) {
    throw new Error("Production requires GEOLIVE_PERSISTENCE=postgres with DATABASE_URL.");
  }

  return new MemoryGeoLiveStore();
}
