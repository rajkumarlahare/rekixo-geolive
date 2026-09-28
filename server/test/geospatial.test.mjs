import test from "node:test";
import assert from "node:assert/strict";
import { MemoryGeoLiveStore } from "../src/store-memory.mjs";
import { loadConfig } from "../src/config.mjs";
import { createGeoLiveServer } from "../src/server.mjs";
import {
  GeospatialInputError,
  parseHeatmapQuery,
  parseMovementHistoryQuery
} from "../src/geospatial-validation.mjs";

test("P4A geospatial query validation bounds history windows", () => {
  const history = parseMovementHistoryQuery(
    new URLSearchParams({
      userId: "user-1",
      from: "2026-09-27T00:00:00.000Z",
      to: "2026-09-28T00:00:00.000Z",
      limit: "500"
    })
  );
  assert.equal(history.userId, "user-1");
  assert.equal(history.limit, 500);

  const heatmap = parseHeatmapQuery(
    new URLSearchParams({
      from: "2026-09-27T00:00:00.000Z",
      to: "2026-09-28T00:00:00.000Z",
      gridDegrees: "1.5"
    })
  );
  assert.equal(heatmap.gridDegrees, 1.5);

  assert.throws(
    () =>
      parseMovementHistoryQuery(
        new URLSearchParams({
          from: "2026-09-27T00:00:00.000Z",
          to: "2026-09-28T00:00:00.000Z"
        })
      ),
    (error) =>
      error instanceof GeospatialInputError &&
      error.code === "user_id_required"
  );

  assert.throws(
    () =>
      parseHeatmapQuery(
        new URLSearchParams({
          from: "2026-07-01T00:00:00.000Z",
          to: "2026-09-28T00:00:00.000Z"
        })
      ),
    (error) =>
      error instanceof GeospatialInputError &&
      error.code === "history_window_too_large"
  );
});

test("P4A memory history is project/user scoped and cursor paginated", async () => {
  const store = new MemoryGeoLiveStore();
  const base = {
    userId: "user-1",
    accuracyM: 5,
    device: { platform: "test" }
  };

  for (const [receivedAt, latitude, longitude] of [
    ["2026-09-28T00:00:00.000Z", 21.25, 81.62],
    ["2026-09-28T00:01:00.000Z", 21.26, 81.63],
    ["2026-09-28T00:02:00.000Z", 21.27, 81.64]
  ]) {
    await store.upsertLocation(
      "project-a",
      {
        ...base,
        latitude,
        longitude,
        receivedAt,
        capturedAt: receivedAt
      }
    );
  }

  await store.upsertLocation(
    "project-a",
    {
      ...base,
      userId: "other-user",
      latitude: 30,
      longitude: 70,
      receivedAt:
        "2026-09-28T00:01:30.000Z"
    }
  );
  await store.upsertLocation(
    "project-b",
    {
      ...base,
      latitude: 40,
      longitude: 50,
      receivedAt:
        "2026-09-28T00:01:30.000Z"
    }
  );

  const first =
    await store.listMovementHistoryPage(
      "project-a",
      {
        userId: "user-1",
        from: "2026-09-28T00:00:00.000Z",
        to: "2026-09-28T01:00:00.000Z",
        limit: 2
      }
    );

  assert.equal(first.points.length, 2);
  assert.equal(
    first.points[0].receivedAt,
    "2026-09-28T00:02:00.000Z"
  );
  assert.ok(first.nextCursor);

  const second =
    await store.listMovementHistoryPage(
      "project-a",
      {
        userId: "user-1",
        from: "2026-09-28T00:00:00.000Z",
        to: "2026-09-28T01:00:00.000Z",
        limit: 2,
        cursor: first.nextCursor
      }
    );

  assert.equal(second.points.length, 1);
  assert.equal(
    second.points[0].receivedAt,
    "2026-09-28T00:00:00.000Z"
  );
  assert.equal(second.nextCursor, null);

  const malformedCursor =
    Buffer.from(
      JSON.stringify({
        v: 1,
        receivedAt:
          "not-a-date",
        id: "not-a-number"
      })
    ).toString("base64url");

  await assert.rejects(
    () =>
      store.listMovementHistoryPage(
        "project-a",
        {
          userId: "user-1",
          from:
            "2026-09-28T00:00:00.000Z",
          to:
            "2026-09-28T01:00:00.000Z",
          cursor:
            malformedCursor
        }
      ),
    (error) =>
      error.code ===
        "invalid_cursor" &&
      error.status === 400
  );
});

