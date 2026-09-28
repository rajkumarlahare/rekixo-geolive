function iso(value) {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function mapEvent(row) {
  return {
    sequence: String(row.id),
    eventId: row.event_id,
    projectId: row.project_id,
    type: row.event_type,
    userId: row.external_user_id || undefined,
    payload: row.payload || {},
    createdAt: iso(row.created_at)
  };
}

export class PostgresRealtimeStore {
  constructor({ pool }) {
    if (!pool) {
      throw new Error("PostgresRealtimeStore requires a pool.");
    }
    this.pool = pool;
  }

  async ready() {
    try {
      const result = await this.pool.query(`
        SELECT
          to_regclass('public.realtime_events') IS NOT NULL AS events,
          EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'project_limits'
              AND column_name = 'realtime_event_retention_hours'
          ) AS retention_column
      `);
      const row = result.rows[0] || {};
      return Boolean(row.events && row.retention_column);
    } catch {
      return false;
    }
  }

  async assertReady() {
    if (!(await this.ready())) {
      throw new Error(
        "GeoLive realtime schema is not ready. Run npm run migrate first."
      );
    }
  }

  async latestSequence(projectId) {
    const result = await this.pool.query(
      `SELECT COALESCE(max(id), 0)::text AS sequence
       FROM realtime_events
       WHERE project_id = $1`,
      [projectId]
    );
    return String(result.rows[0]?.sequence || "0");
  }

  async replay(projectId, afterSequence, {
    limit = 1000
  } = {}) {
    const after = String(afterSequence || "0");
    if (!/^[0-9]+$/.test(after)) {
      const error = new Error("invalid_realtime_sequence");
      error.code = "invalid_realtime_sequence";
      error.status = 400;
      throw error;
    }

    const pageSize = Math.min(
      Math.max(Number(limit) || 1000, 1),
      5000
    );

    const latestSequence =
      await this.latestSequence(projectId);

    if (
      after !== "0" &&
      (
        BigInt(after) > BigInt(latestSequence) ||
        (
          BigInt(after) < BigInt(latestSequence) &&
          !(
            await this.pool.query(
              `SELECT 1
               FROM realtime_events
               WHERE project_id = $1
                 AND id = $2::bigint
               LIMIT 1`,
              [projectId, after]
            )
          ).rows.length
        )
      )
    ) {
      return {
        events: [],
        hasMore: false,
        resyncRequired: true,
        latestSequence
      };
    }

    const result = await this.pool.query(
      `SELECT
          id,
          event_id,
          project_id,
          event_type,
          external_user_id,
          payload,
          created_at
       FROM realtime_events
       WHERE project_id = $1
         AND id > $2::bigint
       ORDER BY id ASC
       LIMIT $3`,
      [projectId, after, pageSize + 1]
    );

    const hasMore = result.rows.length > pageSize;
    const rows = result.rows.slice(0, pageSize);

    return {
      events: rows.map(mapEvent),
      hasMore,
      resyncRequired: false,
      latestSequence: rows.length
        ? String(rows.at(-1).id)
        : latestSequence
    };
  }
}
