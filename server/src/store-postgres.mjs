import {
  decodeCursor,
  encodeCursor
} from "./cursor.mjs";
import {
  evaluateLocationAutomation
} from "./automation-store-postgres.mjs";

function iso(value) {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? undefined
    : date.toISOString();
}

function mapRow(row) {
  if (!row) return null;
  return {
    projectId: row.project_id,
    userId: row.external_user_id,
    name: row.display_name ?? undefined,
    email: row.email ?? undefined,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    accuracyM:
      row.accuracy_m == null
        ? undefined
        : Number(row.accuracy_m),
    altitudeM:
      row.altitude_m == null
        ? undefined
        : Number(row.altitude_m),
    headingDeg:
      row.heading_deg == null
        ? undefined
        : Number(row.heading_deg),
    speedMps:
      row.speed_mps == null
        ? undefined
        : Number(row.speed_mps),
    capturedAt: iso(row.captured_at),
    receivedAt: iso(row.received_at),
    lastSeenAt: iso(row.received_at),
    country: row.country ?? undefined,
    state: row.state ?? undefined,
    city: row.city ?? undefined,
    device: row.device ?? undefined,
    metadata: row.metadata ?? undefined,
    status: row.status ?? undefined
  };
}
function mapHistoryRow(row) {
  if (!row) return null;
  return {
    projectId: row.project_id,
    userId: row.external_user_id,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    accuracyM:
      row.accuracy_m == null
        ? undefined
        : Number(row.accuracy_m),
    altitudeM:
      row.altitude_m == null
        ? undefined
        : Number(row.altitude_m),
    headingDeg:
      row.heading_deg == null
        ? undefined
        : Number(row.heading_deg),
    speedMps:
      row.speed_mps == null
        ? undefined
        : Number(row.speed_mps),
    capturedAt: iso(row.captured_at),
    receivedAt: iso(row.received_at),
    country: row.country ?? undefined,
    state: row.state ?? undefined,
    city: row.city ?? undefined
  };
}


export class GeoLiveStoreError extends Error {
  constructor(code, status = 400, message = code) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export class PostgresGeoLiveStore {
  kind = "postgres";

  constructor({ pool }) {
    if (!pool) {
      throw new Error(
        "PostgresGeoLiveStore requires a pool."
      );
    }
    this.pool = pool;
  }

  async ready() {
    try {
      const result = await this.pool.query(`
        SELECT
          EXISTS (
            SELECT 1 FROM pg_extension WHERE extname = 'postgis'
          ) AS postgis,
          to_regclass('public.projects') IS NOT NULL AS projects,
          to_regclass('public.live_user_state') IS NOT NULL AS live_state,
          to_regclass('public.location_history') IS NOT NULL AS history
      `);
      const row = result.rows[0] || {};
      return Boolean(
        row.postgis &&
        row.projects &&
        row.live_state &&
        row.history
      );
    } catch {
      return false;
    }
  }

  async assertReady() {
    if (!(await this.ready())) {
      throw new Error(
        "PostgreSQL/PostGIS is not ready. Run npm run migrate first."
      );
    }
  }

  async close() {
    await this.pool.end();
  }

  async upsertLocation(projectId, observation) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Serialize writes for one project/user pair so geofence state
      // transitions are evaluated in arrival order.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1::text || ':' || $2::text, 0))",
        [
          projectId,
          observation.userId
        ]
      );

      const project = await client.query(
        "SELECT status FROM projects WHERE id = $1 FOR SHARE",
        [projectId]
      );
      if (!project.rows.length) {
        throw new GeoLiveStoreError(
          "project_not_found",
          404
        );
      }
      if (project.rows[0].status !== "active") {
        throw new GeoLiveStoreError(
          "project_not_active",
          403
        );
      }

      let existing = await client.query(
        `SELECT 1
         FROM users
         WHERE project_id = $1
           AND external_user_id = $2
         LIMIT 1`,
        [projectId, observation.userId]
      );