test("P4A memory heatmap aggregates history without leaking projects", async () => {
  const store = new MemoryGeoLiveStore();

  for (const [userId, latitude, longitude] of [
    ["u1", 21.25, 81.62],
    ["u2", 21.27, 81.64],
    ["u1", 21.26, 81.63]
  ]) {
    await store.upsertLocation(
      "project-a",
      {
        userId,
        latitude,
        longitude,
        receivedAt:
          "2026-09-28T00:10:00.000Z"
      }
    );
  }

  await store.upsertLocation(
    "project-b",
    {
      userId: "u3",
      latitude: 21.26,
      longitude: 81.63,
      receivedAt:
        "2026-09-28T00:10:00.000Z"
    }
  );

  const cells =
    await store.heatmapHistory(
      "project-a",
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
    3
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
});


test("P4A public history and heatmap routes require scoped project credentials", async () => {
  const readKey =
    "rgl_dev_read_p4a_ci";
  const config = loadConfig({
    NODE_ENV: "test",
    GEOLIVE_PERSISTENCE:
      "memory",
    GEOLIVE_DEV_PROJECT_ID:
      "demo-project",
    GEOLIVE_DEV_ADMIN_KEY:
      readKey,
    GEOLIVE_DEV_INGEST_KEY:
      "rgl_dev_ingest_p4a_ci"
  });
  const store =
    new MemoryGeoLiveStore();
  const features = [];

  for (const [userId, minute] of [
    ["route-user", "00"],
    ["route-user", "01"],
    ["other-user", "02"]
  ]) {
    const receivedAt =
      `2026-09-28T00:${minute}:00.000Z`;
    await store.upsertLocation(
      "demo-project",
      {
        userId,
        latitude:
          userId ===
          "route-user"
            ? 21.25
            : 21.35,
        longitude:
          userId ===
          "route-user"
            ? 81.62
            : 81.72,
        receivedAt,
        capturedAt: receivedAt
      }
    );
  }

  const commercialStore = {
    async assertProjectFeature(
      projectId,
      feature
    ) {
      assert.equal(
        projectId,
        "demo-project"
      );
      features.push(feature);
      return {
        subscription: {
          status: "active"
        },
        effective: {
          [feature]: true
        }
      };
    }
  };

  const server =
    createGeoLiveServer({
      config,
      store,
      commercialStore
    });

  await new Promise((resolve) => {
    server.listen(
      0,
      "127.0.0.1",
      resolve
    );
  });

  try {
    const address =
      server.address();
    const base =
      `http://127.0.0.1:${address.port}`;
    const headers = {
      authorization:
        `Bearer ${readKey}`
    };

    const history = await fetch(
      base +
        "/v1/history?" +
        new URLSearchParams({
          userId:
            "route-user",
          from:
            "2026-09-28T00:00:00.000Z",
          to:
            "2026-09-28T01:00:00.000Z"
        }),
      { headers }
    );
    assert.equal(
      history.status,
      200
    );
    const historyBody =
      await history.json();
    assert.equal(
      historyBody.points.length,
      2
    );
    assert.equal(
      historyBody.projectId,
      "demo-project"
    );

    const heatmap = await fetch(
      base +
        "/v1/heatmap?" +
        new URLSearchParams({
          from:
            "2026-09-28T00:00:00.000Z",
          to:
            "2026-09-28T01:00:00.000Z",
          gridDegrees: "2"
        }),
      { headers }
    );
    assert.equal(
      heatmap.status,
      200
    );
    const heatmapBody =
      await heatmap.json();
    assert.equal(
      heatmapBody.cells.reduce(
        (sum, cell) =>
          sum + cell.count,
        0
      ),
      3
    );

    assert.deepEqual(
      features,
      [
        "movementHistory",
        "heatmap"
      ]
    );

    const wrongScope = await fetch(
      base +
        "/v1/history?" +
        new URLSearchParams({
          userId:
            "route-user",
          from:
            "2026-09-28T00:00:00.000Z",
          to:
            "2026-09-28T01:00:00.000Z"
        }),
      {
        headers: {
          authorization:
            "Bearer rgl_dev_ingest_p4a_ci"
        }
      }
    );
    assert.equal(
      wrongScope.status,
      403
    );
    assert.deepEqual(
      await wrongScope.json(),
      {
        error:
          "insufficient_scope"
      }
    );

    const insufficient = await fetch(
      base +
        "/v1/history?" +
        new URLSearchParams({
          userId:
            "route-user",
          from:
            "2026-09-28T00:00:00.000Z",
          to:
            "2026-09-28T01:00:00.000Z"
        }),
      {
        headers: {
          authorization:
            "Bearer missing"
        }
      }
    );
    assert.equal(
      insufficient.status,
      401
    );
  } finally {
    await new Promise((resolve) =>
      server.close(resolve)
    );
  }
});
