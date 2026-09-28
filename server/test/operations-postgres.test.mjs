import test from "node:test";
import assert from "node:assert/strict";
import { createPgPoolFromEnv } from "../src/database.mjs";
import { PostgresAdminStore } from "../src/admin-store-postgres.mjs";
import { PostgresOperationsStore } from "../src/operations-store-postgres.mjs";
import { hashPassword } from "../src/passwords.mjs";

const enabled = Boolean(process.env.DATABASE_URL);

test("P1D limits, distributed counters, metrics and security events are project scoped", {
  skip: enabled ? false : "DATABASE_URL not configured"
}, async () => {
  const pool = createPgPoolFromEnv();
  const adminStore = new PostgresAdminStore({ pool });
  const ops = new PostgresOperationsStore({ pool });

  assert.equal(await ops.ready(), true);

  const owner = await adminStore.createInitialOwner({
    email: `ops-owner-${Date.now()}@example.com`,
    displayName: "Ops CI Owner",
    passwordHash: await hashPassword("GeoLive-Ops-CI-Password-2026"),
    accountName: "Ops CI Account"
  });

  try {
    const project = await adminStore.createProject(owner.userId, {
      accountId: owner.accountId,
      slug: "ops-ci-project",
      name: "Ops CI Project"
    });

    const defaults = await ops.getProjectLimits(project.id);
    assert.equal(defaults.ingestRequestsPerMinute, 600);

    const limits = await ops.updateProjectLimits({
      project,
      actorUserId: owner.userId,
      patch: {
        ingestRequestsPerMinute: 2,
        dailyIngestQuota: 2,
        historyRetentionDays: 7
      }
    });
    assert.equal(limits.ingestRequestsPerMinute, 2);
    assert.equal(limits.historyRetentionDays, 7);

    const one = await ops.consumeProjectRateLimit(
      project.id,
      "ingest",
      2
    );
    const two = await ops.consumeProjectRateLimit(
      project.id,
      "ingest",
      2
    );
    const three = await ops.consumeProjectRateLimit(
      project.id,
      "ingest",
      2
    );
    assert.equal(one.allowed, true);
    assert.equal(two.allowed, true);
    assert.equal(three.allowed, false);

    assert.equal(
      (await ops.consumeDailyIngestQuota(project.id, 2)).allowed,
      true
    );
    assert.equal(
      (await ops.consumeDailyIngestQuota(project.id, 2)).allowed,
      true
    );
    assert.equal(
      (await ops.consumeDailyIngestQuota(project.id, 2)).allowed,
      false
    );

    await ops.recordUsage({
      projectId: project.id,
      keyRef: "db:test",
      route: "locations.write",
      statusCode: 202,
      latencyMs: 12
    });
    await ops.recordSecurityEvent({
      projectId: project.id,
      keyRef: "db:test",
      eventType: "api.rate_limited",
      severity: "warning",
      metadata: { group: "ingest" }
    });

    const metrics = await ops.getProjectMetrics(project.id, {
      hours: 24
    });
    assert.equal(metrics.totals.requests >= 1, true);
    assert.equal(metrics.totals.securityEvents >= 1, true);

    const events = await ops.listSecurityEvents(project.id, {
      limit: 10
    });
    assert.equal(events.events.length, 1);
    assert.equal(events.events[0].eventType, "api.rate_limited");
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
