import test from "node:test";
import assert from "node:assert/strict";
import { createPgPoolFromEnv } from "../src/database.mjs";
import { PostgresAdminStore } from "../src/admin-store-postgres.mjs";
import { PostgresGeoLiveStore } from "../src/store-postgres.mjs";
import { PostgresOperationsStore } from "../src/operations-store-postgres.mjs";
import { GeoLiveStoreError } from "../src/store-postgres.mjs";
import { hashPassword } from "../src/passwords.mjs";

const enabled = Boolean(process.env.DATABASE_URL);

test("P1D user pagination is stable and live-user quota is enforced", {
  skip: enabled ? false : "DATABASE_URL not configured"
}, async () => {
  const pool = createPgPoolFromEnv();
  const adminStore = new PostgresAdminStore({ pool });
  const geoStore = new PostgresGeoLiveStore({ pool });
  const ops = new PostgresOperationsStore({ pool });

  const owner = await adminStore.createInitialOwner({
    email: `page-owner-${Date.now()}@example.com`,
    displayName: "Pagination CI Owner",
    passwordHash: await hashPassword("GeoLive-Page-CI-Password-2026"),
    accountName: "Pagination CI Account"
  });

  try {
    const project = await adminStore.createProject(owner.userId, {
      accountId: owner.accountId,
      slug: "page-ci-project",
      name: "Pagination CI Project"
    });

    await ops.updateProjectLimits({
      project,
      actorUserId: owner.userId,
      patch: { maxLiveUsers: 2 }
    });

    const now = new Date();
    await geoStore.upsertLocation(project.id, {
      userId: "user-b",
      latitude: 21.2,
      longitude: 81.6,
      receivedAt: new Date(now.getTime() - 1000).toISOString()
    });
    await geoStore.upsertLocation(project.id, {
      userId: "user-a",
      latitude: 21.3,
      longitude: 81.7,
      receivedAt: now.toISOString()
    });

    await assert.rejects(
      () => geoStore.upsertLocation(project.id, {
        userId: "user-c",
        latitude: 21.4,
        longitude: 81.8,
        receivedAt: new Date().toISOString()
      }),
      (error) =>
        error instanceof GeoLiveStoreError &&
        error.code === "project_live_user_quota_exceeded" &&
        error.status === 429
    );

    const first = await geoStore.listUsersPage(project.id, {
      limit: 1
    });
    assert.equal(first.users.length, 1);
    assert.ok(first.nextCursor);

    const second = await geoStore.listUsersPage(project.id, {
      limit: 1,
      cursor: first.nextCursor
    });
    assert.equal(second.users.length, 1);
    assert.notEqual(
      second.users[0].userId,
      first.users[0].userId
    );
    assert.equal(second.nextCursor, null);
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
