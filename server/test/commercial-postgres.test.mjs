import test from "node:test";
import assert from "node:assert/strict";
import { createPgPoolFromEnv } from "../src/database.mjs";
import { PostgresAdminStore } from "../src/admin-store-postgres.mjs";
import { PostgresGeoLiveStore } from "../src/store-postgres.mjs";
import {
  CommercialStoreError,
  PostgresCommercialStore
} from "../src/commercial-store-postgres.mjs";
import { hashPassword } from "../src/passwords.mjs";

const enabled = Boolean(process.env.DATABASE_URL);

test("P3 commercial plans, entitlements, metering, invoices and support are isolated by account", {
  skip: enabled ? false : "DATABASE_URL not configured"
}, async () => {
  const pool = createPgPoolFromEnv();
  const adminStore = new PostgresAdminStore({ pool });
  const geoStore = new PostgresGeoLiveStore({ pool });
  const commercialStore =
    new PostgresCommercialStore({ pool });

  assert.equal(await commercialStore.ready(), true);

  const stamp = Date.now();
  const owner = await adminStore.createInitialOwner({
    email: `commercial-${stamp}@example.com`,
    displayName: "Commercial CI Owner",
    passwordHash: await hashPassword(
      "GeoLive-Commercial-CI-Password-2026"
    ),
    accountName: "Commercial CI Account"
  });

  try {
    const initial =
      await commercialStore.getSubscription(
        owner.accountId
      );
    assert.equal(initial.plan.code, "legacy");
    assert.equal(
      initial.subscription.status,
      "active"
    );

    await pool.query(
      `INSERT INTO platform_roles (
        admin_user_id,
        role
      ) VALUES ($1,'superadmin')`,
      [owner.userId]
    );
    assert.equal(
      await commercialStore.requirePlatformRole(
        owner.userId,
        ["superadmin"]
      ),
      "superadmin"
    );

    const plan =
      await commercialStore.createPlan(
        owner.userId,
        {
          code: `ci-${stamp}`,
          name: "CI Growth",
          currency: "USD",
          monthlyPriceMinor: 1000,
          includedIngest: 1000,
          includedRead: 1000,
          includedTrackedUsers: 0,
          maxProjects: 3,
          overageIngestPer1000Minor: 100,
          overageReadPer1000Minor: 100,
          overageTrackedUserMinor: 50,
          features: {
            realtime: true,
            clientTokens: true,
            androidAttestation: false,
            prioritySupport: false
          }
        }
      );
    assert.equal(plan.monthlyPriceMinor, 1000);

    const subscribed =
      await commercialStore.setSubscription({
        accountId: owner.accountId,
        actorUserId: owner.userId,
        patch: {
          planId: plan.id,
          status: "active",
          periodStart: "2026-09-01",
          periodEnd: "2026-10-01"
        }
      });
    assert.equal(
      subscribed.plan.id,
      plan.id
    );

    const project =
      await adminStore.createProject(
        owner.userId,
        {
          accountId: owner.accountId,
          slug: `commercial-ci-${stamp}`,
          name: "Commercial CI Project"
        }
      );

    const realtimeAccess =
      await commercialStore.assertProjectFeature(
        project.id,
        "realtime"
      );
    assert.equal(
      realtimeAccess.effective.realtime,
      true
    );

    await assert.rejects(
      () =>
        commercialStore.assertProjectFeature(
          project.id,
          "androidAttestation"
        ),
      (error) =>
        error instanceof CommercialStoreError &&
        error.code === "feature_not_entitled" &&
        error.status === 402
    );

    const entitlements =
      await commercialStore
        .setEntitlementOverrides({
          accountId: owner.accountId,
          actorUserId: owner.userId,
          overrides: {
            maxProjects: 1,
            includedIngest: 2000
          }
        });
    assert.equal(
      entitlements.effective.maxProjects,
      1
    );
    assert.equal(
      entitlements.effective.includedIngest,
      2000
    );

    await assert.rejects(
      () =>
        commercialStore
          .assertProjectCreateAllowed(
            owner.accountId
          ),
      (error) =>
        error instanceof CommercialStoreError &&
        error.code ===
          "project_entitlement_exceeded" &&
        error.status === 402
    );

    const clientTokenFeature =
      await commercialStore.assertProjectFeature(
        project.id,
        "clientTokens"
      );
    assert.equal(
      clientTokenFeature.effective.clientTokens,
      true
    );

    await assert.rejects(
      () =>
        commercialStore.assertProjectFeature(
          project.id,
          "androidAttestation"
        ),
      (error) =>
        error instanceof CommercialStoreError &&
        error.code === "feature_not_entitled" &&
        error.status === 402
    );

    const now = "2026-09-15T12:00:00.000Z";
    await geoStore.upsertLocation(
      project.id,
      {
        userId: "billable-user",
        latitude: 21.2514,
        longitude: 81.6296,
        accuracyM: 12,
        capturedAt: now,
        receivedAt: now,
        device: {
          platform: "test"
        }
      }
    );

    await pool.query(
      `DELETE FROM location_history
       WHERE project_id = $1
         AND external_user_id = 'billable-user'`,
      [project.id]
    );

    await pool.query(
      `INSERT INTO project_usage_daily (
        project_id,
        usage_date,
        ingest_count,
        read_count
      ) VALUES (
        $1,'2026-09-15',2500,1500
      )
      ON CONFLICT (project_id, usage_date)
      DO UPDATE SET
        ingest_count = EXCLUDED.ingest_count,
        read_count = EXCLUDED.read_count`,
      [project.id]
    );

    const usage =
      await commercialStore.snapshotUsage(
        owner.accountId,
        {
          periodStart: "2026-09-01",
          periodEnd: "2026-10-01"
        }
      );
    assert.equal(
      usage.metrics.ingestRequests,
      2500
    );
    assert.equal(
      usage.metrics.readRequests,
      1500
    );
    assert.equal(
      usage.metrics.trackedUsers,
      1
    );

    const generated =
      await commercialStore.generateInvoice({
        accountId: owner.accountId,
        actorUserId: owner.userId,
        periodStart: "2026-09-01",
        periodEnd: "2026-10-01",
        taxMinor: 0
      });
    assert.equal(
      generated.invoice.subtotalMinor,
      1250
    );
    assert.equal(
      generated.invoice.totalMinor,
      1250
    );
    assert.equal(
      generated.usage.finalized,
      true
    );

    await pool.query(
      `UPDATE project_usage_daily
       SET ingest_count = 999999
       WHERE project_id = $1
         AND usage_date = '2026-09-15'`,
      [project.id]
    );

    const frozen =
      await commercialStore.snapshotUsage(
        owner.accountId,
        {
          periodStart: "2026-09-01",
          periodEnd: "2026-10-01"
        }
      );
    assert.equal(
      frozen.metrics.ingestRequests,
      2500
    );
    assert.equal(frozen.finalized, true);

    const supportCase =
      await commercialStore.createSupportCase({
        accountId: owner.accountId,
        actorUserId: owner.userId,
        projectId: project.id,
        subject: "Billing question",
        body: "Please verify the current invoice.",
        category: "billing",
        priority: "high"
      });

    const cases =
      await commercialStore.listSupportCases(
        owner.accountId
      );
    assert.equal(
      cases.some(
        (item) => item.id === supportCase.id
      ),
      true
    );

    await commercialStore.addSupportMessage({
      caseId: supportCase.id,
      actorUserId: owner.userId,
      platform: true,
      body: "Internal review started.",
      internal: true
    });

    const tenantMessages =
      await commercialStore.listCaseMessages(
        supportCase.id
      );
    assert.equal(
      tenantMessages.some(
        (message) => message.internal
      ),
      false
    );

    const platformMessages =
      await commercialStore.listCaseMessages(
        supportCase.id,
        { includeInternal: true }
      );
    assert.equal(
      platformMessages.some(
        (message) => message.internal
      ),
      true
    );

    const resolved =
      await commercialStore.updateSupportCase({
        caseId: supportCase.id,
        actorUserId: owner.userId,
        patch: {
          status: "resolved",
          assignedPlatformUserId:
            owner.userId
        }
      });
    assert.equal(resolved.status, "resolved");

    const paid =
      await commercialStore.updateInvoice({
        invoiceId: generated.invoice.id,
        actorUserId: owner.userId,
        status: "paid"
      });
    assert.equal(paid.status, "paid");
    assert.ok(paid.paidAt);

    const overview =
      await commercialStore.platformOverview();
    assert.ok(overview.accounts >= 1);
    assert.ok(overview.invoices.count >= 1);
  } finally {
    await pool.query(
      "DELETE FROM admin_users WHERE id = $1",
      [owner.userId]
    );
    await pool.query(
      "DELETE FROM accounts WHERE id = $1",
      [owner.accountId]
    );
    await pool.query(
      "DELETE FROM commercial_plans WHERE code = $1",
      [`ci-${stamp}`]
    );
    await pool.end();
  }
});
