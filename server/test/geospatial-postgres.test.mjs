import test from "node:test";
import assert from "node:assert/strict";
import { createPgPoolFromEnv } from "../src/database.mjs";
import { PostgresGeoLiveStore } from "../src/store-postgres.mjs";
import { PostgresCommercialStore } from "../src/commercial-store-postgres.mjs";

const enabled = Boolean(
  process.env.DATABASE_URL
);

test("P4A Postgres movement history and heatmap stay project scoped", {
  skip: enabled
    ? false
    : "DATABASE_URL not configured"
}, async () => {
  const pool = createPgPoolFromEnv();
  const store =
    new PostgresGeoLiveStore({
      pool
    });
  const commercialStore =
    new PostgresCommercialStore({
      pool
    });

  assert.equal(
    await store.ready(),
    true
  );
  assert.equal(
    await commercialStore.ready(),
    true
  );

  const stamp = Date.now();
  const account =
    await pool.query(
      "INSERT INTO accounts (name) VALUES ($1) RETURNING id",
      [`P4A CI ${stamp}`]
    );
  const accountId =
    account.rows[0].id;

  const firstProject =
    await pool.query(
      `INSERT INTO projects (
        account_id,
        slug,
        name
      ) VALUES ($1,$2,$3)
      RETURNING id`,
      [
        accountId,
        `p4a-ci-a-${stamp}`,
        "P4A CI A"
      ]
    );
  const secondProject =
    await pool.query(
      `INSERT INTO projects (
        account_id,
        slug,
        name
      ) VALUES ($1,$2,$3)
      RETURNING id`,
      [
        accountId,
        `p4a-ci-b-${stamp}`,
        "P4A CI B"
      ]
    );

  const projectA =
    firstProject.rows[0].id;
  const projectB =
    secondProject.rows[0].id;

  try {
    const entitlements =
      await commercialStore
        .getEffectiveEntitlements(
          accountId
        );
    assert.equal(
      entitlements.plan.code,
      "legacy"
    );
    assert.equal(
      entitlements.effective
        .movementHistory,
      true
    );
    assert.equal(
      entitlements.effective.heatmap,
      true
    );

    const points = [
      [
        "2026-09-28T00:00:00.000Z",
        21.2500,
        81.6200
      ],
      [
        "2026-09-28T00:01:00.000Z",
        21.2600,
        81.6300
      ],
      [
        "2026-09-28T00:02:00.000Z",
        21.2700,
        81.6400
      ]
    ];

    for (
      const [
        receivedAt,
        latitude,
        longitude
      ] of points
    ) {
      await store.upsertLocation(
        projectA,
        {
          userId: "tracked-user",
          latitude,
          longitude,
          receivedAt,
          capturedAt: receivedAt
        }
      );
    }

    await store.upsertLocation(
      projectA,
      {
        userId: "other-user",
        latitude: 21.28,
        longitude: 81.65,
        receivedAt:
          "2026-09-28T00:01:30.000Z"
      }
    );

    await store.upsertLocation(
      projectB,
      {
        userId: "tracked-user",
        latitude: 30,
        longitude: 70,
        receivedAt:
          "2026-09-28T00:01:30.000Z"
      }
    );

    const firstPage =
      await store
        .listMovementHistoryPage(
          projectA,
          {
            userId:
              "tracked-user",
            from:
              "2026-09-28T00:00:00.000Z",
            to:
              "2026-09-28T01:00:00.000Z",
            limit: 2
          }
        );

    assert.equal(
      firstPage.points.length,
      2
    );
    assert.equal(
      firstPage.points[0]
        .receivedAt,
      "2026-09-28T00:02:00.000Z"
    );
    assert.equal(
      firstPage.points.every(
        (point) =>
          point.projectId ===
            projectA &&
          point.userId ===
            "tracked-user"
      ),
      true
    );
    assert.ok(
      firstPage.nextCursor
    );

    const secondPage =
      await store
        .listMovementHistoryPage(
          projectA,
          {
            userId:
              "tracked-user",
            from:
              "2026-09-28T00:00:00.000Z",
            to:
              "2026-09-28T01:00:00.000Z",
            limit: 2,
            cursor:
              firstPage.nextCursor
          }
        );

    assert.equal(
      secondPage.points.length,
      1
    );
    assert.equal(
      secondPage.points[0]
        .receivedAt,
      "2026-09-28T00:00:00.000Z"
    );
    assert.equal(
      secondPage.nextCursor,
      null
    );

    const cells =
      await store.heatmapHistory(
        projectA,
        {
          from:
            "2026-09-28T00:00:00.000Z",
          to:
            "2026-09-28T01:00:00.000Z",
          gridDegrees: 2
        }
      );

    assert.equal(
      cells.reduce(
        (sum, cell) =>
          sum + cell.count,
        0
      ),
      4
    );
    assert.equal(
      cells.reduce(
        (max, cell) =>
          Math.max(
            max,
            cell.uniqueUsers
          ),
        0
      ),
      2
    );

    const userCells =
      await store.heatmapHistory(
        projectA,
        {
          from:
            "2026-09-28T00:00:00.000Z",
          to:
            "2026-09-28T01:00:00.000Z",
          gridDegrees: 2,
          userId: "tracked-user"
        }
      );

    assert.equal(
      userCells.reduce(
        (sum, cell) =>
          sum + cell.count,
        0
      ),
      3
    );
  } finally {
    await pool.query(
      "DELETE FROM accounts WHERE id = $1",
      [accountId]
    );
    await pool.end();
  }
});
