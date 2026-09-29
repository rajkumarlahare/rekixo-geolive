import test from "node:test";
import assert from "node:assert/strict";
import {
  MemoryGeoLiveStore
} from "../src/store-memory.mjs";

test("P4F memory user search paginates beyond 500 matches without overlap", async () => {
  const store =
    new MemoryGeoLiveStore();
  const projectId =
    "pagination-project";
  const base =
    Date.parse(
      "2026-09-29T04:30:00Z"
    );

  for (
    let index = 0;
    index < 520;
    index += 1
  ) {
    await store.upsertLocation(
      projectId,
      {
        userId:
          `worker-${String(
            index
          ).padStart(4, "0")}`,
        name:
          `Worker ${index}`,
        latitude: 20,
        longitude: 80,
        receivedAt:
          new Date(
            base - index
          ).toISOString()
      }
    );
  }

  const first =
    await store.listUsersPage(
      projectId,
      {
        search: "worker",
        limit: 200
      }
    );
  const second =
    await store.listUsersPage(
      projectId,
      {
        search: "worker",
        limit: 200,
        cursor:
          first.nextCursor
      }
    );
  const third =
    await store.listUsersPage(
      projectId,
      {
        search: "worker",
        limit: 200,
        cursor:
          second.nextCursor
      }
    );

  assert.equal(
    first.users.length,
    200
  );
  assert.equal(
    second.users.length,
    200
  );
  assert.equal(
    third.users.length,
    120
  );
  assert.ok(first.nextCursor);
  assert.ok(second.nextCursor);
  assert.equal(
    third.nextCursor,
    null
  );

  const ids =
    [
      ...first.users,
      ...second.users,
      ...third.users
    ].map(
      (user) => user.userId
    );
  assert.equal(
    new Set(ids).size,
    520
  );
});
