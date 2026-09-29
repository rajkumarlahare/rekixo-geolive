import test from "node:test";
import assert from "node:assert/strict";
import { createPgPoolFromEnv } from "../src/database.mjs";
import {
  AdminStoreError,
  PostgresAdminStore
} from "../src/admin-store-postgres.mjs";
import {
  hashPassword,
  sha256Secret
} from "../src/passwords.mjs";

const enabled = Boolean(process.env.DATABASE_URL);

test("admin control plane isolates account projects and enforces roles", {
  skip: enabled ? false : "DATABASE_URL not configured"
}, async () => {
  const pool = createPgPoolFromEnv();
  const store = new PostgresAdminStore({ pool });

  assert.equal(await store.ready(), true);

  const ownerEmail = `owner-${Date.now()}@example.com`;
  const owner = await store.createInitialOwner({
    email: ownerEmail,
    displayName: "CI Owner",
    passwordHash: await hashPassword("GeoLive-CI-Password-2026"),
    accountName: "CI Account"
  });

  try {
    const found = await store.findUserForLogin(ownerEmail);
    assert.equal(found.id, owner.userId);

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const createdSession = await store.createSession({
      userId: owner.userId,
      tokenHash: sha256Secret("gla_ci_session"),
      csrfHash: sha256Secret("glcsrf_ci"),
      expiresAt
    });
    assert.ok(createdSession.id);

    const session = await store.getSession(sha256Secret("gla_ci_session"));
    assert.equal(session.user.id, owner.userId);

    const project = await store.createProject(owner.userId, {
      accountId: owner.accountId,
      slug: "ci-project",
      name: "CI Project"
    });
    assert.equal(project.slug, "ci-project");

    const listed = await store.listProjects(owner.userId);
    assert.equal(listed.some((item) => item.id === project.id), true);

    const viewerUser = await pool.query(
      `INSERT INTO admin_users (email, display_name, password_hash)
       VALUES ($1, 'CI Viewer', $2)
       RETURNING id`,
      [
        `viewer-${Date.now()}@example.com`,
        await hashPassword("GeoLive-Viewer-Password-2026")
      ]
    );
    await pool.query(
      `INSERT INTO account_memberships (account_id, admin_user_id, role)
       VALUES ($1, $2, 'viewer')`,
      [owner.accountId, viewerUser.rows[0].id]
    );

    await assert.rejects(
      () => store.createProject(viewerUser.rows[0].id, {
        accountId: owner.accountId,
        slug: "viewer-cannot-create",
        name: "Viewer Project"
      }),
      (error) => error instanceof AdminStoreError
        && error.code === "project_write_forbidden"
        && error.status === 403
    );

    const updated = await store.updateProject(owner.userId, project.id, {
      status: "suspended",
      name: "CI Project Suspended"
    });
    assert.equal(updated.status, "suspended");

    await store.deleteProject(owner.userId, project.id);
    const afterDelete = await store.listProjects(owner.userId);
    assert.equal(afterDelete.some((item) => item.id === project.id), false);

    const concurrentCreates =
      await Promise.allSettled([
        store.createProject(
          owner.userId,
          {
            accountId: owner.accountId,
            slug: "cap-race-a",
            name: "Cap Race A",
            maxProjects: 1
          }
        ),
        store.createProject(
          owner.userId,
          {
            accountId: owner.accountId,
            slug: "cap-race-b",
            name: "Cap Race B",
            maxProjects: 1
          }
        )
      ]);
    const fulfilled =
      concurrentCreates.filter(
        (result) =>
          result.status === "fulfilled"
      );
    const rejected =
      concurrentCreates.filter(
        (result) =>
          result.status === "rejected"
      );
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(
      rejected[0].reason.code,
      "project_entitlement_exceeded"
    );
    assert.equal(
      rejected[0].reason.status,
      402
    );

    await pool.query("DELETE FROM admin_users WHERE id = $1", [viewerUser.rows[0].id]);
  } finally {
    await pool.query("DELETE FROM admin_users WHERE id = $1", [owner.userId]);
    await pool.query("DELETE FROM accounts WHERE id = $1", [owner.accountId]);
    await pool.end();
  }
});
