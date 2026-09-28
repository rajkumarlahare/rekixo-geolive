import test from "node:test";
import assert from "node:assert/strict";
import { createPgPoolFromEnv } from "../src/database.mjs";
import { PostgresAdminStore } from "../src/admin-store-postgres.mjs";
import { PostgresApiKeyStore } from "../src/api-key-store-postgres.mjs";
import { hashPassword } from "../src/passwords.mjs";

const enabled = Boolean(process.env.DATABASE_URL);

test("database API keys generate, authenticate, rotate and revoke per project", {
  skip: enabled ? false : "DATABASE_URL not configured"
}, async () => {
  const pool = createPgPoolFromEnv();
  const adminStore = new PostgresAdminStore({ pool });
  const keyStore = new PostgresApiKeyStore({ pool });

  assert.equal(await keyStore.ready(), true);

  const owner = await adminStore.createInitialOwner({
    email: `key-owner-${Date.now()}@example.com`,
    displayName: "Key CI Owner",
    passwordHash: await hashPassword("GeoLive-Key-CI-Password-2026"),
    accountName: "Key CI Account"
  });

  try {
    const project = await adminStore.createProject(owner.userId, {
      accountId: owner.accountId,
      slug: "key-ci-project",
      name: "Key CI Project"
    });

    const created = await keyStore.createKey({
      project,
      actorUserId: owner.userId,
      name: "CI ingest",
      scopes: ["location:write"],
      allowedOrigins: ["https://app.example.com"],
      allowedPackages: ["com.rekixo.ci"],
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    });

    assert.match(created.secret, /^rgl_live_/);
    assert.equal(created.key.prefix.startsWith("rgl_live_"), true);

    const listed = await keyStore.listKeys(project.id);
    assert.equal(listed.length, 1);
    assert.equal(Object.hasOwn(listed[0], "secretHash"), false);
    assert.deepEqual(listed[0].allowedPackages, ["com.rekixo.ci"]);

    const valid = await keyStore.authenticateSecret(created.secret, "location:write");
    assert.equal(valid.ok, true);
    assert.equal(valid.key.projectId, project.id);

    const wrongScope = await keyStore.authenticateSecret(created.secret, "users:read");
    assert.equal(wrongScope.ok, false);
    assert.equal(wrongScope.error, "insufficient_scope");

    const rotated = await keyStore.rotateKey({
      project,
      actorUserId: owner.userId,
      keyId: created.key.id
    });

    const oldAuth = await keyStore.authenticateSecret(created.secret, "location:write");
    assert.equal(oldAuth.ok, false);
    assert.equal(oldAuth.error, "credential_revoked");

    const newAuth = await keyStore.authenticateSecret(rotated.secret, "location:write");
    assert.equal(newAuth.ok, true);

    await keyStore.revokeKey({
      project,
      actorUserId: owner.userId,
      keyId: rotated.key.id
    });

    const revoked = await keyStore.authenticateSecret(rotated.secret, "location:write");
    assert.equal(revoked.ok, false);
    assert.equal(revoked.error, "credential_revoked");
  } finally {
    await pool.query("DELETE FROM admin_users WHERE id = $1", [owner.userId]);
    await pool.query("DELETE FROM accounts WHERE id = $1", [owner.accountId]);
    await pool.end();
  }
});