      if (!existing.rows.length) {
        // Serialize only new-user quota checks for this project.
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
          [projectId]
        );

        existing = await client.query(
          `SELECT 1
           FROM users
           WHERE project_id = $1
             AND external_user_id = $2
           LIMIT 1`,
          [projectId, observation.userId]
        );

        if (!existing.rows.length) {
          const quota = await client.query(
            `SELECT
                COALESCE(
                  (
                    SELECT max_live_users
                    FROM project_limits
                    WHERE project_id = $1
                  ),
                  100000
                )::int AS max_live_users,
                (
                  SELECT count(*)::int
                  FROM users
                  WHERE project_id = $1
                ) AS current_users`,
            [projectId]
          );
          const row = quota.rows[0];
          if (
            Number(row.current_users) >=
            Number(row.max_live_users)
          ) {
            throw new GeoLiveStoreError(
              "project_live_user_quota_exceeded",
              429
            );
          }
        }
      }

      await client.query(
        `INSERT INTO users (
          project_id,
          external_user_id,
          display_name,
          email,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, now(), now())
        ON CONFLICT (project_id, external_user_id)
        DO UPDATE SET
          display_name = COALESCE(
            EXCLUDED.display_name,
            users.display_name
          ),
          email = COALESCE(
            EXCLUDED.email,
            users.email
          ),
          updated_at = now()`,
        [
          projectId,
          observation.userId,
          observation.name ?? null,
          observation.email ?? null
        ]
      );

      const values = [
        projectId,
        observation.userId,
        observation.latitude,
        observation.longitude,
        observation.accuracyM ?? null,
        observation.altitudeM ?? null,
        observation.headingDeg ?? null,
        observation.speedMps ?? null,
        observation.capturedAt ?? null,
        observation.receivedAt,
        observation.country ?? null,
        observation.state ?? null,
        observation.city ?? null,
        observation.device ?? null,
        observation.metadata ?? null
      ];

      const latest = await client.query(
        `INSERT INTO live_user_state (
          project_id,
          external_user_id,
          location,
          latitude,
          longitude,
          accuracy_m,
          altitude_m,
          heading_deg,
          speed_mps,
          captured_at,
          received_at,
          country,
          state,
          city,
          device,
          metadata
        ) VALUES (
          $1,
          $2,
          ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          $14::jsonb,
          $15::jsonb
        )
        ON CONFLICT (project_id, external_user_id)
        DO UPDATE SET
          location = EXCLUDED.location,
          latitude = EXCLUDED.latitude,
          longitude = EXCLUDED.longitude,
          accuracy_m = EXCLUDED.accuracy_m,
          altitude_m = EXCLUDED.altitude_m,
          heading_deg = EXCLUDED.heading_deg,
          speed_mps = EXCLUDED.speed_mps,
          captured_at = EXCLUDED.captured_at,
          received_at = EXCLUDED.received_at,
          country = COALESCE(
            EXCLUDED.country,
            live_user_state.country
          ),
          state = COALESCE(
            EXCLUDED.state,
            live_user_state.state
          ),
          city = COALESCE(
            EXCLUDED.city,
            live_user_state.city
          ),
          device = COALESCE(
            EXCLUDED.device,
            live_user_state.device
          ),
          metadata = COALESCE(
            EXCLUDED.metadata,
            live_user_state.metadata
          )
        WHERE live_user_state.received_at <= EXCLUDED.received_at
        RETURNING
          project_id,
          external_user_id,
          latitude,
          longitude,
          accuracy_m,
          altitude_m,
          heading_deg,
          speed_mps,
          captured_at,
          received_at,
          country,
          state,
          city,
          device,
          metadata`,
        values
      );

      const history = await client.query(
        `INSERT INTO location_history (
          project_id,
          external_user_id,
          location,
          latitude,
          longitude,
          accuracy_m,
          altitude_m,
          heading_deg,
          speed_mps,
          captured_at,
          received_at,
          country,
          state,
          city,
          device,
          metadata
        ) VALUES (
          $1,
          $2,
          ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          $14::jsonb,
          $15::jsonb
        )
        RETURNING id`,
        values
      );

      const identity = await client.query(
        `SELECT display_name, email
         FROM users
         WHERE project_id = $1
           AND external_user_id = $2`,
        [projectId, observation.userId]
      );

      const row = latest.rows[0] || {
        project_id: projectId,
        external_user_id: observation.userId,
        latitude: observation.latitude,
        longitude: observation.longitude,
        accuracy_m: observation.accuracyM,
        altitude_m: observation.altitudeM,
        heading_deg: observation.headingDeg,
        speed_mps: observation.speedMps,
        captured_at: observation.capturedAt,
        received_at: observation.receivedAt,
        country: observation.country,
        state: observation.state,
        city: observation.city,
        device: observation.device,
        metadata: observation.metadata
      };
      row.display_name =
        identity.rows[0]?.display_name ??
        observation.name ??
        null;
      row.email =
        identity.rows[0]?.email ??
        observation.email ??
        null;

      const mapped = {
        ...mapRow(row),
        status: "online"
      };

      const realtime = await client.query(
        `INSERT INTO realtime_events (
          project_id,
          event_type,
          external_user_id,
          payload
        ) VALUES ($1, 'location', $2, $3::jsonb)
        RETURNING
          id,
          event_id,
          project_id,
          event_type,
          external_user_id,
          created_at`,
        [
          projectId,
          observation.userId,
          JSON.stringify(mapped)
        ]
      );

      // Geofence realtime rows are appended after the location row so
      // live broadcast order matches durable replay sequence order.
      const automationEvents =
        await evaluateLocationAutomation(
          client,
          {
            projectId,
            userId:
              observation.userId,
            historyId:
              history.rows[0]?.id ||
              null,
            record: mapped
          }
        );

      await client.query("COMMIT");

      const eventRow = realtime.rows[0];
      return {
        ...mapped,
        _realtimeEvent: {
          sequence: String(eventRow.id),
          eventId: eventRow.event_id,
          projectId: eventRow.project_id,
          type: eventRow.event_type,
          userId: eventRow.external_user_id,
          payload: mapped,
          createdAt:
            eventRow.created_at instanceof Date
              ? eventRow.created_at.toISOString()
              : new Date(eventRow.created_at).toISOString()
        },
        _automationEvents:
          automationEvents
      };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async listUsersPage(
    projectId,
    {
      search = "",
      status = "",
      country = "",
      state = "",
      city = "",
      limit = 100,
      cursor = "",
      thresholds = {}
    } = {}
  ) {
    const online = Number(
      thresholds.onlineSeconds ?? 120
    );
    const recent = Number(
      thresholds.recentSeconds ?? 900
    );
    const inactive = Number(
      thresholds.inactiveSeconds ?? 86400
    );
    const pageSize = Math.min(
      Math.max(Number(limit) || 100, 1),
      500
    );

    const params = [
      projectId,
      online,
      recent,
      inactive
    ];
    const where = [];

    if (search) {
      params.push(
        `%${String(search).trim()}%`
      );
      const p = params.length;
      where.push(
        `(
          external_user_id ILIKE $${p}
          OR display_name ILIKE $${p}
          OR email ILIKE $${p}
        )`
      );
    }
    if (status) {
      params.push(String(status));
      where.push(
        `status = $${params.length}`
      );
    }
    if (country) {
      params.push(String(country));
      where.push(
        `country = $${params.length}`
      );
    }
    if (state) {
      params.push(String(state));
      where.push(
        `state = $${params.length}`
      );
    }
    if (city) {
      params.push(String(city));
      where.push(
        `city = $${params.length}`
      );
    }

    const decoded = decodeCursor(
      cursor,
      ["receivedAt", "userId"]
    );
    if (decoded) {
      const receivedAt = new Date(
        decoded.receivedAt
      );
      if (
        Number.isNaN(receivedAt.getTime()) ||
        typeof decoded.userId !== "string" ||
        !decoded.userId
      ) {
        throw new GeoLiveStoreError(
          "invalid_cursor",
          400
        );
      }

      params.push(
        receivedAt.toISOString(),
        decoded.userId
      );
      const timeParam = params.length - 1;
      const userParam = params.length;

      where.push(
        `(
          received_at < $${timeParam}::timestamptz
          OR (
            received_at = $${timeParam}::timestamptz
            AND external_user_id < $${userParam}
          )
        )`
      );
    }

    params.push(pageSize + 1);
    const limitParam = params.length;

    const result = await this.pool.query(
      `WITH scoped AS (
        SELECT
          l.project_id,
          l.external_user_id,
          u.display_name,
          u.email,
          l.latitude,
          l.longitude,
          l.accuracy_m,
          l.altitude_m,
          l.heading_deg,
          l.speed_mps,
          l.captured_at,
          l.received_at,
          l.country,
          l.state,
          l.city,
          l.device,
          l.metadata,
          CASE
            WHEN l.received_at >=
              now() - (
                $2::double precision * interval '1 second'
              )
              THEN 'online'
            WHEN l.received_at >=
              now() - (
                $3::double precision * interval '1 second'
              )
              THEN 'recent'
            WHEN l.received_at >=
              now() - (
                $4::double precision * interval '1 second'
              )
              THEN 'offline'
            ELSE 'inactive'
          END AS status
        FROM live_user_state l
        JOIN users u
          ON u.project_id = l.project_id
         AND u.external_user_id =
             l.external_user_id
        WHERE l.project_id = $1
      )
      SELECT *
      FROM scoped
      ${
        where.length
          ? `WHERE ${where.join(" AND ")}`
          : ""
      }
      ORDER BY
        received_at DESC,
        external_user_id DESC
      LIMIT $${limitParam}`,
      params
    );

    const hasMore =
      result.rows.length > pageSize;
    const rows = result.rows.slice(
      0,
      pageSize
    );
    const last = rows.at(-1);

    return {
      users: rows.map(mapRow),
      nextCursor:
        hasMore && last
          ? encodeCursor({
              receivedAt: iso(
                last.received_at
              ),
              userId:
                last.external_user_id
            })
          : null
    };
  }

  async listUsers(projectId, options = {}) {
    const page = await this.listUsersPage(
      projectId,
      options
    );
    return page.users;
  }

  async listMovementHistoryPage(
    projectId,
    {
      userId,
      from,
      to,
      limit = 250,
      cursor = ""
    } = {}
  ) {
    const pageSize = Math.min(
      Math.max(Number(limit) || 250, 1),
      1000
    );
    const params = [
      projectId,
      userId,
      from,
      to
    ];
    const where = [
      "project_id = $1",
      "external_user_id = $2",
      "received_at >= $3::timestamptz",
      "received_at < $4::timestamptz"
    ];

    if (cursor) {
      const decoded = decodeCursor(
        cursor,
        ["receivedAt", "id"]
      );
      const receivedAt =
        new Date(decoded.receivedAt);
      if (
        Number.isNaN(
          receivedAt.getTime()
        ) ||
        !/^\d+$/.test(
          String(decoded.id)
        )
      ) {
        throw Object.assign(
          new Error(
            "invalid_cursor"
          ),
          {
            code: "invalid_cursor",
            status: 400
          }
        );
      }

      params.push(
        receivedAt.toISOString(),
        String(decoded.id)
      );
      const timeParam =
        params.length - 1;
      const idParam =
        params.length;
      const timePlaceholder =
        "$" + timeParam;
      const idPlaceholder =
        "$" + idParam;
      where.push(
        `(
          received_at < ${timePlaceholder}::timestamptz
          OR (
            received_at = ${timePlaceholder}::timestamptz
            AND id < ${idPlaceholder}::bigint
          )
        )`
      );
    }

    params.push(pageSize + 1);
    const limitParam =
      params.length;
    const limitPlaceholder =
      "$" + limitParam;

    const result =
      await this.pool.query(
        `SELECT
          id,
          project_id,
          external_user_id,
          latitude,
          longitude,
          accuracy_m,
          altitude_m,
          heading_deg,
          speed_mps,
          captured_at,
          received_at,
          country,
          state,
          city
        FROM location_history
        WHERE ${where.join(
          " AND "
        )}
        ORDER BY
          received_at DESC,
          id DESC
        LIMIT ${limitPlaceholder}`,
        params
      );

    const hasMore =
      result.rows.length >
      pageSize;
    const rows =
      result.rows.slice(
        0,
        pageSize
      );
    const points =
      rows.map(mapHistoryRow);
    const last =
      rows.at(-1);

    return {
      points,
      nextCursor:
        hasMore && last
          ? encodeCursor({
              receivedAt:
                iso(
                  last.received_at
                ),
              id: String(last.id)
            })
          : null
    };
  }

  async heatmapHistory(
    projectId,
    {
      from,
      to,
      gridDegrees = 2,
      userId = ""
    } = {}
  ) {
    const grid = Math.min(
      Math.max(
        Number(gridDegrees) || 2,
        0.25
      ),
      45
    );
    const params = [
      projectId,
      from,
      to,
      grid
    ];
    const where = [
      "project_id = $1",
      "received_at >= $2::timestamptz",
      "received_at < $3::timestamptz"
    ];

    if (userId) {
      params.push(
        String(userId)
      );
      const userPlaceholder =
        "$" + params.length;
      where.push(
        `external_user_id = ${userPlaceholder}`
      );
    }

    const result =
      await this.pool.query(
        `SELECT
          (
            floor(
              (latitude + 90.0) /
              $4
            ) * $4
            - 90.0
            + $4 / 2.0
          )::double precision
            AS latitude,
          (
            floor(
              (longitude + 180.0) /
              $4
            ) * $4
            - 180.0
            + $4 / 2.0
          )::double precision
            AS longitude,
          count(*)::int
            AS count,
          count(
            DISTINCT external_user_id
          )::int
            AS unique_users,
          min(received_at)
            AS first_seen_at,
          max(received_at)
            AS last_seen_at
        FROM location_history
        WHERE ${where.join(
          " AND "
        )}
        GROUP BY 1, 2
        ORDER BY count DESC
        LIMIT 10000`,
        params
      );

    return result.rows.map(
      (row) => ({
        latitude:
          Number(row.latitude),
        longitude:
          Number(row.longitude),
        count:
          Number(row.count),
        uniqueUsers:
          Number(
            row.unique_users
          ),
        firstSeenAt:
          iso(
            row.first_seen_at
          ),
        lastSeenAt:
          iso(
            row.last_seen_at
          )
      })
    );
  }

  async clusterUsers(
    projectId,
    {
      gridDegrees = 8,
      status = "",
      country = "",
      state = "",
      city = "",
      thresholds = {}
    } = {}
  ) {
    const grid = Math.min(
      Math.max(Number(gridDegrees) || 8, 0.25),
      45
    );
    const online = Number(
      thresholds.onlineSeconds ?? 120
    );
    const recent = Number(
      thresholds.recentSeconds ?? 900
    );
    const inactive = Number(
      thresholds.inactiveSeconds ?? 86400
    );

    const params = [
      projectId,
      online,
      recent,
      inactive,
      grid
    ];
    const where = [];

    if (status) {
      params.push(String(status));
      where.push(`presence = ${params.length}`);
    }
    if (country) {
      params.push(String(country));
      where.push(`country = ${params.length}`);
    }
    if (state) {
      params.push(String(state));
      where.push(`state = ${params.length}`);
    }
    if (city) {
      params.push(String(city));
      where.push(`city = ${params.length}`);
    }

    const result = await this.pool.query(
      `WITH scoped AS (
        SELECT
          latitude,
          longitude,
          country,
          state,
          city,
          CASE
            WHEN received_at >=
              now() - ($2::double precision * interval '1 second')
              THEN 'online'
            WHEN received_at >=
              now() - ($3::double precision * interval '1 second')
              THEN 'recent'
            WHEN received_at >=
              now() - ($4::double precision * interval '1 second')
              THEN 'offline'
            ELSE 'inactive'
          END AS presence
        FROM live_user_state
        WHERE project_id = $1
      ),
      filtered AS (
        SELECT *
        FROM scoped
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      )
      SELECT
        (
          floor((latitude + 90.0) / $5) * $5
          - 90.0
          + $5 / 2.0
        )::double precision AS latitude,
        (
          floor((longitude + 180.0) / $5) * $5
          - 180.0
          + $5 / 2.0
        )::double precision AS longitude,
        count(*)::int AS count,
        count(*) FILTER (WHERE presence = 'online')::int AS online,
        count(*) FILTER (WHERE presence = 'recent')::int AS recent,
        count(*) FILTER (WHERE presence = 'offline')::int AS offline,
        count(*) FILTER (WHERE presence = 'inactive')::int AS inactive
      FROM filtered
      GROUP BY 1, 2
      ORDER BY count DESC
      LIMIT 5000`,
      params
    );

    return result.rows.map((row) => ({
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      count: Number(row.count),
      online: Number(row.online),
      recent: Number(row.recent),
      offline: Number(row.offline),
      inactive: Number(row.inactive)
    }));
  }

  async locationFacets(projectId) {
    const values = async (column, limit) => {
      const allowed = new Set([
        "country",
        "state",
        "city"
      ]);
      if (!allowed.has(column)) {
        throw new GeoLiveStoreError(
          "invalid_facet",
          400
        );
      }
      const result = await this.pool.query(
        `SELECT DISTINCT ${column} AS value
           FROM live_user_state
          WHERE project_id = $1
            AND ${column} IS NOT NULL
            AND btrim(${column}) <> ''
          ORDER BY value ASC
          LIMIT $2`,
        [projectId, limit]
      );
      return result.rows.map(
        (row) => row.value
      );
    };

    const [
      countries,
      states,
      cities
    ] = await Promise.all([
      values("country", 300),
      values("state", 1000),
      values("city", 2000)
    ]);

    return {
      countries,
      states,
      cities
    };
  }

  async summary(projectId, thresholds = {}) {
    const online = Number(
      thresholds.onlineSeconds ?? 120
    );
    const recent = Number(
      thresholds.recentSeconds ?? 900
    );
    const inactive = Number(
      thresholds.inactiveSeconds ?? 86400
    );

    const result = await this.pool.query(
      `SELECT
        count(*)::int AS total,
        count(*) FILTER (
          WHERE received_at >= date_trunc('day', now())
        )::int AS today_active,
        count(*) FILTER (
          WHERE received_at >=
            now() - (
              $2::double precision * interval '1 second'
            )
        )::int AS online,
        count(*) FILTER (
          WHERE received_at <
            now() - (
              $2::double precision * interval '1 second'
            )
            AND received_at >=
            now() - (
              $3::double precision * interval '1 second'
            )
        )::int AS recent,
        count(*) FILTER (
          WHERE received_at <
            now() - (
              $3::double precision * interval '1 second'
            )
            AND received_at >=
            now() - (
              $4::double precision * interval '1 second'
            )
        )::int AS offline,
        count(*) FILTER (
          WHERE received_at <
            now() - (
              $4::double precision * interval '1 second'
            )
        )::int AS inactive
      FROM live_user_state
      WHERE project_id = $1`,
      [
        projectId,
        online,
        recent,
        inactive
      ]
    );

    const row = result.rows[0];
    return {
      total: Number(row.total),
      todayActive: Number(row.today_active),
      online: Number(row.online),
      recent: Number(row.recent),
      offline: Number(row.offline),
      inactive: Number(row.inactive)
    };
  }

  async historyCount(projectId) {
    const result = await this.pool.query(
      `SELECT count(*)::int AS count
       FROM location_history
       WHERE project_id = $1`,
      [projectId]
    );
    return Number(
      result.rows[0]?.count || 0
    );
  }
}
