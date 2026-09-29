import test from "node:test";
import assert from "node:assert/strict";
import { createPgPoolFromEnv } from "../src/database.mjs";
import { PostgresGeoLiveStore } from "../src/store-postgres.mjs";

const enabled = Boolean(process.env.DATABASE_URL);

test("Postgres store persists and isolates project live state", {
  skip: enabled ? false : "DATABASE_URL not configured"
}, async () => {
  const pool = createPgPoolFromEnv();
  const store = new PostgresGeoLiveStore({ pool });

  assert.equal(await store.ready(), true);

  const account = await pool.query(
    "INSERT INTO accounts (name) VALUES ('GeoLive CI') RETURNING id"
  );

  const a = await pool.query(
    "INSERT INTO projects (account_id, slug, name) VALUES ($1, 'ci-a', 'CI A') RETURNING id",
    [account.rows[0].id]
  );
  const b = await pool.query(
    "INSERT INTO projects (account_id, slug, name) VALUES ($1, 'ci-b', 'CI B') RETURNING id",
    [account.rows[0].id]
  );

  const now = new Date().toISOString();

  try {
    await store.upsertLocation(a.rows[0].id, {
      userId: "same-user",
      latitude: 21.2514,
      longitude: 81.6296,
      accuracyM: 10,
      receivedAt: now,
      capturedAt: now,
      city: "Raipur",
      state: "Chhattisgarh",
      country: "India",
      device: { platform: "test" }
    });

    await store.upsertLocation(b.rows[0].id, {
      userId: "same-user",
      latitude: 28.6139,
      longitude: 77.2090,
      accuracyM: 15,
      receivedAt: now,
      capturedAt: now,
      city: "Delhi",
      state: "Delhi",
      country: "India",
      device: { platform: "test" }
    });

    const usersA = await store.listUsers(a.rows[0].id);
    const usersB = await store.listUsers(b.rows[0].id);

    assert.equal(usersA.length, 1);
    assert.equal(usersB.length, 1);
    assert.equal(usersA[0].city, "Raipur");
    assert.equal(usersB[0].city, "Delhi");
    assert.equal(await store.historyCount(a.rows[0].id), 1);
    assert.equal(await store.historyCount(b.rows[0].id), 1);

    const summaryA = await store.summary(a.rows[0].id);
    assert.equal(summaryA.total, 1);
    assert.equal(summaryA.online, 1);
    assert.equal(summaryA.todayActive, 1);

    const facetsA =
      await store.locationFacets(
        a.rows[0].id
      );
    assert.deepEqual(
      facetsA.countries,
      ["India"]
    );
    assert.deepEqual(
      facetsA.states,
      ["Chhattisgarh"]
    );
    assert.deepEqual(
      facetsA.cities,
      ["Raipur"]
    );
  } finally {
    await pool.query("DELETE FROM accounts WHERE id = $1", [account.rows[0].id]);
    await store.close();
  }
});
