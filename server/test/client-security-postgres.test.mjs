import test from "node:test";
import assert from "node:assert/strict";
import { createPgPoolFromEnv } from "../src/database.mjs";
import { PostgresAdminStore } from "../src/admin-store-postgres.mjs";
import { PostgresClientSecurityStore } from "../src/client-security-store-postgres.mjs";
import { hashPassword } from "../src/passwords.mjs";

const enabled = Boolean(process.env.DATABASE_URL);

test("P2 client security policy and nonce replay guards are project scoped", {
  skip: enabled ? false : "DATABASE_URL not configured"
}, async () => {
  const pool = createPgPoolFromEnv();
  const adminStore =
    new PostgresAdminStore({ pool });
  const securityStore =
    new PostgresClientSecurityStore({ pool });

  assert.equal(
    await securityStore.ready(),
    true
  );

  const owner =
    await adminStore.createInitialOwner({
      email:
        `client-security-${Date.now()}@example.com`,
      displayName: "P2 CI Owner",
      passwordHash:
        await hashPassword(
          "GeoLive-P2-CI-Password-2026"
        ),
      accountName: "P2 CI Account"
    });

  try {
    const project =
      await adminStore.createProject(
        owner.userId,
        {
          accountId: owner.accountId,
          slug: "p2-security-ci",
          name: "P2 Security CI"
        }
      );

    const defaults =
      await securityStore.getPolicy(
        project.id
      );
    assert.equal(
      defaults.clientTokenTtlSeconds,
      300
    );
    assert.equal(
      defaults.requireRequestProof,
      true
    );

    const updated =
      await securityStore.updatePolicy({
        project,
        actorUserId: owner.userId,
        patch: {
          clientTokenTtlSeconds: 180,
          androidAttestationMode:
            "optional"
        }
      });
    assert.equal(
      updated.clientTokenTtlSeconds,
      180
    );
    assert.equal(
      updated.androidAttestationMode,
      "optional"
    );

    const expiresAt =
      new Date(Date.now() + 60000)
        .toISOString();

    assert.equal(
      await securityStore.consumeExchangeNonce(
        project.id,
        "exchange-nonce-123456",
        expiresAt
      ),
      true
    );
    assert.equal(
      await securityStore.consumeExchangeNonce(
        project.id,
        "exchange-nonce-123456",
        expiresAt
      ),
      false
    );

    const tokenJti =
      "33333333-3333-4333-8333-333333333333";
    assert.equal(
      await securityStore.consumeRequestNonce(
        project.id,
        tokenJti,
        "request-nonce-123456",
        expiresAt
      ),
      true
    );
    assert.equal(
      await securityStore.consumeRequestNonce(
        project.id,
        tokenJti,
        "request-nonce-123456",
        expiresAt
      ),
      false
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
