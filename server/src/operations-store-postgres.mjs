import { encodeCursor, decodeCursor } from "./cursor.mjs";

const DEFAULT_LIMITS = Object.freeze({
  ingestRequestsPerMinute: 600,
  readRequestsPerMinute: 300,
  dailyIngestQuota: 1000000,
  maxLiveUsers: 100000,
  historyRetentionDays: 30,
  securityEventRetentionDays: 90,
  metricsRetentionDays: 90,
  realtimeEventRetentionHours: 24,
  geofenceEventRetentionDays: 90,
  webhookDeliveryRetentionDays: 30
});

function int(value) {
  return Number(value || 0);
}

function iso(value) {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function mapLimits(row = {}) {
  return {
    ingestRequestsPerMinute: int(
      row.ingest_requests_per_minute ??
      DEFAULT_LIMITS.ingestRequestsPerMinute
    ),
    readRequestsPerMinute: int(
      row.read_requests_per_minute ??
      DEFAULT_LIMITS.readRequestsPerMinute
    ),
    dailyIngestQuota: int(
      row.daily_ingest_quota ??
      DEFAULT_LIMITS.dailyIngestQuota
    ),
    maxLiveUsers: int(
      row.max_live_users ??
      DEFAULT_LIMITS.maxLiveUsers
    ),
    historyRetentionDays: int(
      row.history_retention_days ??
      DEFAULT_LIMITS.historyRetentionDays
    ),
    securityEventRetentionDays: int(
      row.security_event_retention_days ??
      DEFAULT_LIMITS.securityEventRetentionDays
    ),
    metricsRetentionDays: int(
      row.metrics_retention_days ??
      DEFAULT_LIMITS.metricsRetentionDays
    ),
    realtimeEventRetentionHours: int(
      row.realtime_event_retention_hours ??
      DEFAULT_LIMITS.realtimeEventRetentionHours
    ),
    geofenceEventRetentionDays: int(
      row.geofence_event_retention_days ??
      DEFAULT_LIMITS.geofenceEventRetentionDays
    ),
    webhookDeliveryRetentionDays: int(
      row.webhook_delivery_retention_days ??
      DEFAULT_LIMITS.webhookDeliveryRetentionDays
    ),
    updatedAt: row.updated_at ? iso(row.updated_at) : null
  };
}

export class OperationsStoreError extends Error {
  constructor(code, status = 400, message = code) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export class PostgresOperationsStore {
  constructor({ pool }) {
    if (!pool) throw new Error(
      "PostgresOperationsStore requires a pool."
    );
    this.pool = pool;
  }

  async ready() {
    try {
      const result = await this.pool.query(`
        SELECT
          to_regclass('public.project_limits') IS NOT NULL AS limits,
          to_regclass('public.api_rate_limit_counters') IS NOT NULL AS rate_limits,
          to_regclass('public.project_usage_daily') IS NOT NULL AS daily_usage,
          to_regclass('public.api_usage_hourly') IS NOT NULL AS hourly_usage,
          to_regclass('public.security_events') IS NOT NULL AS security_events,
          to_regclass('public.retention_runs') IS NOT NULL AS retention_runs
      `);
      const row = result.rows[0] || {};
      return Boolean(
        row.limits &&
        row.rate_limits &&
        row.daily_usage &&
        row.hourly_usage &&
        row.security_events &&
        row.retention_runs
      );
    } catch {
      return false;
    }
  }

  async assertReady() {
    if (!(await this.ready())) {
      throw new Error(
        "GeoLive operations schema is not ready. Run npm run migrate first."
      );
    }
  }

  async getProjectLimits(projectId) {
    const result = await this.pool.query(
      `SELECT
          l.ingest_requests_per_minute,
          l.read_requests_per_minute,
          l.daily_ingest_quota,
          l.max_live_users,
          l.history_retention_days,
          l.security_event_retention_days,
          l.metrics_retention_days,
          l.realtime_event_retention_hours,
          l.geofence_event_retention_days,
          l.webhook_delivery_retention_days,
          l.updated_at
       FROM projects p
       LEFT JOIN project_limits l ON l.project_id = p.id
       WHERE p.id = $1 AND p.status <> 'deleted'
       LIMIT 1`,
      [projectId]
    );
    if (!result.rows.length) {
      throw new OperationsStoreError("project_not_found", 404);
    }
    return mapLimits(result.rows[0]);
  }

  async updateProjectLimits({
    project,
    actorUserId,
    patch
  }) {
    const current = await this.getProjectLimits(project.id);
    const next = { ...current, ...patch };

    const result = await this.pool.query(
      `INSERT INTO project_limits (
        project_id,
        ingest_requests_per_minute,
        read_requests_per_minute,
        daily_ingest_quota,
        max_live_users,
        history_retention_days,
        security_event_retention_days,
        metrics_retention_days,
        realtime_event_retention_hours,
        geofence_event_retention_days,
        webhook_delivery_retention_days,
        updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
      ON CONFLICT (project_id)
      DO UPDATE SET
        ingest_requests_per_minute = EXCLUDED.ingest_requests_per_minute,
        read_requests_per_minute = EXCLUDED.read_requests_per_minute,
        daily_ingest_quota = EXCLUDED.daily_ingest_quota,
        max_live_users = EXCLUDED.max_live_users,
        history_retention_days = EXCLUDED.history_retention_days,
        security_event_retention_days = EXCLUDED.security_event_retention_days,
        metrics_retention_days = EXCLUDED.metrics_retention_days,
        realtime_event_retention_hours = EXCLUDED.realtime_event_retention_hours,
        geofence_event_retention_days = EXCLUDED.geofence_event_retention_days,
        webhook_delivery_retention_days = EXCLUDED.webhook_delivery_retention_days,
        updated_at = now()
      RETURNING *`,
      [
        project.id,
        next.ingestRequestsPerMinute,
        next.readRequestsPerMinute,
        next.dailyIngestQuota,
        next.maxLiveUsers,
        next.historyRetentionDays,
        next.securityEventRetentionDays,
        next.metricsRetentionDays,
        next.realtimeEventRetentionHours,
        next.geofenceEventRetentionDays,
        next.webhookDeliveryRetentionDays
      ]
    );

    await this.pool.query(
      `INSERT INTO audit_log (
        admin_user_id, account_id, project_id, action, details
      ) VALUES ($1,$2,$3,'project.limits_update',$4::jsonb)`,
      [
        actorUserId,
        project.accountId,
        project.id,
        JSON.stringify({ before: current, after: mapLimits(result.rows[0]) })
      ]
    );

    return mapLimits(result.rows[0]);
  }

  async consumeRateLimit({
    bucketKey,
    limit,
    windowSeconds = 60
  }) {
    const result = await this.pool.query(
      `WITH bounds AS (
        SELECT
          to_timestamp(
            floor(extract(epoch FROM clock_timestamp()) / $2) * $2
          ) AS window_start
      )
      INSERT INTO api_rate_limit_counters (
        bucket_key, window_start, window_seconds,
        request_count, expires_at
      )
      SELECT
        $1,
        bounds.window_start,
        $2,
        1,
        bounds.window_start
          + ($2::double precision * interval '1 second')
          + interval '1 minute'
      FROM bounds
      ON CONFLICT (bucket_key, window_start)
      DO UPDATE SET
        request_count = api_rate_limit_counters.request_count + 1,
        expires_at = GREATEST(
          api_rate_limit_counters.expires_at,
          EXCLUDED.expires_at
        )
      RETURNING request_count, window_start`,
      [bucketKey, windowSeconds]
    );

    const count = int(result.rows[0]?.request_count);
    const windowStart = new Date(result.rows[0].window_start);
    const resetAt = new Date(
      windowStart.getTime() + windowSeconds * 1000
    );
    const now = Date.now();

    return {
      allowed: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      resetAt: resetAt.toISOString(),
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((resetAt.getTime() - now) / 1000)
      )
    };
  }

  async consumeProjectRateLimit(projectId, group, limit) {
    return this.consumeRateLimit({
      bucketKey: `project:${projectId}:${group}`,
      limit,
      windowSeconds: 60
    });
  }

  async consumeDailyIngestQuota(projectId, limit) {
    const result = await this.pool.query(
      `INSERT INTO project_usage_daily (
        project_id, usage_date, ingest_count, read_count
      ) VALUES ($1, CURRENT_DATE, 1, 0)
      ON CONFLICT (project_id, usage_date)
      DO UPDATE SET
        ingest_count = project_usage_daily.ingest_count + 1
      WHERE project_usage_daily.ingest_count < $2
      RETURNING ingest_count`,
      [projectId, limit]
    );

    if (!result.rows.length) {
      return { allowed: false, limit, remaining: 0 };
    }

    const count = int(result.rows[0].ingest_count);
    return {
      allowed: count <= limit,
      limit,
      remaining: Math.max(0, limit - count)
    };
  }

  async recordRead(projectId) {
    await this.pool.query(
      `INSERT INTO project_usage_daily (
        project_id, usage_date, ingest_count, read_count
      ) VALUES ($1, CURRENT_DATE, 0, 1)
      ON CONFLICT (project_id, usage_date)
      DO UPDATE SET
        read_count = project_usage_daily.read_count + 1`,
      [projectId]
    );
  }

  async recordUsage({
    projectId,
    keyRef,
    route,
    statusCode,
    latencyMs
  }) {
    const statusClass = Math.max(
      1,
      Math.min(5, Math.floor(Number(statusCode) / 100))
    );
    const latency = Math.max(
      0,
      Math.min(3600000, Math.round(Number(latencyMs) || 0))
    );

    await this.pool.query(
      `INSERT INTO api_usage_hourly (
        project_id, key_ref, bucket_hour, route, status_class,
        request_count, error_count, latency_ms_sum, latency_ms_max
      ) VALUES (
        $1,$2,date_trunc('hour', now()),$3,$4,
        1,$5,$6::bigint,$7::integer
      )
      ON CONFLICT (
        project_id, key_ref, bucket_hour, route, status_class
      )
      DO UPDATE SET
        request_count = api_usage_hourly.request_count + 1,
        error_count = api_usage_hourly.error_count + EXCLUDED.error_count,
        latency_ms_sum = api_usage_hourly.latency_ms_sum + EXCLUDED.latency_ms_sum,
        latency_ms_max = GREATEST(
          api_usage_hourly.latency_ms_max,
          EXCLUDED.latency_ms_max
        )`,
      [
        projectId,
        String(keyRef || "unknown"),
        route,
        statusClass,
        statusCode >= 400 ? 1 : 0,
        latency,
        latency
      ]
    );
  }

  async recordSecurityEvent({
    projectId = null,
    keyRef = null,
    eventType,
    severity = "warning",
    sourceHash = null,
    metadata = {}
  }) {
    await this.pool.query(
      `INSERT INTO security_events (
        project_id, key_ref, event_type, severity,
        source_hash, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [
        projectId,
        keyRef,
        eventType,
        severity,
        sourceHash,
        JSON.stringify(metadata)
      ]
    );
  }

  async getProjectMetrics(projectId, { hours = 24 } = {}) {
    const boundedHours = Math.min(
      Math.max(Number(hours) || 24, 1),
      24 * 31
    );

    const [usage, daily, security] = await Promise.all([
      this.pool.query(
        `SELECT
            bucket_hour,
            route,
            sum(request_count)::bigint AS requests,
            sum(error_count)::bigint AS errors,
            sum(latency_ms_sum)::bigint AS latency_sum,
            max(latency_ms_max)::int AS latency_max
         FROM api_usage_hourly
         WHERE project_id = $1
           AND bucket_hour >= now() - ($2::double precision * interval '1 hour')
         GROUP BY bucket_hour, route
         ORDER BY bucket_hour DESC, route ASC`,
        [projectId, boundedHours]
      ),
      this.pool.query(
        `SELECT usage_date, ingest_count, read_count
         FROM project_usage_daily
         WHERE project_id = $1
           AND usage_date >= CURRENT_DATE - 30
         ORDER BY usage_date DESC`,
        [projectId]
      ),
      this.pool.query(
        `SELECT
            count(*)::int AS total,
            count(*) FILTER (WHERE severity = 'critical')::int AS critical,
            count(*) FILTER (WHERE severity = 'warning')::int AS warning
         FROM security_events
         WHERE project_id = $1
           AND created_at >= now() - ($2::double precision * interval '1 hour')`,
        [projectId, boundedHours]
      )
    ]);

    let requests = 0;
    let errors = 0;
    let latencySum = 0;
    let latencyMax = 0;
    for (const row of usage.rows) {
      requests += int(row.requests);
      errors += int(row.errors);
      latencySum += int(row.latency_sum);
      latencyMax = Math.max(latencyMax, int(row.latency_max));
    }

    return {
      hours: boundedHours,
      totals: {
        requests,
        errors,
        errorRate: requests
          ? Number((errors / requests).toFixed(4))
          : 0,
        averageLatencyMs: requests
          ? Math.round(latencySum / requests)
          : 0,
        maxLatencyMs: latencyMax,
        securityEvents: int(security.rows[0]?.total),
        criticalSecurityEvents: int(security.rows[0]?.critical),
        warningSecurityEvents: int(security.rows[0]?.warning)
      },
      hourly: usage.rows.map((row) => ({
        hour: iso(row.bucket_hour),
        route: row.route,
        requests: int(row.requests),
        errors: int(row.errors),
        averageLatencyMs: int(row.requests)
          ? Math.round(int(row.latency_sum) / int(row.requests))
          : 0,
        maxLatencyMs: int(row.latency_max)
      })),
      dailyUsage: daily.rows.map((row) => ({
        date: String(row.usage_date).slice(0, 10),
        ingest: int(row.ingest_count),
        read: int(row.read_count)
      }))
    };
  }

  async listSecurityEvents(projectId, {
    limit = 50,
    cursor = ""
  } = {}) {
    const pageSize = Math.min(
      Math.max(Number(limit) || 50, 1),
      200
    );
    const decoded = decodeCursor(cursor, ["createdAt", "id"]);
    const params = [projectId];
    let cursorSql = "";

    if (decoded) {
      const date = new Date(decoded.createdAt);
      const id = String(decoded.id || "");
      if (
        Number.isNaN(date.getTime()) ||
        !/^[0-9]+$/.test(id)
      ) {
        throw new OperationsStoreError("invalid_cursor", 400);
      }
      params.push(date.toISOString(), id);
      cursorSql = `
        AND (
          created_at < $2::timestamptz
          OR (created_at = $2::timestamptz AND id < $3)
        )`;
    }

    params.push(pageSize + 1);
    const limitParam = params.length;

    const result = await this.pool.query(
      `SELECT id, project_id, key_ref, event_type, severity,
              metadata, created_at
       FROM security_events
       WHERE project_id = $1
       ${cursorSql}
       ORDER BY created_at DESC, id DESC
       LIMIT $${limitParam}`,
      params
    );

    const hasMore = result.rows.length > pageSize;
    const rows = result.rows.slice(0, pageSize);
    const last = rows.at(-1);

    return {
      events: rows.map((row) => ({
        id: String(row.id),
        projectId: row.project_id,
        keyRef: row.key_ref,
        eventType: row.event_type,
        severity: row.severity,
        metadata: row.metadata || {},
        createdAt: iso(row.created_at)
      })),
      nextCursor: hasMore && last
        ? encodeCursor({
            createdAt: iso(last.created_at),
            id: String(last.id)
          })
        : null
    };
  }

  async runRetentionBatch({ batchSize = 5000 } = {}) {
    const size = Math.min(
      Math.max(Number(batchSize) || 5000, 100),
      50000
    );
    const run = await this.pool.query(
      `INSERT INTO retention_runs (status)
       VALUES ('running')
       RETURNING id, started_at`
    );
    const runId = run.rows[0].id;

    try {
      const history = await this.pool.query(
        `WITH doomed AS (
          SELECT h.ctid
          FROM location_history h
          JOIN projects p ON p.id = h.project_id
          LEFT JOIN project_limits l ON l.project_id = p.id
          WHERE h.received_at <
            now() - (
              COALESCE(l.history_retention_days, $2)::double precision
              * interval '1 day'
            )
          ORDER BY h.received_at ASC
          LIMIT $1
        )
        DELETE FROM location_history h
        USING doomed d
        WHERE h.ctid = d.ctid
        RETURNING h.id`,
        [size, DEFAULT_LIMITS.historyRetentionDays]
      );

      const security = await this.pool.query(
        `WITH doomed AS (
          SELECT e.ctid
          FROM security_events e
          LEFT JOIN project_limits l ON l.project_id = e.project_id
          WHERE e.created_at <
            now() - (
              COALESCE(l.security_event_retention_days, $2)::double precision
              * interval '1 day'
            )
          ORDER BY e.created_at ASC
          LIMIT $1
        )
        DELETE FROM security_events e
        USING doomed d
        WHERE e.ctid = d.ctid
        RETURNING e.id`,
        [size, DEFAULT_LIMITS.securityEventRetentionDays]
      );

      const metrics = await this.pool.query(
        `WITH doomed AS (
          SELECT m.ctid
          FROM api_usage_hourly m
          JOIN projects p ON p.id = m.project_id
          LEFT JOIN project_limits l ON l.project_id = p.id
          WHERE m.bucket_hour <
            now() - (
              COALESCE(l.metrics_retention_days, $2)::double precision
              * interval '1 day'
            )
          ORDER BY m.bucket_hour ASC
          LIMIT $1
        )
        DELETE FROM api_usage_hourly m
        USING doomed d
        WHERE m.ctid = d.ctid
        RETURNING m.project_id`,
        [size, DEFAULT_LIMITS.metricsRetentionDays]
      );

      const realtime = await this.pool.query(
        `WITH doomed AS (
          SELECT e.ctid
          FROM realtime_events e
          LEFT JOIN project_limits l ON l.project_id = e.project_id
          WHERE e.created_at <
            now() - (
              COALESCE(l.realtime_event_retention_hours, $2)::double precision
              * interval '1 hour'
            )
          ORDER BY e.created_at ASC
          LIMIT $1
        )
        DELETE FROM realtime_events e
        USING doomed d
        WHERE e.ctid = d.ctid
        RETURNING e.id`,
        [size, DEFAULT_LIMITS.realtimeEventRetentionHours]
      );

      const webhookDeliveries =
        await this.pool.query(
          `WITH doomed AS (
            SELECT d.ctid
            FROM webhook_deliveries d
            JOIN projects p
              ON p.id = d.project_id
            LEFT JOIN project_limits l
              ON l.project_id = p.id
            WHERE d.status IN (
                'delivered',
                'dead'
              )
              AND d.updated_at <
                now() - (
                  COALESCE(
                    l.webhook_delivery_retention_days,
                    $2
                  )::double precision
                  * interval '1 day'
                )
            ORDER BY d.updated_at ASC
            LIMIT $1
          )
          DELETE FROM webhook_deliveries d
          USING doomed x
          WHERE d.ctid = x.ctid
          RETURNING d.id`,
          [
            size,
            DEFAULT_LIMITS
              .webhookDeliveryRetentionDays
          ]
        );

      const geofenceEvents =
        await this.pool.query(
          `WITH doomed AS (
            SELECT e.ctid
            FROM geofence_events e
            JOIN projects p
              ON p.id = e.project_id
            LEFT JOIN project_limits l
              ON l.project_id = p.id
            WHERE e.created_at <
                now() - (
                  COALESCE(
                    l.geofence_event_retention_days,
                    $2
                  )::double precision
                  * interval '1 day'
                )
              AND NOT EXISTS (
                SELECT 1
                FROM webhook_deliveries d
                WHERE d.geofence_event_id =
                  e.id
              )
            ORDER BY e.created_at ASC
            LIMIT $1
          )
          DELETE FROM geofence_events e
          USING doomed x
          WHERE e.ctid = x.ctid
          RETURNING e.id`,
          [
            size,
            DEFAULT_LIMITS
              .geofenceEventRetentionDays
          ]
        );

      const exchangeNonces =
        await this.pool.query(
          `WITH doomed AS (
            SELECT n.ctid
            FROM client_exchange_nonces n
            WHERE n.expires_at < now()
            ORDER BY n.expires_at ASC
            LIMIT $1
          )
          DELETE FROM client_exchange_nonces n
          USING doomed d
          WHERE n.ctid = d.ctid
          RETURNING n.nonce_hash`,
          [size]
        );

      const requestNonces =
        await this.pool.query(
          `WITH doomed AS (
            SELECT n.ctid
            FROM client_request_nonces n
            WHERE n.expires_at < now()
            ORDER BY n.expires_at ASC
            LIMIT $1
          )
          DELETE FROM client_request_nonces n
          USING doomed d
          WHERE n.ctid = d.ctid
          RETURNING n.nonce_hash`,
          [size]
        );

      const counters = await this.pool.query(
        `DELETE FROM api_rate_limit_counters
         WHERE expires_at < now()
         RETURNING bucket_key`
      );

      await this.pool.query(
        `DELETE FROM project_usage_daily
         WHERE usage_date < CURRENT_DATE - 400`
      );

      const billingTrackedUsers =
        await this.pool.query(
          `WITH doomed AS (
            SELECT u.ctid
            FROM billing_tracked_users_daily u
            WHERE u.usage_date < CURRENT_DATE - 400
            ORDER BY u.usage_date ASC
            LIMIT $1
          )
          DELETE FROM billing_tracked_users_daily u
          USING doomed d
          WHERE u.ctid = d.ctid
          RETURNING u.external_user_id`,
          [size]
        );

      const sessions = await this.pool.query(
        `DELETE FROM admin_sessions
         WHERE (
           expires_at < now() - interval '1 day'
           OR (
             revoked_at IS NOT NULL
             AND revoked_at < now() - interval '7 days'
           )
         )
         RETURNING id`
      );

      const summary = {
        historyDeleted: history.rowCount,
        securityEventsDeleted: security.rowCount,
        metricsDeleted: metrics.rowCount,
        realtimeEventsDeleted: realtime.rowCount,
        geofenceEventsDeleted:
          geofenceEvents.rowCount,
        webhookDeliveriesDeleted:
          webhookDeliveries.rowCount,
        clientExchangeNoncesDeleted:
          exchangeNonces.rowCount,
        clientRequestNoncesDeleted:
          requestNonces.rowCount,
        billingTrackedUsersDeleted:
          billingTrackedUsers.rowCount,
        rateCountersDeleted: counters.rowCount,
        sessionsDeleted: sessions.rowCount
      };

      await this.pool.query(
        `UPDATE retention_runs
         SET finished_at = now(),
             history_deleted = $2,
             security_events_deleted = $3,
             metrics_deleted = $4,
             realtime_events_deleted = $5,
             geofence_events_deleted = $6,
             webhook_deliveries_deleted = $7,
             client_exchange_nonces_deleted = $8,
             client_request_nonces_deleted = $9,
             billing_tracked_users_deleted = $10,
             rate_counters_deleted = $11,
             sessions_deleted = $12,
             status = 'success'
         WHERE id = $1`,
        [
          runId,
          summary.historyDeleted,
          summary.securityEventsDeleted,
          summary.metricsDeleted,
          summary.realtimeEventsDeleted,
          summary.geofenceEventsDeleted,
          summary.webhookDeliveriesDeleted,
          summary.clientExchangeNoncesDeleted,
          summary.clientRequestNoncesDeleted,
          summary.billingTrackedUsersDeleted,
          summary.rateCountersDeleted,
          summary.sessionsDeleted
        ]
      );

      return { runId: Number(runId), ...summary };
    } catch (error) {
      await this.pool.query(
        `UPDATE retention_runs
         SET finished_at = now(),
             status = 'failed',
             error_code = $2
         WHERE id = $1`,
        [runId, String(error.code || "retention_failed").slice(0, 120)]
      ).catch(() => {});
      throw error;
    }
  }
}

export { DEFAULT_LIMITS };
