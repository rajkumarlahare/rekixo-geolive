import test from "node:test";
import assert from "node:assert/strict";
import { createPgPoolFromEnv } from "../src/database.mjs";
import { PostgresAdminStore } from "../src/admin-store-postgres.mjs";
import { PostgresGeoLiveStore } from "../src/store-postgres.mjs";
import { PostgresRealtimeStore } from "../src/realtime-store-postgres.mjs";
import { hashPassword } from "../src/passwords.mjs";

const enabled = Boolean(process.env.DATABASE_URL);

test("P1E persists ordered realtime replay events and clusters users", {
  skip: enabled ? false : "DATABASE_URL not configured"
}, async () => {
  const pool = createPgPoolFromEnv();
  const adminStore = new PostgresAdminStore({ pool });
  const geoStore = new PostgresGeoLiveStore({ pool });
  const realtimeStore = new PostgresRealtimeStore({ pool });

  assert.equal(await realtimeStore.ready(), true);

  const owner = await adminStore.createInitialOwner({
    email: `rt-owner-${Date.now()}@example.com`,
    displayName: "Realtime CI Owner",
    passwordHash: await hashPassword(
      "GeoLive-Realtime-CI-Password-2026"
    ),
    accountName: "Realtime CI Account"
  });

  try {
    const project = await adminStore.createProject(owner.userId, {
      accountId: owner.accountId,
      slug: "realtime-ci-project",
      name: "Realtime CI Project"
    });

    const first = await geoStore.upsertLocation(project.id, {
      userId: "user-a",
      latitude: 21.20,
      longitude: 81.60,
      receivedAt: new Date(
        Date.now() - 1000
      ).toISOString()
    });
    const second = await geoStore.upsertLocation(project.id, {
      userId: "user-b",
      latitude: 21.25,
      longitude: 81.65,
      receivedAt: new Date().toISOString()
    });

    assert.ok(first._realtimeEvent?.sequence);
    assert.ok(second._realtimeEvent?.sequence);
    assert.equal(
      BigInt(second._realtimeEvent.sequence) >
        BigInt(first._realtimeEvent.sequence),
      true
    );

    const replay = await realtimeStore.replay(
      project.id,
      first._realtimeEvent.sequence,
      { limit: 10 }
    );
    assert.equal(replay.hasMore, false);
    assert.equal(replay.events.length, 1);
    assert.equal(replay.events[0].userId, "user-b");
    assert.equal(
      replay.events[0].sequence,
      second._realtimeEvent.sequence
    );

    await pool.query(
      `DELETE FROM realtime_events
       WHERE project_id = $1
         AND id = $2::bigint`,
      [project.id, first._realtimeEvent.sequence]
    );

    const expiredAnchor = await realtimeStore.replay(
      project.id,
      first._realtimeEvent.sequence,
      { limit: 10 }
    );
    assert.equal(expiredAnchor.resyncRequired, true);
    assert.equal(
      expiredAnchor.latestSequence,
      second._realtimeEvent.sequence
    );

    const futureAnchor = await realtimeStore.replay(
      project.id,
      String(
        BigInt(second._realtimeEvent.sequence) + 100n
      ),
      { limit: 10 }
    );
    assert.equal(futureAnchor.resyncRequired, true);

    const clusters = await geoStore.clusterUsers(project.id, {
      gridDegrees: 10
    });
    assert.equal(clusters.length >= 1, true);
    assert.equal(
      clusters.reduce((sum, item) => sum + item.count, 0),
      2
    );
    const onlineClusters =
      await geoStore.clusterUsers(
        project.id,
        {
          gridDegrees: 10,
          status: "online",
          thresholds: {
            onlineSeconds: 120,
            recentSeconds: 900,
            inactiveSeconds: 86400
          }
        }
      );
    assert.equal(
      onlineClusters.reduce(
        (sum, item) => sum + item.count,
        0
      ),
      2
    );
  } finally {
    await pool.query(
      "DELETE FROM admin_users WHERE id = $1",
      [owner.userId]
    );
    await pool.query(
      "DELETE FROM accounts WHERE id = $1",
      [owner.accountId]
    );
    await pool.end();
  }
});
