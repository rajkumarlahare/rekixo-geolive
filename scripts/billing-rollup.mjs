import { createPgPoolFromEnv } from "../server/src/database.mjs";
import { PostgresCommercialStore } from "../server/src/commercial-store-postgres.mjs";

function monthBounds(offset = 0) {
  const now = new Date();
  const start = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth() + offset,
    1
  ));
  const end = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth() + offset + 1,
    1
  ));
  return {
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10)
  };
}

const mode = String(process.argv[2] || "current").toLowerCase();
if (!["current", "previous"].includes(mode)) {
  console.error("Usage: npm run billing:rollup -- current|previous");
  process.exit(1);
}

const bounds = monthBounds(mode === "previous" ? -1 : 0);
const finalize = mode === "previous";
const pool = createPgPoolFromEnv();
const store = new PostgresCommercialStore({ pool });

try {
  await store.assertReady();
  const accounts = await pool.query(
    "SELECT id FROM accounts ORDER BY id"
  );

  const results = [];
  for (const row of accounts.rows) {
    const snapshot = await store.snapshotUsage(
      row.id,
      {
        ...bounds,
        finalize
      }
    );
    results.push({
      accountId: row.id,
      metrics: snapshot.metrics,
      finalized: snapshot.finalized
    });
  }

  console.log(JSON.stringify({
    ok: true,
    mode,
    ...bounds,
    accounts: results.length,
    results
  }, null, 2));
} finally {
  await pool.end();
}
