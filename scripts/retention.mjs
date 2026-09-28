import { createPgPoolFromEnv } from "../server/src/database.mjs";
import { PostgresOperationsStore } from "../server/src/operations-store-postgres.mjs";

const batchSize = Math.min(
  Math.max(Number(process.env.GEOLIVE_RETENTION_BATCH_SIZE || 5000), 100),
  50000
);
const maxBatches = Math.min(
  Math.max(Number(process.env.GEOLIVE_RETENTION_MAX_BATCHES || 20), 1),
  1000
);

const pool = createPgPoolFromEnv();
const store = new PostgresOperationsStore({ pool });

try {
  await store.assertReady();

  let totals = {
    batches: 0,
    historyDeleted: 0,
    securityEventsDeleted: 0,
    metricsDeleted: 0,
    realtimeEventsDeleted: 0,
    clientExchangeNoncesDeleted: 0,
    clientRequestNoncesDeleted: 0,
    rateCountersDeleted: 0,
    sessionsDeleted: 0
  };

  for (let index = 0; index < maxBatches; index += 1) {
    const result = await store.runRetentionBatch({ batchSize });
    totals.batches += 1;

    for (const key of [
      "historyDeleted",
      "securityEventsDeleted",
      "metricsDeleted",
      "realtimeEventsDeleted",
      "clientExchangeNoncesDeleted",
      "clientRequestNoncesDeleted",
      "rateCountersDeleted",
      "sessionsDeleted"
    ]) {
      totals[key] += result[key];
    }

    if (
      result.historyDeleted < batchSize &&
      result.securityEventsDeleted < batchSize &&
      result.metricsDeleted < batchSize &&
      result.realtimeEventsDeleted < batchSize &&
      result.clientExchangeNoncesDeleted < batchSize &&
      result.clientRequestNoncesDeleted < batchSize
    ) {
      break;
    }
  }

  console.log(JSON.stringify({ ok: true, ...totals }, null, 2));
} finally {
  await pool.end();
}
