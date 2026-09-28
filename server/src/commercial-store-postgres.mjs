import crypto from "node:crypto";

export class CommercialStoreError extends Error {
  constructor(code, status = 400, message = code) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function iso(value) {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === "string") {
    return value.slice(0, 10);
  }
  return new Date(value).toISOString().slice(0, 10);
}

function integer(value) {
  return Number(value || 0);
}

function monthBounds(now = new Date()) {
  const start = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    1
  ));
  const end = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth() + 1,
    1
  ));
  return {
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10)
  };
}

function mapPlan(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status,
    currency: row.currency,
    monthlyPriceMinor: integer(row.monthly_price_minor),
    includedIngest: integer(row.included_ingest),
    includedRead: integer(row.included_read),
    includedTrackedUsers: integer(row.included_tracked_users),
    maxProjects: integer(row.max_projects),
    overageIngestPer1000Minor:
      integer(row.overage_ingest_per_1000_minor),
    overageReadPer1000Minor:
      integer(row.overage_read_per_1000_minor),
    overageTrackedUserMinor:
      integer(row.overage_tracked_user_minor),
    features: row.features || {},
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

function mapSubscription(row) {
  if (!row) return null;
  return {
    accountId: row.account_id,
    planId: row.plan_id,
    status: row.subscription_status || row.status,
    provider: row.provider,
    providerCustomerRef: row.provider_customer_ref || null,
    providerSubscriptionRef:
      row.provider_subscription_ref || null,
    periodStart: dateOnly(row.period_start),
    periodEnd: dateOnly(row.period_end),
    cancelAtPeriodEnd:
      Boolean(row.cancel_at_period_end),
    trialEndsAt: iso(row.trial_ends_at),
    createdAt: iso(row.subscription_created_at || row.created_at),
    updatedAt: iso(row.subscription_updated_at || row.updated_at)
  };
}

function mapInvoice(row) {
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    accountId: row.account_id,
    planId: row.plan_id,
    status: row.status,
    currency: row.currency,
    periodStart: dateOnly(row.period_start),
    periodEnd: dateOnly(row.period_end),
    subtotalMinor: integer(row.subtotal_minor),
    taxMinor: integer(row.tax_minor),
    totalMinor: integer(row.total_minor),
    dueAt: iso(row.due_at),
    issuedAt: iso(row.issued_at),
    paidAt: iso(row.paid_at),
    providerInvoiceRef:
      row.provider_invoice_ref || null,
    notes: row.notes || null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

function mapSupportCase(row) {
  return {
    id: row.id,
    accountId: row.account_id,
    accountName: row.account_name || null,
    projectId: row.project_id || null,
    createdByAdminUserId:
      row.created_by_admin_user_id || null,
    createdByEmail: row.created_by_email || null,
    assignedPlatformUserId:
      row.assigned_platform_user_id || null,
    assignedPlatformEmail:
      row.assigned_platform_email || null,
    status: row.status,
    priority: row.priority,
    category: row.category,
    subject: row.subject,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    resolvedAt: iso(row.resolved_at)
  };
}

export class PostgresCommercialStore {
  constructor({ pool }) {
    if (!pool) {
      throw new Error(
        "PostgresCommercialStore requires a pool."
      );
    }
    this.pool = pool;
  }

  async ready() {
    try {
      const result = await this.pool.query(`
        SELECT
          to_regclass('public.commercial_plans') IS NOT NULL AS plans,
          to_regclass('public.account_subscriptions') IS NOT NULL AS subscriptions,
          to_regclass('public.account_entitlement_overrides') IS NOT NULL AS entitlements,
          to_regclass('public.billing_usage_periods') IS NOT NULL AS usage,
          to_regclass('public.billing_tracked_users_daily') IS NOT NULL AS tracked_users,
          to_regclass('public.billing_invoices') IS NOT NULL AS invoices,
          to_regclass('public.platform_roles') IS NOT NULL AS platform_roles,
          to_regclass('public.support_cases') IS NOT NULL AS support_cases
      `);
      const row = result.rows[0] || {};
      return Boolean(
        row.plans &&
        row.subscriptions &&
        row.entitlements &&
        row.usage &&
        row.tracked_users &&
        row.invoices &&
        row.platform_roles &&
        row.support_cases
      );
    } catch {
      return false;
    }
  }

  async assertReady() {
    if (!(await this.ready())) {
      throw new Error(
        "GeoLive commercial schema is not ready. Run npm run migrate first."
      );
    }
  }

  async ensureLegacySubscription(accountId) {
    const result = await this.pool.query(
      `INSERT INTO account_subscriptions (
        account_id,
        plan_id,
        status
      )
      SELECT $1, p.id, 'active'
      FROM commercial_plans p
      WHERE p.code = 'legacy'
      ON CONFLICT (account_id) DO NOTHING
      RETURNING account_id`,
      [accountId]
    );
    return result.rowCount > 0;
  }

  async getPlatformRole(userId) {
    const result = await this.pool.query(
      `SELECT role
       FROM platform_roles
       WHERE admin_user_id = $1
       LIMIT 1`,
      [userId]
    );
    return result.rows[0]?.role || null;
  }

  async requirePlatformRole(userId, allowed) {
    const role = await this.getPlatformRole(userId);
    if (!role || !allowed.includes(role)) {
      throw new CommercialStoreError(
        "platform_access_forbidden",
        403
      );
    }
    return role;
  }

  async listPlans({ includeArchived = false } = {}) {
    const result = await this.pool.query(
      `SELECT *
       FROM commercial_plans
       WHERE ($1::boolean OR status = 'active')
       ORDER BY monthly_price_minor ASC, name ASC`,
      [Boolean(includeArchived)]
    );
    return result.rows.map(mapPlan);
  }

  async getPlan(planId) {
    const result = await this.pool.query(
      "SELECT * FROM commercial_plans WHERE id = $1 LIMIT 1",
      [planId]
    );
    if (!result.rows.length) {
      throw new CommercialStoreError(
        "plan_not_found",
        404
      );
    }
    return mapPlan(result.rows[0]);
  }

  async createPlan(actorUserId, input) {
    try {
      const result = await this.pool.query(
        `INSERT INTO commercial_plans (
          code,
          name,
          status,
          currency,
          monthly_price_minor,
          included_ingest,
          included_read,
          included_tracked_users,
          max_projects,
          overage_ingest_per_1000_minor,
          overage_read_per_1000_minor,
          overage_tracked_user_minor,
          features,
          created_by_admin_user_id
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14
        )
        RETURNING *`,
        [
          input.code,
          input.name,
          input.status || "active",
          input.currency || "USD",
          input.monthlyPriceMinor || 0,
          input.includedIngest || 0,
          input.includedRead || 0,
          input.includedTrackedUsers || 0,
          input.maxProjects || 1,
          input.overageIngestPer1000Minor || 0,
          input.overageReadPer1000Minor || 0,
          input.overageTrackedUserMinor || 0,
          JSON.stringify(input.features || {}),
          actorUserId
        ]
      );

      await this.pool.query(
        `INSERT INTO audit_log (
          admin_user_id,
          action,
          details
        ) VALUES (
          $1,
          'commercial.plan_create',
          $2::jsonb
        )`,
        [
          actorUserId,
          JSON.stringify({
            planId: result.rows[0].id,
            code: input.code
          })
        ]
      );

      return mapPlan(result.rows[0]);
    } catch (error) {
      if (error?.code === "23505") {
        throw new CommercialStoreError(
          "plan_code_exists",
          409
        );
      }
      throw error;
    }
  }

  async updatePlan(actorUserId, planId, patch) {
    const current = await this.getPlan(planId);
    const next = { ...current, ...patch };

    if (
      current.code === "legacy" &&
      patch.status === "archived"
    ) {
      throw new CommercialStoreError(
        "legacy_plan_cannot_be_archived",
        409
      );
    }

    try {
      const result = await this.pool.query(
        `UPDATE commercial_plans
        SET code = $2,
            name = $3,
            status = $4,
            currency = $5,
            monthly_price_minor = $6,
            included_ingest = $7,
            included_read = $8,
            included_tracked_users = $9,
            max_projects = $10,
            overage_ingest_per_1000_minor = $11,
            overage_read_per_1000_minor = $12,
            overage_tracked_user_minor = $13,
            features = $14::jsonb,
            updated_at = now()
        WHERE id = $1
        RETURNING *`,
        [
          planId,
          next.code,
          next.name,
          next.status,
          next.currency,
          next.monthlyPriceMinor,
          next.includedIngest,
          next.includedRead,
          next.includedTrackedUsers,
          next.maxProjects,
          next.overageIngestPer1000Minor,
          next.overageReadPer1000Minor,
          next.overageTrackedUserMinor,
          JSON.stringify(next.features || {})
        ]
      );

      await this.pool.query(
        `INSERT INTO audit_log (
          admin_user_id,
          action,
          details
        ) VALUES (
          $1,
          'commercial.plan_update',
          $2::jsonb
        )`,
        [
          actorUserId,
          JSON.stringify({
            planId,
            before: current,
            after: mapPlan(result.rows[0])
          })
        ]
      );

      return mapPlan(result.rows[0]);
    } catch (error) {
      if (error?.code === "23505") {
        throw new CommercialStoreError(
          "plan_code_exists",
          409
        );
      }
      throw error;
    }
  }

  async getSubscription(accountId) {
    await this.ensureLegacySubscription(accountId);
    const result = await this.pool.query(
      `SELECT
        s.*,
        p.id AS plan_row_id,
        p.code,
        p.name,
        p.status AS plan_status,
        p.currency,
        p.monthly_price_minor,
        p.included_ingest,
        p.included_read,
        p.included_tracked_users,
        p.max_projects,
        p.overage_ingest_per_1000_minor,
        p.overage_read_per_1000_minor,
        p.overage_tracked_user_minor,
        p.features,
        p.created_at AS plan_created_at,
        p.updated_at AS plan_updated_at,
        s.status AS subscription_status,
        s.created_at AS subscription_created_at,
        s.updated_at AS subscription_updated_at
      FROM account_subscriptions s
      JOIN commercial_plans p ON p.id = s.plan_id
      WHERE s.account_id = $1
      LIMIT 1`,
      [accountId]
    );
    if (!result.rows.length) {
      throw new CommercialStoreError(
        "subscription_not_found",
        404
      );
    }
    const row = result.rows[0];
    return {
      subscription: mapSubscription(row),
      plan: mapPlan({
        id: row.plan_row_id,
        code: row.code,
        name: row.name,
        status: row.plan_status,
        currency: row.currency,
        monthly_price_minor: row.monthly_price_minor,
        included_ingest: row.included_ingest,
        included_read: row.included_read,
        included_tracked_users:
          row.included_tracked_users,
        max_projects: row.max_projects,
        overage_ingest_per_1000_minor:
          row.overage_ingest_per_1000_minor,
        overage_read_per_1000_minor:
          row.overage_read_per_1000_minor,
        overage_tracked_user_minor:
          row.overage_tracked_user_minor,
        features: row.features,
        created_at: row.plan_created_at,
        updated_at: row.plan_updated_at
      })
    };
  }

  async getEffectiveEntitlements(accountId) {
    const { subscription, plan } =
      await this.getSubscription(accountId);

    const result = await this.pool.query(
      `SELECT entitlement_key, value
       FROM account_entitlement_overrides
       WHERE account_id = $1`,
      [accountId]
    );

    const effective = {
      maxProjects: plan.maxProjects,
      includedIngest: plan.includedIngest,
      includedRead: plan.includedRead,
      includedTrackedUsers:
        plan.includedTrackedUsers,
      realtime:
        Boolean(plan.features.realtime),
      clientTokens:
        Boolean(plan.features.clientTokens),
      androidAttestation:
        Boolean(plan.features.androidAttestation),
      prioritySupport:
        Boolean(plan.features.prioritySupport)
    };

    const overrides = {};
    for (const row of result.rows) {
      const value = row.value;
      overrides[row.entitlement_key] = value;
      effective[row.entitlement_key] = value;
    }

    return {
      subscription,
      plan,
      effective,
      overrides
    };
  }

  async setEntitlementOverrides({
    accountId,
    actorUserId,
    overrides
  }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const [key, value] of Object.entries(overrides)) {
        await client.query(
          `INSERT INTO account_entitlement_overrides (
            account_id,
            entitlement_key,
            value,
            updated_by_admin_user_id,
            updated_at
          ) VALUES ($1,$2,$3::jsonb,$4,now())
          ON CONFLICT (account_id, entitlement_key)
          DO UPDATE SET
            value = EXCLUDED.value,
            updated_by_admin_user_id =
              EXCLUDED.updated_by_admin_user_id,
            updated_at = now()`,
          [
            accountId,
            key,
            JSON.stringify(value),
            actorUserId
          ]
        );
      }
      await client.query(
        `INSERT INTO audit_log (
          admin_user_id,
          account_id,
          action,
          details
        ) VALUES (
          $1,$2,'commercial.entitlements_update',$3::jsonb
        )`,
        [
          actorUserId,
          accountId,
          JSON.stringify({ overrides })
        ]
      );
      await client.query("COMMIT");
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      throw error;
    } finally {
      client.release();
    }
    return this.getEffectiveEntitlements(accountId);
  }

  async assertProjectCreateAllowed(accountId) {
    const { effective, subscription } =
      await this.getEffectiveEntitlements(accountId);

    if (
      !["active", "trialing"].includes(
        subscription.status
      )
    ) {
      throw new CommercialStoreError(
        "subscription_not_active",
        402
      );
    }

    const count = await this.pool.query(
      `SELECT count(*)::bigint AS count
       FROM projects
       WHERE account_id = $1
         AND status <> 'deleted'`,
      [accountId]
    );
    if (
      Number(count.rows[0]?.count || 0) >=
      Number(effective.maxProjects)
    ) {
      throw new CommercialStoreError(
        "project_entitlement_exceeded",
        402
      );
    }
    return effective;
  }

  async assertProjectFeature(projectId, feature) {
    const result = await this.pool.query(
      `SELECT account_id
       FROM projects
       WHERE id = $1
         AND status <> 'deleted'
       LIMIT 1`,
      [projectId]
    );
    if (!result.rows.length) {
      throw new CommercialStoreError(
        "project_not_found",
        404
      );
    }
    const accountId = result.rows[0].account_id;
    const { effective, subscription } =
      await this.getEffectiveEntitlements(accountId);

    if (
      !["active", "trialing"].includes(
        subscription.status
      )
    ) {
      throw new CommercialStoreError(
        "subscription_not_active",
        402
      );
    }
    if (!effective[feature]) {
      throw new CommercialStoreError(
        "feature_not_entitled",
        402
      );
    }
    return {
      accountId,
      subscription,
      effective
    };
  }

  async snapshotUsage(
    accountId,
    {
      periodStart,
      periodEnd,
      finalize = false
    }
  ) {
    const [
      requests,
      users
    ] = await Promise.all([
      this.pool.query(
        `SELECT
          COALESCE(sum(u.ingest_count), 0)::bigint AS ingest_count,
          COALESCE(sum(u.read_count), 0)::bigint AS read_count
        FROM project_usage_daily u
        JOIN projects p ON p.id = u.project_id
        WHERE p.account_id = $1
          AND u.usage_date >= $2::date
          AND u.usage_date < $3::date`,
        [accountId, periodStart, periodEnd]
      ),
      this.pool.query(
        `SELECT count(*)::bigint AS tracked_users
        FROM (
          SELECT DISTINCT
            u.project_id,
            u.external_user_id
          FROM billing_tracked_users_daily u
          JOIN projects p ON p.id = u.project_id
          WHERE p.account_id = $1
            AND u.usage_date >= $2::date
            AND u.usage_date < $3::date
        ) active_users`,
        [accountId, periodStart, periodEnd]
      )
    ]);

    const metrics = {
      ingestRequests:
        integer(requests.rows[0]?.ingest_count),
      readRequests:
        integer(requests.rows[0]?.read_count),
      trackedUsers:
        integer(users.rows[0]?.tracked_users)
    };

    const result = await this.pool.query(
      `INSERT INTO billing_usage_periods (
        account_id,
        period_start,
        period_end,
        metrics,
        finalized,
        updated_at
      ) VALUES ($1,$2,$3,$4::jsonb,$5,now())
      ON CONFLICT (
        account_id,
        period_start,
        period_end
      )
      DO UPDATE SET
        metrics = CASE
          WHEN billing_usage_periods.finalized
            THEN billing_usage_periods.metrics
          ELSE EXCLUDED.metrics
        END,
        finalized = (
          billing_usage_periods.finalized
          OR EXCLUDED.finalized
        ),
        updated_at = now()
      RETURNING *`,
      [
        accountId,
        periodStart,
        periodEnd,
        JSON.stringify(metrics),
        Boolean(finalize)
      ]
    );

    return {
      id: result.rows[0].id,
      accountId,
      periodStart: dateOnly(
        result.rows[0].period_start
      ),
      periodEnd: dateOnly(
        result.rows[0].period_end
      ),
      metrics: result.rows[0].metrics || metrics,
      finalized:
        Boolean(result.rows[0].finalized),
      updatedAt: iso(result.rows[0].updated_at)
    };
  }

  async currentUsage(accountId) {
    const bounds = monthBounds();
    return this.snapshotUsage(
      accountId,
      bounds
    );
  }

  async setSubscription({
    accountId,
    actorUserId,
    patch
  }) {
    await this.ensureLegacySubscription(accountId);
    const current =
      (await this.getSubscription(accountId))
        .subscription;

    const next = {
      ...current,
      ...patch
    };

    await this.getPlan(next.planId);

    const result = await this.pool.query(
      `UPDATE account_subscriptions
      SET plan_id = $2,
          status = $3,
          provider = $4,
          provider_customer_ref = $5,
          provider_subscription_ref = $6,
          period_start = $7,
          period_end = $8,
          cancel_at_period_end = $9,
          updated_at = now()
      WHERE account_id = $1
      RETURNING *`,
      [
        accountId,
        next.planId,
        next.status,
        next.provider || "manual",
        next.providerCustomerRef,
        next.providerSubscriptionRef,
        next.periodStart,
        next.periodEnd,
        Boolean(next.cancelAtPeriodEnd)
      ]
    );

    await this.pool.query(
      `INSERT INTO audit_log (
        admin_user_id,
        account_id,
        action,
        details
      ) VALUES (
        $1,$2,'commercial.subscription_update',$3::jsonb
      )`,
      [
        actorUserId,
        accountId,
        JSON.stringify({
          before: current,
          after: mapSubscription(result.rows[0])
        })
      ]
    );

    return this.getSubscription(accountId);
  }

  async listInvoices(accountId, { limit = 50 } = {}) {
    const size = Math.min(
      Math.max(Number(limit) || 50, 1),
      200
    );
    const result = await this.pool.query(
      `SELECT *
       FROM billing_invoices
       WHERE account_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [accountId, size]
    );
    return result.rows.map(mapInvoice);
  }

  async getInvoiceItems(invoiceId) {
    const result = await this.pool.query(
      `SELECT
        item_type,
        description,
        metric_key,
        quantity,
        unit_amount_minor,
        amount_minor
      FROM billing_invoice_items
      WHERE invoice_id = $1
      ORDER BY id ASC`,
      [invoiceId]
    );
    return result.rows.map((row) => ({
      itemType: row.item_type,
      description: row.description,
      metricKey: row.metric_key || null,
      quantity: integer(row.quantity),
      unitAmountMinor:
        integer(row.unit_amount_minor),
      amountMinor: integer(row.amount_minor)
    }));
  }

  async generateInvoice({
    accountId,
    actorUserId,
    periodStart,
    periodEnd,
    taxMinor = 0,
    dueAt = null,
    notes = null
  }) {
    const {
      subscription,
      plan,
      effective
    } = await this.getEffectiveEntitlements(
      accountId
    );

    if (
      !["active","trialing","past_due","canceled"].includes(
        subscription.status
      )
    ) {
      throw new CommercialStoreError(
        "subscription_not_billable",
        409
      );
    }

    const usage = await this.snapshotUsage(
      accountId,
      {
        periodStart,
        periodEnd,
        finalize: true
      }
    );

    const metrics = usage.metrics;
    const items = [];

    if (plan.monthlyPriceMinor > 0) {
      items.push({
        itemType: "base",
        description: `${plan.name} plan`,
        metricKey: null,
        quantity: 1,
        unitAmountMinor:
          plan.monthlyPriceMinor,
        amountMinor:
          plan.monthlyPriceMinor
      });
    }

    const ingestOver = Math.max(
      0,
      metrics.ingestRequests -
        effective.includedIngest
    );
    if (
      ingestOver > 0 &&
      plan.overageIngestPer1000Minor > 0
    ) {
      const blocks = Math.ceil(ingestOver / 1000);
      items.push({
        itemType: "overage",
        description:
          "Ingest overage (per 1,000 requests)",
        metricKey: "ingestRequests",
        quantity: ingestOver,
        unitAmountMinor:
          plan.overageIngestPer1000Minor,
        amountMinor:
          blocks *
          plan.overageIngestPer1000Minor
      });
    }

    const readOver = Math.max(
      0,
      metrics.readRequests -
        effective.includedRead
    );
    if (
      readOver > 0 &&
      plan.overageReadPer1000Minor > 0
    ) {
      const blocks = Math.ceil(readOver / 1000);
      items.push({
        itemType: "overage",
        description:
          "Read overage (per 1,000 requests)",
        metricKey: "readRequests",
        quantity: readOver,
        unitAmountMinor:
          plan.overageReadPer1000Minor,
        amountMinor:
          blocks *
          plan.overageReadPer1000Minor
      });
    }

    const userOver = Math.max(
      0,
      metrics.trackedUsers -
        effective.includedTrackedUsers
    );
    if (
      userOver > 0 &&
      plan.overageTrackedUserMinor > 0
    ) {
      items.push({
        itemType: "overage",
        description:
          "Tracked-user overage",
        metricKey: "trackedUsers",
        quantity: userOver,
        unitAmountMinor:
          plan.overageTrackedUserMinor,
        amountMinor:
          userOver *
          plan.overageTrackedUserMinor
      });
    }

    const subtotalMinor = items.reduce(
      (sum, item) => sum + item.amountMinor,
      0
    );
    const totalMinor =
      subtotalMinor + Number(taxMinor || 0);
    const invoiceId = crypto.randomUUID();
    const invoiceNumber =
      `RGL-${periodStart.replaceAll("-", "").slice(0, 6)}-${invoiceId.slice(0, 8).toUpperCase()}`;

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const invoice = await client.query(
        `INSERT INTO billing_invoices (
          id,
          invoice_number,
          account_id,
          plan_id,
          status,
          currency,
          period_start,
          period_end,
          subtotal_minor,
          tax_minor,
          total_minor,
          due_at,
          notes,
          generated_by_admin_user_id
        ) VALUES (
          $1,$2,$3,$4,'draft',$5,$6,$7,$8,$9,$10,$11,$12,$13
        )
        RETURNING *`,
        [
          invoiceId,
          invoiceNumber,
          accountId,
          plan.id,
          plan.currency,
          periodStart,
          periodEnd,
          subtotalMinor,
          Number(taxMinor || 0),
          totalMinor,
          dueAt,
          notes,
          actorUserId
        ]
      );

      for (const item of items) {
        await client.query(
          `INSERT INTO billing_invoice_items (
            invoice_id,
            item_type,
            description,
            metric_key,
            quantity,
            unit_amount_minor,
            amount_minor
          ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            invoiceId,
            item.itemType,
            item.description,
            item.metricKey,
            item.quantity,
            item.unitAmountMinor,
            item.amountMinor
          ]
        );
      }

      await client.query(
        `INSERT INTO audit_log (
          admin_user_id,
          account_id,
          action,
          details
        ) VALUES (
          $1,$2,'billing.invoice_generate',$3::jsonb
        )`,
        [
          actorUserId,
          accountId,
          JSON.stringify({
            invoiceId,
            invoiceNumber,
            periodStart,
            periodEnd,
            subtotalMinor,
            taxMinor: Number(taxMinor || 0),
            totalMinor,
            usage: metrics
          })
        ]
      );

      await client.query("COMMIT");
      return {
        invoice: mapInvoice(invoice.rows[0]),
        items,
        usage
      };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      if (error?.code === "23505") {
        throw new CommercialStoreError(
          "invoice_period_exists",
          409
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async updateInvoice({
    invoiceId,
    actorUserId,
    status
  }) {
    const current = await this.pool.query(
      `SELECT *
       FROM billing_invoices
       WHERE id = $1
       LIMIT 1`,
      [invoiceId]
    );
    if (!current.rows.length) {
      throw new CommercialStoreError(
        "invoice_not_found",
        404
      );
    }
    const before = mapInvoice(current.rows[0]);

    const transitions = {
      draft: new Set(["draft", "open", "void"]),
      open: new Set([
        "open",
        "paid",
        "void",
        "uncollectible"
      ]),
      uncollectible: new Set([
        "uncollectible",
        "paid",
        "void"
      ]),
      paid: new Set(["paid"]),
      void: new Set(["void"])
    };
    if (
      !transitions[before.status]?.has(status)
    ) {
      throw new CommercialStoreError(
        ["paid", "void"].includes(before.status)
          ? "invoice_status_final"
          : "invalid_invoice_transition",
        409
      );
    }

    const result = await this.pool.query(
      `UPDATE billing_invoices
       SET status = $2,
           issued_at = CASE
             WHEN $2 = 'open' AND issued_at IS NULL
               THEN now()
             ELSE issued_at
           END,
           paid_at = CASE
             WHEN $2 = 'paid'
               THEN COALESCE(paid_at, now())
             ELSE paid_at
           END,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [invoiceId, status]
    );

    await this.pool.query(
      `INSERT INTO audit_log (
        admin_user_id,
        account_id,
        action,
        details
      ) VALUES (
        $1,$2,'billing.invoice_status',$3::jsonb
      )`,
      [
        actorUserId,
        result.rows[0].account_id,
        JSON.stringify({
          invoiceId,
          before: before.status,
          after: status
        })
      ]
    );

    return mapInvoice(result.rows[0]);
  }

  async createSupportCase({
    accountId,
    actorUserId,
    projectId,
    subject,
    body,
    category,
    priority
  }) {
    if (projectId) {
      const project = await this.pool.query(
        `SELECT id
         FROM projects
         WHERE id = $1
           AND account_id = $2
           AND status <> 'deleted'
         LIMIT 1`,
        [projectId, accountId]
      );
      if (!project.rows.length) {
        throw new CommercialStoreError(
          "project_not_found",
          404
        );
      }
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const created = await client.query(
        `INSERT INTO support_cases (
          account_id,
          project_id,
          created_by_admin_user_id,
          priority,
          category,
          subject
        ) VALUES ($1,$2,$3,$4,$5,$6)
        RETURNING *`,
        [
          accountId,
          projectId,
          actorUserId,
          priority,
          category,
          subject
        ]
      );

      await client.query(
        `INSERT INTO support_case_messages (
          case_id,
          author_admin_user_id,
          author_type,
          body,
          internal
        ) VALUES ($1,$2,'tenant',$3,false)`,
        [
          created.rows[0].id,
          actorUserId,
          body
        ]
      );

      await client.query(
        `INSERT INTO audit_log (
          admin_user_id,
          account_id,
          project_id,
          action,
          details
        ) VALUES (
          $1,$2,$3,'support.case_create',$4::jsonb
        )`,
        [
          actorUserId,
          accountId,
          projectId,
          JSON.stringify({
            caseId: created.rows[0].id,
            category,
            priority,
            subject
          })
        ]
      );

      await client.query("COMMIT");
      return mapSupportCase(created.rows[0]);
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async listSupportCases(
    accountId,
    { limit = 100 } = {}
  ) {
    const size = Math.min(
      Math.max(Number(limit) || 100, 1),
      200
    );
    const result = await this.pool.query(
      `SELECT
        c.*,
        creator.email AS created_by_email,
        assignee.email AS assigned_platform_email
      FROM support_cases c
      LEFT JOIN admin_users creator
        ON creator.id = c.created_by_admin_user_id
      LEFT JOIN admin_users assignee
        ON assignee.id = c.assigned_platform_user_id
      WHERE c.account_id = $1
      ORDER BY c.updated_at DESC
      LIMIT $2`,
      [accountId, size]
    );
    return result.rows.map(mapSupportCase);
  }

  async listCaseMessages(
    caseId,
    { includeInternal = false } = {}
  ) {
    const result = await this.pool.query(
      `SELECT
        m.id,
        m.author_type,
        m.body,
        m.internal,
        m.created_at,
        u.email AS author_email
      FROM support_case_messages m
      LEFT JOIN admin_users u
        ON u.id = m.author_admin_user_id
      WHERE m.case_id = $1
        AND ($2::boolean OR m.internal = false)
      ORDER BY m.id ASC`,
      [caseId, Boolean(includeInternal)]
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      authorType: row.author_type,
      authorEmail: row.author_email || null,
      body: row.body,
      internal: Boolean(row.internal),
      createdAt: iso(row.created_at)
    }));
  }

  async addSupportMessage({
    caseId,
    actorUserId,
    platform,
    body,
    internal = false
  }) {
    const exists = await this.pool.query(
      `SELECT id, account_id
       FROM support_cases
       WHERE id = $1
       LIMIT 1`,
      [caseId]
    );
    if (!exists.rows.length) {
      throw new CommercialStoreError(
        "support_case_not_found",
        404
      );
    }

    const result = await this.pool.query(
      `INSERT INTO support_case_messages (
        case_id,
        author_admin_user_id,
        author_type,
        body,
        internal
      ) VALUES ($1,$2,$3,$4,$5)
      RETURNING id, created_at`,
      [
        caseId,
        actorUserId,
        platform ? "platform" : "tenant",
        body,
        platform ? Boolean(internal) : false
      ]
    );

    await this.pool.query(
      "UPDATE support_cases SET updated_at = now() WHERE id = $1",
      [caseId]
    );

    await this.pool.query(
      `INSERT INTO audit_log (
        admin_user_id,
        account_id,
        action,
        details
      ) VALUES (
        $1,$2,'support.message_add',$3::jsonb
      )`,
      [
        actorUserId,
        exists.rows[0].account_id,
        JSON.stringify({
          caseId,
          messageId:
            String(result.rows[0].id),
          authorType:
            platform ? "platform" : "tenant",
          internal:
            platform ? Boolean(internal) : false
        })
      ]
    );

    return {
      id: String(result.rows[0].id),
      createdAt: iso(result.rows[0].created_at)
    };
  }

  async updateSupportCase({
    caseId,
    actorUserId,
    patch
  }) {
    const current = await this.pool.query(
      "SELECT * FROM support_cases WHERE id = $1 LIMIT 1",
      [caseId]
    );
    if (!current.rows.length) {
      throw new CommercialStoreError(
        "support_case_not_found",
        404
      );
    }
    const row = current.rows[0];
    const next = {
      status: patch.status ?? row.status,
      priority: patch.priority ?? row.priority,
      assignedPlatformUserId:
        patch.assignedPlatformUserId !== undefined
          ? patch.assignedPlatformUserId
          : row.assigned_platform_user_id
    };

    if (next.assignedPlatformUserId) {
      const role = await this.getPlatformRole(
        next.assignedPlatformUserId
      );
      if (
        !["superadmin","support"].includes(
          role
        )
      ) {
        throw new CommercialStoreError(
          "invalid_assignee",
          400
        );
      }
    }

    const result = await this.pool.query(
      `UPDATE support_cases
       SET status = $2,
           priority = $3,
           assigned_platform_user_id = $4,
           resolved_at = CASE
             WHEN $2 IN ('resolved','closed')
               THEN COALESCE(resolved_at, now())
             ELSE NULL
           END,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        caseId,
        next.status,
        next.priority,
        next.assignedPlatformUserId
      ]
    );

    await this.pool.query(
      `INSERT INTO audit_log (
        admin_user_id,
        account_id,
        project_id,
        action,
        details
      ) VALUES (
        $1,$2,$3,'support.case_update',$4::jsonb
      )`,
      [
        actorUserId,
        row.account_id,
        row.project_id,
        JSON.stringify({
          caseId,
          before: {
            status: row.status,
            priority: row.priority,
            assignedPlatformUserId:
              row.assigned_platform_user_id
          },
          after: next
        })
      ]
    );

    return mapSupportCase(result.rows[0]);
  }

  async accountHasCaseAccess(userId, caseId) {
    const result = await this.pool.query(
      `SELECT c.account_id
       FROM support_cases c
       JOIN account_memberships m
         ON m.account_id = c.account_id
        AND m.admin_user_id = $1
       WHERE c.id = $2
       LIMIT 1`,
      [userId, caseId]
    );
    return result.rows[0]?.account_id || null;
  }

  async listPlatformSupportCases({
    status = "",
    limit = 100
  } = {}) {
    const size = Math.min(
      Math.max(Number(limit) || 100, 1),
      200
    );
    const params = [];
    let where = "";
    if (status) {
      params.push(status);
      where = "WHERE c.status = $1";
    }
    params.push(size);
    const limitParam = params.length;

    const result = await this.pool.query(
      `SELECT
        c.*,
        a.name AS account_name,
        creator.email AS created_by_email,
        assignee.email AS assigned_platform_email
      FROM support_cases c
      JOIN accounts a ON a.id = c.account_id
      LEFT JOIN admin_users creator
        ON creator.id = c.created_by_admin_user_id
      LEFT JOIN admin_users assignee
        ON assignee.id = c.assigned_platform_user_id
      ${where}
      ORDER BY
        CASE c.priority
          WHEN 'urgent' THEN 1
          WHEN 'high' THEN 2
          WHEN 'normal' THEN 3
          ELSE 4
        END,
        c.updated_at DESC
      LIMIT $${limitParam}`,
      params
    );
    return result.rows.map(mapSupportCase);
  }

  async listPlatformAccounts({ limit = 100 } = {}) {
    const size = Math.min(
      Math.max(Number(limit) || 100, 1),
      500
    );
    const result = await this.pool.query(
      `SELECT
        a.id,
        a.name,
        a.created_at,
        s.status AS subscription_status,
        s.period_start,
        s.period_end,
        p.id AS plan_id,
        p.code AS plan_code,
        p.name AS plan_name,
        p.currency,
        p.monthly_price_minor,
        (
          SELECT count(*)::bigint
          FROM projects project
          WHERE project.account_id = a.id
            AND project.status <> 'deleted'
        ) AS project_count
      FROM accounts a
      LEFT JOIN account_subscriptions s
        ON s.account_id = a.id
      LEFT JOIN commercial_plans p
        ON p.id = s.plan_id
      ORDER BY a.created_at DESC
      LIMIT $1`,
      [size]
    );

    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: iso(row.created_at),
      subscriptionStatus:
        row.subscription_status || null,
      periodStart: dateOnly(row.period_start),
      periodEnd: dateOnly(row.period_end),
      plan: row.plan_id
        ? {
            id: row.plan_id,
            code: row.plan_code,
            name: row.plan_name,
            currency: row.currency,
            monthlyPriceMinor:
              integer(row.monthly_price_minor)
          }
        : null,
      projectCount: integer(row.project_count)
    }));
  }

  async platformOverview() {
    const [
      accounts,
      subscriptions,
      invoices,
      support
    ] = await Promise.all([
      this.pool.query(
        "SELECT count(*)::bigint AS count FROM accounts"
      ),
      this.pool.query(
        `SELECT status, count(*)::bigint AS count
         FROM account_subscriptions
         GROUP BY status`
      ),
      this.pool.query(
        `SELECT
          currency,
          count(*)::bigint AS count,
          COALESCE(sum(total_minor) FILTER (
            WHERE status IN ('open','paid')
          ),0)::bigint AS billed_minor,
          COALESCE(sum(total_minor) FILTER (
            WHERE status = 'paid'
          ),0)::bigint AS paid_minor
         FROM billing_invoices
         GROUP BY currency
         ORDER BY currency`
      ),
      this.pool.query(
        `SELECT
          count(*) FILTER (
            WHERE status NOT IN ('resolved','closed')
          )::bigint AS open_count,
          count(*) FILTER (
            WHERE priority = 'urgent'
              AND status NOT IN ('resolved','closed')
          )::bigint AS urgent_count
         FROM support_cases`
      )
    ]);

    return {
      accounts: integer(accounts.rows[0]?.count),
      subscriptions:
        Object.fromEntries(
          subscriptions.rows.map((row) => [
            row.status,
            integer(row.count)
          ])
        ),
      invoices: {
        count: invoices.rows.reduce(
          (sum, row) =>
            sum + integer(row.count),
          0
        ),
        byCurrency:
          Object.fromEntries(
            invoices.rows.map((row) => [
              row.currency,
              {
                count: integer(row.count),
                billedMinor:
                  integer(row.billed_minor),
                paidMinor:
                  integer(row.paid_minor)
              }
            ])
          )
      },
      support: {
        open:
          integer(support.rows[0]?.open_count),
        urgent:
          integer(support.rows[0]?.urgent_count)
      }
    };
  }

  async accountCommercialOverview(accountId) {
    const [
      entitlements,
      usage,
      invoices,
      supportCases
    ] = await Promise.all([
      this.getEffectiveEntitlements(accountId),
      this.currentUsage(accountId),
      this.listInvoices(accountId, {
        limit: 20
      }),
      this.listSupportCases(accountId, {
        limit: 20
      })
    ]);

    return {
      ...entitlements,
      usage,
      invoices,
      supportCases
    };
  }
}
