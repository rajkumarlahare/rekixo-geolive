import {
  decodeCursor,
  encodeCursor
} from "./cursor.mjs";
import {
  activeWebhookSigningKey,
  deriveWebhookSecret
} from "./webhook-secrets.mjs";

function iso(value) {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function mapGeofence(row) {
  if (!row) return null;
  let points = null;
  if (row.polygon_geojson) {
    try {
      points =
        JSON.parse(
          row.polygon_geojson
        ).coordinates?.[0] || null;
    } catch {}
  }
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    status: row.status,
    shapeType: row.shape_type,
    latitude:
      row.center_lat == null
        ? null
        : Number(row.center_lat),
    longitude:
      row.center_lng == null
        ? null
        : Number(row.center_lng),
    radiusM:
      row.radius_m == null
        ? null
        : Number(row.radius_m),
    points,
    dwellSeconds:
      Number(row.dwell_seconds || 0),
    metadata: row.metadata || {},
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    deletedAt: iso(row.deleted_at)
  };
}

function mapEndpoint(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    url: row.url,
    status: row.status,
    signingKeyId:
      row.signing_key_id,
    secretGeneration:
      Number(row.secret_generation),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    deletedAt: iso(row.deleted_at)
  };
}

function mapRule(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    geofenceId:
      row.geofence_id || null,
    webhookEndpointId:
      row.webhook_endpoint_id,
    name: row.name,
    enabled: Boolean(row.enabled),
    eventTypes:
      row.event_types || [],
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    deletedAt: iso(row.deleted_at)
  };
}

function mapEvent(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    eventId: row.event_id,
    projectId: row.project_id,
    geofenceId: row.geofence_id,
    geofenceName:
      row.geofence_name || undefined,
    userId: row.external_user_id,
    eventType: row.event_type,
    occurredAt: iso(row.occurred_at),
    payload: row.payload || {},
    createdAt: iso(row.created_at)
  };
}

function mapDelivery(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    deliveryId: row.delivery_id,
    projectId: row.project_id,
    webhookEndpointId:
      row.webhook_endpoint_id,
    endpointName:
      row.endpoint_name || undefined,
    endpointUrl:
      row.endpoint_url || undefined,
    alertRuleId: row.alert_rule_id,
    alertRuleName:
      row.alert_rule_name || undefined,
    geofenceEventId:
      String(row.geofence_event_id),
    eventId:
      row.event_id || undefined,
    eventType:
      row.event_type || undefined,
    occurredAt:
      iso(row.occurred_at),
    userId:
      row.external_user_id || undefined,
    geofenceId:
      row.geofence_id || undefined,
    geofenceName:
      row.geofence_name || undefined,
    status: row.status,
    attemptCount:
      Number(row.attempt_count || 0),
    nextAttemptAt:
      iso(row.next_attempt_at),
    responseStatus:
      row.response_status == null
        ? null
        : Number(row.response_status),
    responseBodyExcerpt:
      row.response_body_excerpt || null,
    lastError:
      row.last_error || null,
    deliveredAt:
      iso(row.delivered_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

function mapDeliveryAttempt(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    attemptNumber:
      Number(row.attempt_number),
    startedAt:
      iso(row.started_at),
    completedAt:
      iso(row.completed_at),
    responseStatus:
      row.response_status == null
        ? null
        : Number(row.response_status),
    latencyMs:
      Number(row.latency_ms || 0),
    errorText:
      row.error_text || null
  };
}

async function scheduleDeliveries(
  client,
  {
    projectId,
    geofenceId,
    eventId,
    eventType
  }
) {
  await client.query(
    `INSERT INTO webhook_deliveries (
      project_id,
      webhook_endpoint_id,
      alert_rule_id,
      geofence_event_id
    )
    SELECT
      r.project_id,
      r.webhook_endpoint_id,
      r.id,
      $3::bigint
    FROM alert_rules r
    JOIN webhook_endpoints e
      ON e.id = r.webhook_endpoint_id
    WHERE r.project_id = $1
      AND r.deleted_at IS NULL
      AND r.enabled = true
      AND (
        r.geofence_id IS NULL
        OR r.geofence_id = $2
      )
      AND $4 = ANY(r.event_types)
      AND e.project_id = r.project_id
      AND e.status = 'active'
      AND e.deleted_at IS NULL
      AND EXISTS (
        SELECT 1
        FROM projects p
        JOIN account_subscriptions sub
          ON sub.account_id = p.account_id
        JOIN commercial_plans plan
          ON plan.id = sub.plan_id
        LEFT JOIN account_entitlement_overrides o
          ON o.account_id = p.account_id
         AND o.entitlement_key = 'webhooks'
        WHERE p.id = r.project_id
          AND sub.status IN (
            'active',
            'trialing'
          )
          AND COALESCE(
            CASE
              WHEN o.value IS NULL
                THEN NULL
              ELSE (o.value #>> '{}')::boolean
            END,
            COALESCE(
              (
                plan.features ->>
                  'webhooks'
              )::boolean,
              false
            )
          ) = true
      )
    ON CONFLICT (
      alert_rule_id,
      geofence_event_id
    ) DO NOTHING`,
    [
      projectId,
      geofenceId,
      eventId,
      eventType
    ]
  );
}

async function createEvent(
  client,
  {
    projectId,
    geofence,
    userId,
    historyId = null,
    eventType,
    occurredAt,
    location = null
  }
) {
  const payload = {
    type: `geofence.${eventType}`,
    projectId,
    geofence: {
      id: geofence.id,
      name: geofence.name
    },
    userId,
    occurredAt,
    location: location
      ? {
          latitude:
            Number(location.latitude),
          longitude:
            Number(location.longitude),
          accuracyM:
            location.accuracyM == null
              ? null
              : Number(location.accuracyM)
        }
      : null
  };

  const inserted = await client.query(
    `INSERT INTO geofence_events (
      project_id,
      geofence_id,
      external_user_id,
      source_history_id,
      event_type,
      occurred_at,
      payload
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7::jsonb
    )
    RETURNING
      id,
      event_id,
      project_id,
      geofence_id,
      external_user_id,
      event_type,
      occurred_at,
      payload,
      created_at`,
    [
      projectId,
      geofence.id,
      userId,
      historyId,
      eventType,
      occurredAt,
      JSON.stringify(payload)
    ]
  );

  const row = inserted.rows[0];

  const realtime =
    await client.query(
      `INSERT INTO realtime_events (
        event_id,
        project_id,
        event_type,
        external_user_id,
        payload
      ) VALUES (
        $1,$2,$3,$4,$5::jsonb
      )
      RETURNING
        id,
        event_id,
        project_id,
        event_type,
        external_user_id,
        created_at`,
      [
        row.event_id,
        projectId,
        `geofence.${eventType}`,
        userId,
        JSON.stringify(payload)
      ]
    );

  await scheduleDeliveries(
    client,
    {
      projectId,
      geofenceId: geofence.id,
      eventId: row.id,
      eventType
    }
  );

  return {
    ...mapEvent({
      ...row,
      geofence_name:
        geofence.name
    }),
    realtime: {
      sequence:
        String(
          realtime.rows[0].id
        ),
      eventId:
        realtime.rows[0]
          .event_id,
      projectId,
      type:
        `geofence.${eventType}`,
      userId,
      payload: {
        ...payload,
        eventId: row.event_id
      },
      createdAt:
        iso(
          realtime.rows[0]
            .created_at
        )
    }
  };
}

export async function evaluateLocationAutomation(
  client,
  {
    projectId,
    userId,
    historyId,
    record
  }
) {
  const receivedAt =
    record.receivedAt ||
    new Date().toISOString();

  const result = await client.query(
    `SELECT
      g.id,
      g.name,
      g.dwell_seconds,
      CASE
        WHEN g.shape_type = 'circle'
          THEN ST_DWithin(
            g.center,
            ST_SetSRID(
              ST_MakePoint($4,$3),
              4326
            )::geography,
            g.radius_m
          )
        ELSE ST_Covers(
          g.polygon,
          ST_SetSRID(
            ST_MakePoint($4,$3),
            4326
          )
        )
      END AS is_inside,
      s.is_inside AS was_inside,
      s.entered_at,
      s.dwell_due_at,
      s.dwell_fired_at
    FROM geofences g
    LEFT JOIN geofence_user_state s
      ON s.project_id = g.project_id
     AND s.geofence_id = g.id
     AND s.external_user_id = $2
    WHERE g.project_id = $1
      AND g.status = 'active'
      AND g.deleted_at IS NULL
      AND EXISTS (
        SELECT 1
        FROM projects p
        JOIN account_subscriptions sub
          ON sub.account_id =
            p.account_id
        JOIN commercial_plans plan
          ON plan.id = sub.plan_id
        LEFT JOIN
          account_entitlement_overrides o
          ON o.account_id =
            p.account_id
         AND o.entitlement_key =
            'geofences'
        WHERE p.id =
          g.project_id
          AND sub.status IN (
            'active',
            'trialing'
          )
          AND COALESCE(
            CASE
              WHEN o.value IS NULL
                THEN NULL
              ELSE
                (o.value #>> '{}')::boolean
            END,
            COALESCE(
              (
                plan.features ->>
                  'geofences'
              )::boolean,
              false
            )
          ) = true
      )
    ORDER BY g.id`,
    [
      projectId,
      userId,
      Number(record.latitude),
      Number(record.longitude)
    ]
  );

  const events = [];

  for (const row of result.rows) {
    const inside =
      Boolean(row.is_inside);
    const wasInside =
      Boolean(row.was_inside);
    const previousEntered =
      iso(row.entered_at);
    const previousDue =
      iso(row.dwell_due_at);
    const previousFired =
      iso(row.dwell_fired_at);
    const dwellSeconds =
      Number(row.dwell_seconds || 0);

    let enteredAt = null;
    let dwellDueAt = null;
    let dwellFiredAt = null;
    let eventType = "";

    if (inside) {
      if (!wasInside) {
        enteredAt = receivedAt;
        dwellDueAt =
          dwellSeconds > 0
            ? new Date(
                new Date(receivedAt)
                  .getTime() +
                dwellSeconds * 1000
              ).toISOString()
            : null;
        eventType = "enter";
      } else {
        enteredAt =
          previousEntered ||
          receivedAt;
        dwellDueAt =
          previousDue ||
          (
            dwellSeconds > 0
              ? new Date(
                  new Date(enteredAt)
                    .getTime() +
                  dwellSeconds * 1000
                ).toISOString()
              : null
          );
        dwellFiredAt =
          previousFired;

        if (
          dwellDueAt &&
          !dwellFiredAt &&
          new Date(receivedAt)
            .getTime() >=
            new Date(dwellDueAt)
              .getTime()
        ) {
          eventType = "dwell";
          dwellFiredAt =
            receivedAt;
        }
      }
    } else if (wasInside) {
      eventType = "exit";
    }

    await client.query(
      `INSERT INTO geofence_user_state (
        project_id,
        geofence_id,
        external_user_id,
        is_inside,
        entered_at,
        dwell_due_at,
        dwell_fired_at,
        last_seen_at,
        updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,now()
      )
      ON CONFLICT (
        project_id,
        geofence_id,
        external_user_id
      )
      DO UPDATE SET
        is_inside = EXCLUDED.is_inside,
        entered_at = EXCLUDED.entered_at,
        dwell_due_at = EXCLUDED.dwell_due_at,
        dwell_fired_at =
          EXCLUDED.dwell_fired_at,
        last_seen_at =
          EXCLUDED.last_seen_at,
        updated_at = now()`,
      [
        projectId,
        row.id,
        userId,
        inside,
        inside ? enteredAt : null,
        inside ? dwellDueAt : null,
        inside ? dwellFiredAt : null,
        receivedAt
      ]
    );

    if (eventType) {
      events.push(
        await createEvent(
          client,
          {
            projectId,
            geofence: {
              id: row.id,
              name: row.name
            },
            userId,
            historyId,
            eventType,
            occurredAt:
              receivedAt,
            location: record
          }
        )
      );
    }
  }

  return events;
}

export class PostgresAutomationStore {
  constructor({
    pool,
    webhookSigningKeys = []
  }) {
    if (!pool) {
      throw new Error(
        "PostgresAutomationStore requires a pool."
      );
    }
    this.pool = pool;
    this.webhookSigningKeys =
      webhookSigningKeys;
  }

  async ready() {
    try {
      const result =
        await this.pool.query(`
          SELECT
            to_regclass(
              'public.geofences'
            ) IS NOT NULL AS geofences,
            to_regclass(
              'public.geofence_events'
            ) IS NOT NULL AS events,
            to_regclass(
              'public.webhook_endpoints'
            ) IS NOT NULL AS endpoints,
            to_regclass(
              'public.alert_rules'
            ) IS NOT NULL AS rules,
            to_regclass(
              'public.webhook_deliveries'
            ) IS NOT NULL AS deliveries
        `);
      const row = result.rows[0] || {};
      return Boolean(
        row.geofences &&
        row.events &&
        row.endpoints &&
        row.rules &&
        row.deliveries
      );
    } catch {
      return false;
    }
  }

  async assertReady() {
    if (!(await this.ready())) {
      throw new Error(
        "GeoLive automation schema is not ready. Run npm run migrate first."
      );
    }
  }

  async listGeofences(
    projectId
  ) {
    const result =
      await this.pool.query(
        `SELECT
          id,
          project_id,
          name,
          status,
          shape_type,
          CASE
            WHEN center IS NULL
              THEN NULL
            ELSE ST_Y(center::geometry)
          END AS center_lat,
          CASE
            WHEN center IS NULL
              THEN NULL
            ELSE ST_X(center::geometry)
          END AS center_lng,
          radius_m,
          CASE
            WHEN polygon IS NULL
              THEN NULL
            ELSE ST_AsGeoJSON(polygon)
          END AS polygon_geojson,
          dwell_seconds,
          metadata,
          created_at,
          updated_at,
          deleted_at
        FROM geofences
        WHERE project_id = $1
          AND deleted_at IS NULL
        ORDER BY created_at DESC`,
        [projectId]
      );
    return result.rows.map(
      mapGeofence
    );
  }

  async getGeofence(
    projectId,
    geofenceId
  ) {
    const result =
      await this.pool.query(
        `SELECT
          id,
          project_id,
          name,
          status,
          shape_type,
          CASE
            WHEN center IS NULL
              THEN NULL
            ELSE ST_Y(center::geometry)
          END AS center_lat,
          CASE
            WHEN center IS NULL
              THEN NULL
            ELSE ST_X(center::geometry)
          END AS center_lng,
          radius_m,
          CASE
            WHEN polygon IS NULL
              THEN NULL
            ELSE ST_AsGeoJSON(polygon)
          END AS polygon_geojson,
          dwell_seconds,
          metadata,
          created_at,
          updated_at,
          deleted_at
        FROM geofences
        WHERE project_id = $1
          AND id = $2
          AND deleted_at IS NULL
        LIMIT 1`,
        [projectId, geofenceId]
      );
    if (!result.rows.length) {
      const error = new Error(
        "geofence_not_found"
      );
      error.code =
        "geofence_not_found";
      error.status = 404;
      throw error;
    }
    return mapGeofence(
      result.rows[0]
    );
  }

  async createGeofence({
    project,
    actorUserId,
    input
  }) {
    const shapeType =
      input.shapeType;
    const client =
      await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result =
        await client.query(
          `INSERT INTO geofences (
            project_id,
            name,
            status,
            shape_type,
            center,
            radius_m,
            polygon,
            dwell_seconds,
            metadata,
            created_by_admin_user_id,
            updated_by_admin_user_id
          ) VALUES (
            $1,$2,$3,$4,
            CASE
              WHEN $4 = 'circle'
              THEN ST_SetSRID(
                ST_MakePoint(
                  $6::double precision,
                  $5::double precision
                ),
                4326
              )::geography
              ELSE NULL
            END,
            CASE
              WHEN $4 = 'circle'
              THEN $7::double precision
              ELSE NULL
            END,
            CASE
              WHEN $4 = 'polygon'
              THEN ST_GeomFromGeoJSON(
                $8::text
              )::geometry(Polygon,4326)
              ELSE NULL
            END,
            $9::integer,$10::jsonb,$11,$11
          )
          RETURNING id`,
          [
            project.id,
            input.name,
            input.status || "active",
            shapeType,
            input.latitude ?? null,
            input.longitude ?? null,
            input.radiusM ?? null,
            input.shapeType === "polygon"
              ? JSON.stringify({
                  type: "Polygon",
                  coordinates: [
                    input.points
                  ]
                })
              : null,
            input.dwellSeconds,
            JSON.stringify(
              input.metadata || {}
            ),
            actorUserId
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
          $1,$2,$3,
          'automation.geofence_create',
          $4::jsonb
        )`,
        [
          actorUserId,
          project.accountId,
          project.id,
          JSON.stringify({
            geofenceId:
              result.rows[0].id,
            name: input.name,
            shapeType
          })
        ]
      );
      await client.query("COMMIT");
      return this.getGeofence(
        project.id,
        result.rows[0].id
      );
    } catch (error) {
      try {
        await client.query(
          "ROLLBACK"
        );
      } catch {}
      if (
        [
          "XX000",
          "22023",
          "23514"
        ].includes(error?.code)
      ) {
        const code =
          shapeType === "polygon"
            ? "invalid_geofence_polygon"
            : "invalid_geofence_geometry";
        const wrapped =
          new Error(code);
        wrapped.code = code;
        wrapped.status = 400;
        throw wrapped;
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async updateGeofence({
    project,
    actorUserId,
    geofenceId,
    patch
  }) {
    const current =
      await this.getGeofence(
        project.id,
        geofenceId
      );
    const next = {
      ...current,
      ...patch
    };

    if (
      patch.shapeType &&
      patch.shapeType !==
        current.shapeType
    ) {
      if (
        patch.shapeType === "circle" &&
        (
          patch.latitude ===
            undefined ||
          patch.longitude ===
            undefined ||
          patch.radiusM ===
            undefined
        )
      ) {
        const error = new Error(
          "geofence_shape_fields_required"
        );
        error.code =
          "geofence_shape_fields_required";
        error.status = 400;
        throw error;
      }
      if (
        patch.shapeType === "polygon" &&
        !patch.points
      ) {
        const error = new Error(
          "geofence_shape_fields_required"
        );
        error.code =
          "geofence_shape_fields_required";
        error.status = 400;
        throw error;
      }
    }

    const shapeType =
      next.shapeType;
    const points =
      patch.points ??
      current.points;

    if (
      shapeType === "circle" &&
      patch.points !== undefined
    ) {
      const error = new Error(
        "invalid_geofence_shape_fields"
      );
      error.code =
        "invalid_geofence_shape_fields";
      error.status = 400;
      throw error;
    }
    if (
      shapeType === "polygon" &&
      (
        patch.latitude !== undefined ||
        patch.longitude !== undefined ||
        patch.radiusM !== undefined
      )
    ) {
      const error = new Error(
        "invalid_geofence_shape_fields"
      );
      error.code =
        "invalid_geofence_shape_fields";
      error.status = 400;
      throw error;
    }

    const client =
      await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE geofences
        SET
          name = $3,
          status = $4,
          shape_type = $5,
          center = CASE
            WHEN $5 = 'circle'
            THEN ST_SetSRID(
              ST_MakePoint(
                $7::double precision,
                $6::double precision
              ),
              4326
            )::geography
            ELSE NULL
          END,
          radius_m = CASE
            WHEN $5 = 'circle'
              THEN $8::double precision
            ELSE NULL
          END,
          polygon = CASE
            WHEN $5 = 'polygon'
            THEN ST_GeomFromGeoJSON(
              $9::text
            )::geometry(Polygon,4326)
            ELSE NULL
          END,
          dwell_seconds = $10::integer,
          metadata = $11::jsonb,
          updated_by_admin_user_id =
            $12,
          updated_at = now()
        WHERE project_id = $1
          AND id = $2
          AND deleted_at IS NULL`,
        [
          project.id,
          geofenceId,
          next.name,
          next.status,
          shapeType,
          next.latitude,
          next.longitude,
          next.radiusM,
          shapeType === "polygon"
            ? JSON.stringify({
                type: "Polygon",
                coordinates: [
                  points
                ]
              })
            : null,
          next.dwellSeconds,
          JSON.stringify(
            next.metadata || {}
          ),
          actorUserId
        ]
      );

      if (
        patch.shapeType !==
          undefined ||
        patch.latitude !==
          undefined ||
        patch.longitude !==
          undefined ||
        patch.radiusM !==
          undefined ||
        patch.points !==
          undefined ||
        patch.dwellSeconds !==
          undefined ||
        patch.status !==
          undefined
      ) {
        await client.query(
          `DELETE FROM
            geofence_user_state
          WHERE project_id = $1
            AND geofence_id = $2`,
          [
            project.id,
            geofenceId
          ]
        );
      }

      await client.query(
        `INSERT INTO audit_log (
          admin_user_id,
          account_id,
          project_id,
          action,
          details
        ) VALUES (
          $1,$2,$3,
          'automation.geofence_update',
          $4::jsonb
        )`,
        [
          actorUserId,
          project.accountId,
          project.id,
          JSON.stringify({
            geofenceId,
            patch
          })
        ]
      );
      await client.query("COMMIT");
      return this.getGeofence(
        project.id,
        geofenceId
      );
    } catch (error) {
      try {
        await client.query(
          "ROLLBACK"
        );
      } catch {}
      if (
        [
          "XX000",
          "22023",
          "23514"
        ].includes(error?.code)
      ) {
        const code =
          shapeType === "polygon"
            ? "invalid_geofence_polygon"
            : "invalid_geofence_geometry";
        const wrapped =
          new Error(code);
        wrapped.code = code;
        wrapped.status = 400;
        throw wrapped;
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteGeofence({
    project,
    actorUserId,
    geofenceId
  }) {
    await this.getGeofence(
      project.id,
      geofenceId
    );
    const client =
      await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE geofences
        SET status = 'deleted',
            deleted_at = now(),
            updated_at = now(),
            updated_by_admin_user_id = $3
        WHERE project_id = $1
          AND id = $2
          AND deleted_at IS NULL`,
        [
          project.id,
          geofenceId,
          actorUserId
        ]
      );
      await client.query(
        `UPDATE alert_rules
        SET enabled = false,
            deleted_at =
              COALESCE(
                deleted_at,
                now()
              ),
            updated_at = now(),
            updated_by_admin_user_id =
              $3
        WHERE project_id = $1
          AND geofence_id = $2
          AND deleted_at IS NULL`,
        [
          project.id,
          geofenceId,
          actorUserId
        ]
      );
      await client.query(
        `UPDATE webhook_deliveries d
        SET status = 'dead',
            last_error =
              'geofence_deleted',
            locked_at = NULL,
            locked_by = NULL,
            updated_at = now()
        WHERE d.project_id = $1
          AND d.status IN (
            'pending',
            'retry'
          )
          AND EXISTS (
            SELECT 1
            FROM alert_rules r
            WHERE r.id =
              d.alert_rule_id
              AND r.geofence_id = $2
          )`,
        [
          project.id,
          geofenceId
        ]
      );

      await client.query(
        `DELETE FROM
          geofence_user_state
        WHERE project_id = $1
          AND geofence_id = $2`,
        [
          project.id,
          geofenceId
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
          $1,$2,$3,
          'automation.geofence_delete',
          $4::jsonb
        )`,
        [
          actorUserId,
          project.accountId,
          project.id,
          JSON.stringify({
            geofenceId
          })
        ]
      );
      await client.query("COMMIT");
    } catch (error) {
      try {
        await client.query(
          "ROLLBACK"
        );
      } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async listWebhookEndpoints(
    projectId
  ) {
    const result =
      await this.pool.query(
        `SELECT *
        FROM webhook_endpoints
        WHERE project_id = $1
          AND deleted_at IS NULL
        ORDER BY created_at DESC`,
        [projectId]
      );
    return result.rows.map(
      mapEndpoint
    );
  }

  async createWebhookEndpoint({
    project,
    actorUserId,
    input
  }) {
    const activeKey =
      activeWebhookSigningKey(
        this.webhookSigningKeys
      );
    const client =
      await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result =
        await client.query(
          `INSERT INTO webhook_endpoints (
            project_id,
            name,
            url,
            status,
            signing_key_id,
            created_by_admin_user_id,
            updated_by_admin_user_id
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$6
          )
          RETURNING *`,
          [
            project.id,
            input.name,
            input.url,
            input.status ||
              "active",
            activeKey.kid,
            actorUserId
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
          $1,$2,$3,
          'automation.webhook_create',
          $4::jsonb
        )`,
        [
          actorUserId,
          project.accountId,
          project.id,
          JSON.stringify({
            endpointId:
              result.rows[0].id,
            name: input.name
          })
        ]
      );
      await client.query("COMMIT");
      const endpoint =
        mapEndpoint(
          result.rows[0]
        );
      return {
        endpoint,
        secret:
          deriveWebhookSecret({
            keys:
              this.webhookSigningKeys,
            keyId:
              endpoint.signingKeyId,
            projectId:
              endpoint.projectId,
            endpointId:
              endpoint.id,
            generation:
              endpoint.secretGeneration
          })
      };
    } catch (error) {
      try {
        await client.query(
          "ROLLBACK"
        );
      } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async updateWebhookEndpoint({
    project,
    actorUserId,
    endpointId,
    patch
  }) {
    const currentResult =
      await this.pool.query(
        `SELECT *
        FROM webhook_endpoints
        WHERE project_id = $1
          AND id = $2
          AND deleted_at IS NULL
        LIMIT 1`,
        [
          project.id,
          endpointId
        ]
      );
    if (!currentResult.rows.length) {
      const error = new Error(
        "webhook_endpoint_not_found"
      );
      error.code =
        "webhook_endpoint_not_found";
      error.status = 404;
      throw error;
    }
    const current =
      mapEndpoint(
        currentResult.rows[0]
      );
    const next = {
      ...current,
      ...patch
    };

    const client =
      await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result =
        await client.query(
          `UPDATE webhook_endpoints
          SET name = $3,
              url = $4,
              status = $5,
              updated_by_admin_user_id =
                $6,
              updated_at = now()
          WHERE project_id = $1
            AND id = $2
            AND deleted_at IS NULL
          RETURNING *`,
          [
            project.id,
            endpointId,
            next.name,
            next.url,
            next.status,
            actorUserId
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
          $1,$2,$3,
          'automation.webhook_update',
          $4::jsonb
        )`,
        [
          actorUserId,
          project.accountId,
          project.id,
          JSON.stringify({
            endpointId,
            patch
          })
        ]
      );
      await client.query("COMMIT");
      return mapEndpoint(
        result.rows[0]
      );
    } catch (error) {
      try {
        await client.query(
          "ROLLBACK"
        );
      } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async rotateWebhookSecret({
    project,
    actorUserId,
    endpointId
  }) {
    const activeKey =
      activeWebhookSigningKey(
        this.webhookSigningKeys
      );
    const client =
      await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result =
        await client.query(
          `UPDATE webhook_endpoints
          SET signing_key_id = $3,
              secret_generation =
                secret_generation + 1,
              updated_by_admin_user_id =
                $4,
              updated_at = now()
          WHERE project_id = $1
            AND id = $2
            AND deleted_at IS NULL
          RETURNING *`,
          [
            project.id,
            endpointId,
            activeKey.kid,
            actorUserId
          ]
        );
      if (!result.rows.length) {
        const error = new Error(
          "webhook_endpoint_not_found"
        );
        error.code =
          "webhook_endpoint_not_found";
        error.status = 404;
        throw error;
      }
      await client.query(
        `INSERT INTO audit_log (
          admin_user_id,
          account_id,
          project_id,
          action,
          details
        ) VALUES (
          $1,$2,$3,
          'automation.webhook_rotate',
          $4::jsonb
        )`,
        [
          actorUserId,
          project.accountId,
          project.id,
          JSON.stringify({
            endpointId,
            generation:
              result.rows[0]
                .secret_generation
          })
        ]
      );
      await client.query("COMMIT");
      const endpoint =
        mapEndpoint(
          result.rows[0]
        );
      return {
        endpoint,
        secret:
          deriveWebhookSecret({
            keys:
              this.webhookSigningKeys,
            keyId:
              endpoint.signingKeyId,
            projectId:
              endpoint.projectId,
            endpointId:
              endpoint.id,
            generation:
              endpoint.secretGeneration
          })
      };
    } catch (error) {
      try {
        await client.query(
          "ROLLBACK"
        );
      } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteWebhookEndpoint({
    project,
    actorUserId,
    endpointId
  }) {
    const client =
      await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result =
        await client.query(
          `UPDATE webhook_endpoints
          SET status = 'deleted',
              deleted_at = now(),
              updated_by_admin_user_id =
                $3,
              updated_at = now()
          WHERE project_id = $1
            AND id = $2
            AND deleted_at IS NULL
          RETURNING id`,
          [
            project.id,
            endpointId,
            actorUserId
          ]
        );
      if (!result.rows.length) {
        const error = new Error(
          "webhook_endpoint_not_found"
        );
        error.code =
          "webhook_endpoint_not_found";
        error.status = 404;
        throw error;
      }
      await client.query(
        `UPDATE alert_rules
        SET enabled = false,
            deleted_at =
              COALESCE(
                deleted_at,
                now()
              ),
            updated_by_admin_user_id =
              $3,
            updated_at = now()
        WHERE project_id = $1
          AND webhook_endpoint_id = $2
          AND deleted_at IS NULL`,
        [
          project.id,
          endpointId,
          actorUserId
        ]
      );
      await client.query(
        `UPDATE webhook_deliveries
        SET status = 'dead',
            last_error =
              'endpoint_deleted',
            locked_at = NULL,
            locked_by = NULL,
            updated_at = now()
        WHERE project_id = $1
          AND webhook_endpoint_id = $2
          AND status IN (
            'pending',
            'retry'
          )`,
        [
          project.id,
          endpointId
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
          $1,$2,$3,
          'automation.webhook_delete',
          $4::jsonb
        )`,
        [
          actorUserId,
          project.accountId,
          project.id,
          JSON.stringify({
            endpointId
          })
        ]
      );
      await client.query("COMMIT");
    } catch (error) {
      try {
        await client.query(
          "ROLLBACK"
        );
      } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async listAlertRules(projectId) {
    const result =
      await this.pool.query(
        `SELECT *
        FROM alert_rules
        WHERE project_id = $1
          AND deleted_at IS NULL
        ORDER BY created_at DESC`,
        [projectId]
      );
    return result.rows.map(mapRule);
  }

  async assertAutomationRefs(
    projectId,
    {
      geofenceId = null,
      webhookEndpointId
    }
  ) {
    if (geofenceId) {
      const geofence =
        await this.pool.query(
          `SELECT 1
          FROM geofences
          WHERE project_id = $1
            AND id = $2
            AND deleted_at IS NULL
          LIMIT 1`,
          [
            projectId,
            geofenceId
          ]
        );
      if (!geofence.rows.length) {
        const error = new Error(
          "geofence_not_found"
        );
        error.code =
          "geofence_not_found";
        error.status = 404;
        throw error;
      }
    }
    const endpoint =
      await this.pool.query(
        `SELECT 1
        FROM webhook_endpoints
        WHERE project_id = $1
          AND id = $2
          AND deleted_at IS NULL
        LIMIT 1`,
        [
          projectId,
          webhookEndpointId
        ]
      );
    if (!endpoint.rows.length) {
      const error = new Error(
        "webhook_endpoint_not_found"
      );
      error.code =
        "webhook_endpoint_not_found";
      error.status = 404;
      throw error;
    }
  }

  async createAlertRule({
    project,
    actorUserId,
    input
  }) {
    await this.assertAutomationRefs(
      project.id,
      input
    );
    const client =
      await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result =
        await client.query(
          `INSERT INTO alert_rules (
            project_id,
            geofence_id,
            webhook_endpoint_id,
            name,
            enabled,
            event_types,
            created_by_admin_user_id,
            updated_by_admin_user_id
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$7
          )
          RETURNING *`,
          [
            project.id,
            input.geofenceId,
            input.webhookEndpointId,
            input.name,
            input.enabled,
            input.eventTypes,
            actorUserId
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
          $1,$2,$3,
          'automation.alert_rule_create',
          $4::jsonb
        )`,
        [
          actorUserId,
          project.accountId,
          project.id,
          JSON.stringify({
            alertRuleId:
              result.rows[0].id,
            geofenceId:
              input.geofenceId,
            webhookEndpointId:
              input.webhookEndpointId
          })
        ]
      );
      await client.query("COMMIT");
      return mapRule(
        result.rows[0]
      );
    } catch (error) {
      try {
        await client.query(
          "ROLLBACK"
        );
      } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async updateAlertRule({
    project,
    actorUserId,
    alertRuleId,
    patch
  }) {
    const currentResult =
      await this.pool.query(
        `SELECT *
        FROM alert_rules
        WHERE project_id = $1
          AND id = $2
          AND deleted_at IS NULL
        LIMIT 1`,
        [
          project.id,
          alertRuleId
        ]
      );
    if (!currentResult.rows.length) {
      const error = new Error(
        "alert_rule_not_found"
      );
      error.code =
        "alert_rule_not_found";
      error.status = 404;
      throw error;
    }
    const current =
      mapRule(
        currentResult.rows[0]
      );
    const next = {
      ...current,
      ...patch
    };
    await this.assertAutomationRefs(
      project.id,
      next
    );

    const client =
      await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result =
        await client.query(
          `UPDATE alert_rules
          SET geofence_id = $3,
              webhook_endpoint_id = $4,
              name = $5,
              enabled = $6,
              event_types = $7,
              updated_by_admin_user_id =
                $8,
              updated_at = now()
          WHERE project_id = $1
            AND id = $2
            AND deleted_at IS NULL
          RETURNING *`,
          [
            project.id,
            alertRuleId,
            next.geofenceId,
            next.webhookEndpointId,
            next.name,
            next.enabled,
            next.eventTypes,
            actorUserId
          ]
        );

      if (
        current.enabled &&
        !next.enabled
      ) {
        await client.query(
          `UPDATE webhook_deliveries
          SET status = 'dead',
              last_error =
                'alert_rule_disabled',
              locked_at = NULL,
              locked_by = NULL,
              updated_at = now()
          WHERE project_id = $1
            AND alert_rule_id = $2
            AND status IN (
              'pending',
              'retry'
            )`,
          [
            project.id,
            alertRuleId
          ]
        );
      }

      await client.query(
        `INSERT INTO audit_log (
          admin_user_id,
          account_id,
          project_id,
          action,
          details
        ) VALUES (
          $1,$2,$3,
          'automation.alert_rule_update',
          $4::jsonb
        )`,
        [
          actorUserId,
          project.accountId,
          project.id,
          JSON.stringify({
            alertRuleId,
            patch
          })
        ]
      );
      await client.query("COMMIT");
      return mapRule(
        result.rows[0]
      );
    } catch (error) {
      try {
        await client.query(
          "ROLLBACK"
        );
      } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteAlertRule({
    project,
    actorUserId,
    alertRuleId
  }) {
    const client =
      await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result =
        await client.query(
          `UPDATE alert_rules
          SET enabled = false,
              deleted_at = now(),
              updated_by_admin_user_id =
                $3,
              updated_at = now()
          WHERE project_id = $1
            AND id = $2
            AND deleted_at IS NULL
          RETURNING id`,
          [
            project.id,
            alertRuleId,
            actorUserId
          ]
        );
      if (!result.rows.length) {
        const error = new Error(
          "alert_rule_not_found"
        );
        error.code =
          "alert_rule_not_found";
        error.status = 404;
        throw error;
      }
      await client.query(
        `UPDATE webhook_deliveries
        SET status = 'dead',
            last_error =
              'alert_rule_deleted',
            locked_at = NULL,
            locked_by = NULL,
            updated_at = now()
        WHERE project_id = $1
          AND alert_rule_id = $2
          AND status IN (
            'pending',
            'retry'
          )`,
        [
          project.id,
          alertRuleId
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
          $1,$2,$3,
          'automation.alert_rule_delete',
          $4::jsonb
        )`,
        [
          actorUserId,
          project.accountId,
          project.id,
          JSON.stringify({
            alertRuleId
          })
        ]
      );
      await client.query("COMMIT");
    } catch (error) {
      try {
        await client.query(
          "ROLLBACK"
        );
      } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async listEvents(
    projectId,
    {
      limit = 100,
      cursor = "",
      eventType = "",
      geofenceId = "",
      userId = ""
    } = {}
  ) {
    const pageSize =
      Math.min(
        Math.max(
          Number(limit) || 100,
          1
        ),
        500
      );
    const decoded =
      decodeCursor(
        cursor,
        ["occurredAt", "id"]
      );
    const params = [projectId];
    const where = [
      "e.project_id = $1"
    ];

    if (eventType) {
      params.push(eventType);
      where.push(
        `e.event_type = $${params.length}`
      );
    }
    if (geofenceId) {
      params.push(geofenceId);
      where.push(
        `e.geofence_id = $${params.length}`
      );
    }
    if (userId) {
      params.push(userId);
      where.push(
        `e.external_user_id = $${params.length}`
      );
    }

    if (decoded) {
      const date = new Date(
        decoded.occurredAt
      );
      const id = String(
        decoded.id || ""
      );
      if (
        Number.isNaN(
          date.getTime()
        ) ||
        !/^\d+$/.test(id)
      ) {
        const error = new Error(
          "invalid_cursor"
        );
        error.code =
          "invalid_cursor";
        error.status = 400;
        throw error;
      }
      params.push(
        date.toISOString()
      );
      const dateIndex =
        params.length;
      params.push(id);
      const idIndex =
        params.length;
      where.push(
        `(
          e.occurred_at <
            $${dateIndex}::timestamptz
          OR (
            e.occurred_at =
              $${dateIndex}::timestamptz
            AND e.id <
              $${idIndex}::bigint
          )
        )`
      );
    }

    params.push(pageSize + 1);
    const limitIndex =
      params.length;
    const result =
      await this.pool.query(
        `SELECT
          e.*,
          g.name AS geofence_name
        FROM geofence_events e
        JOIN geofences g
          ON g.id = e.geofence_id
        WHERE ${where.join(
          "\n          AND "
        )}
        ORDER BY
          e.occurred_at DESC,
          e.id DESC
        LIMIT $${limitIndex}`,
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
    const last = rows.at(-1);
    return {
      events:
        rows.map(mapEvent),
      nextCursor:
        hasMore && last
          ? encodeCursor({
              occurredAt:
                iso(
                  last.occurred_at
                ),
              id: String(last.id)
            })
          : null
    };
  }

  async listDeliveries(
    projectId,
    {
      limit = 100,
      cursor = "",
      status = "",
      endpointId = "",
      eventType = ""
    } = {}
  ) {
    const pageSize =
      Math.min(
        Math.max(
          Number(limit) || 100,
          1
        ),
        500
      );
    const decoded =
      decodeCursor(
        cursor,
        ["createdAt", "id"]
      );
    const params = [projectId];
    const where = [
      "d.project_id = $1"
    ];

    if (status) {
      params.push(status);
      where.push(
        `d.status = $${params.length}`
      );
    }
    if (endpointId) {
      params.push(endpointId);
      where.push(
        `d.webhook_endpoint_id = $${params.length}`
      );
    }
    if (eventType) {
      params.push(eventType);
      where.push(
        `ge.event_type = $${params.length}`
      );
    }

    if (decoded) {
      const date = new Date(
        decoded.createdAt
      );
      const id = String(
        decoded.id || ""
      );
      if (
        Number.isNaN(
          date.getTime()
        ) ||
        !/^\d+$/.test(id)
      ) {
        const error = new Error(
          "invalid_cursor"
        );
        error.code =
          "invalid_cursor";
        error.status = 400;
        throw error;
      }
      params.push(
        date.toISOString()
      );
      const dateIndex =
        params.length;
      params.push(id);
      const idIndex =
        params.length;
      where.push(
        `(
          d.created_at <
            $${dateIndex}::timestamptz
          OR (
            d.created_at =
              $${dateIndex}::timestamptz
            AND d.id <
              $${idIndex}::bigint
          )
        )`
      );
    }

    params.push(pageSize + 1);
    const limitIndex =
      params.length;
    const result =
      await this.pool.query(
        `SELECT
          d.*,
          endpoint.name AS endpoint_name,
          endpoint.url AS endpoint_url,
          rule.name AS alert_rule_name,
          ge.event_id,
          ge.event_type,
          ge.occurred_at,
          ge.external_user_id,
          ge.geofence_id,
          g.name AS geofence_name
        FROM webhook_deliveries d
        JOIN webhook_endpoints endpoint
          ON endpoint.id =
            d.webhook_endpoint_id
        JOIN alert_rules rule
          ON rule.id =
            d.alert_rule_id
        JOIN geofence_events ge
          ON ge.id =
            d.geofence_event_id
        JOIN geofences g
          ON g.id =
            ge.geofence_id
        WHERE ${where.join(
          "\n          AND "
        )}
        ORDER BY
          d.created_at DESC,
          d.id DESC
        LIMIT $${limitIndex}`,
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
    const last = rows.at(-1);
    return {
      deliveries:
        rows.map(mapDelivery),
      nextCursor:
        hasMore && last
          ? encodeCursor({
              createdAt:
                iso(
                  last.created_at
                ),
              id: String(last.id)
            })
          : null
    };
  }

  async getDeliveryDetails(
    projectId,
    deliveryId
  ) {
    const result =
      await this.pool.query(
        `SELECT
          d.*,
          endpoint.name AS endpoint_name,
          endpoint.url AS endpoint_url,
          rule.name AS alert_rule_name,
          ge.event_id,
          ge.event_type,
          ge.occurred_at,
          ge.external_user_id,
          ge.geofence_id,
          ge.payload AS event_payload,
          g.name AS geofence_name
        FROM webhook_deliveries d
        JOIN webhook_endpoints endpoint
          ON endpoint.id =
            d.webhook_endpoint_id
        JOIN alert_rules rule
          ON rule.id =
            d.alert_rule_id
        JOIN geofence_events ge
          ON ge.id =
            d.geofence_event_id
        JOIN geofences g
          ON g.id =
            ge.geofence_id
        WHERE d.project_id = $1
          AND d.delivery_id = $2
        LIMIT 1`,
        [
          projectId,
          deliveryId
        ]
      );

    if (!result.rows.length) {
      const error = new Error(
        "webhook_delivery_not_found"
      );
      error.code =
        "webhook_delivery_not_found";
      error.status = 404;
      throw error;
    }

    const row =
      result.rows[0];
    const attempts =
      await this.pool.query(
        `SELECT
          a.id,
          a.attempt_number,
          a.started_at,
          a.completed_at,
          a.response_status,
          a.latency_ms,
          a.error_text
        FROM webhook_delivery_attempts a
        WHERE a.webhook_delivery_id =
          $1
        ORDER BY
          a.attempt_number DESC,
          a.id DESC`,
        [row.id]
      );

    return {
      delivery:
        mapDelivery(row),
      eventPayload:
        row.event_payload || {},
      attempts:
        attempts.rows.map(
          mapDeliveryAttempt
        )
    };
  }

  async emitDueDwellEvents({
    limit = 100
  } = {}) {
    const client =
      await this.pool.connect();
    const events = [];
    try {
      await client.query("BEGIN");
      const due =
        await client.query(
          `SELECT
            s.project_id,
            s.geofence_id,
            s.external_user_id,
            g.name AS geofence_name,
            l.latitude,
            l.longitude,
            l.accuracy_m
          FROM geofence_user_state s
          JOIN geofences g
            ON g.id = s.geofence_id
           AND g.project_id =
             s.project_id
          LEFT JOIN live_user_state l
            ON l.project_id =
              s.project_id
           AND l.external_user_id =
             s.external_user_id
          WHERE s.is_inside = true
            AND s.dwell_due_at IS NOT NULL
            AND s.dwell_fired_at IS NULL
            AND s.dwell_due_at <= now()
            AND g.status = 'active'
            AND g.deleted_at IS NULL
            AND EXISTS (
              SELECT 1
              FROM projects p
              JOIN account_subscriptions sub
                ON sub.account_id =
                  p.account_id
              JOIN commercial_plans plan
                ON plan.id = sub.plan_id
              LEFT JOIN
                account_entitlement_overrides o
                ON o.account_id =
                  p.account_id
               AND o.entitlement_key =
                  'geofences'
              WHERE p.id =
                s.project_id
                AND sub.status IN (
                  'active',
                  'trialing'
                )
                AND COALESCE(
                  CASE
                    WHEN o.value IS NULL
                      THEN NULL
                    ELSE
                      (o.value #>> '{}')::boolean
                  END,
                  COALESCE(
                    (
                      plan.features ->>
                        'geofences'
                    )::boolean,
                    false
                  )
                ) = true
            )
          ORDER BY s.dwell_due_at ASC
          FOR UPDATE OF s
          SKIP LOCKED
          LIMIT $1`,
          [
            Math.min(
              Math.max(
                Number(limit) || 100,
                1
              ),
              1000
            )
          ]
        );

      for (const row of due.rows) {
        const occurredAt =
          new Date().toISOString();
        const event =
          await createEvent(
            client,
            {
              projectId:
                row.project_id,
              geofence: {
                id:
                  row.geofence_id,
                name:
                  row.geofence_name
              },
              userId:
                row.external_user_id,
              eventType: "dwell",
              occurredAt,
              location:
                row.latitude == null
                  ? null
                  : {
                      latitude:
                        Number(
                          row.latitude
                        ),
                      longitude:
                        Number(
                          row.longitude
                        ),
                      accuracyM:
                        row.accuracy_m
                    }
            }
          );
        await client.query(
          `UPDATE geofence_user_state
          SET dwell_fired_at = $4,
              updated_at = now()
          WHERE project_id = $1
            AND geofence_id = $2
            AND external_user_id = $3`,
          [
            row.project_id,
            row.geofence_id,
            row.external_user_id,
            occurredAt
          ]
        );
        events.push(event);
      }

      await client.query("COMMIT");
      return events;
    } catch (error) {
      try {
        await client.query(
          "ROLLBACK"
        );
      } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async retryWebhookDelivery({
    project,
    actorUserId,
    deliveryId
  }) {
    const client =
      await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result =
        await client.query(
          `UPDATE webhook_deliveries
          SET status = 'retry',
              attempt_count = 0,
              next_attempt_at = now(),
              locked_at = NULL,
              locked_by = NULL,
              response_status = NULL,
              response_body_excerpt = NULL,
              last_error = NULL,
              delivered_at = NULL,
              updated_at = now()
          WHERE project_id = $1
            AND delivery_id = $2
            AND status = 'dead'
          RETURNING id`,
          [
            project.id,
            deliveryId
          ]
        );
      if (!result.rows.length) {
        const error = new Error(
          "webhook_delivery_not_retryable"
        );
        error.code =
          "webhook_delivery_not_retryable";
        error.status = 409;
        throw error;
      }

      await client.query(
        `INSERT INTO audit_log (
          admin_user_id,
          account_id,
          project_id,
          action,
          details
        ) VALUES (
          $1,$2,$3,
          'automation.webhook_retry',
          $4::jsonb
        )`,
        [
          actorUserId,
          project.accountId,
          project.id,
          JSON.stringify({
            deliveryId
          })
        ]
      );
      await client.query("COMMIT");
    } catch (error) {
      try {
        await client.query(
          "ROLLBACK"
        );
      } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async claimWebhookDeliveries({
    workerId,
    limit = 25,
    leaseSeconds = 120
  }) {
    const boundedLimit =
      Math.min(
        Math.max(
          Number(limit) || 25,
          1
        ),
        100
      );
    const boundedLease =
      Math.min(
        Math.max(
          Number(leaseSeconds) || 120,
          30
        ),
        600
      );

    const result =
      await this.pool.query(
        `WITH due AS (
          SELECT d.id
          FROM webhook_deliveries d
          JOIN webhook_endpoints e
            ON e.id =
              d.webhook_endpoint_id
          JOIN alert_rules r
            ON r.id =
              d.alert_rule_id
          WHERE d.status IN (
              'pending',
              'retry'
            )
            AND d.next_attempt_at <=
              now()
            AND (
              d.locked_at IS NULL
              OR d.locked_at <
                now() -
                ($3::double precision *
                  interval '1 second')
            )
            AND e.status = 'active'
            AND e.deleted_at IS NULL
            AND r.enabled = true
            AND r.deleted_at IS NULL
            AND EXISTS (
              SELECT 1
              FROM projects p
              JOIN account_subscriptions sub
                ON sub.account_id =
                  p.account_id
              JOIN commercial_plans plan
                ON plan.id = sub.plan_id
              LEFT JOIN
                account_entitlement_overrides o
                ON o.account_id =
                  p.account_id
               AND o.entitlement_key =
                  'webhooks'
              WHERE p.id =
                d.project_id
                AND sub.status IN (
                  'active',
                  'trialing'
                )
                AND COALESCE(
                  CASE
                    WHEN o.value IS NULL
                      THEN NULL
                    ELSE
                      (o.value #>> '{}')::boolean
                  END,
                  COALESCE(
                    (
                      plan.features ->>
                        'webhooks'
                    )::boolean,
                    false
                  )
                ) = true
            )
          ORDER BY
            d.next_attempt_at ASC,
            d.id ASC
          FOR UPDATE OF d
          SKIP LOCKED
          LIMIT $2
        )
        UPDATE webhook_deliveries d
        SET locked_at = now(),
            locked_by = $1,
            updated_at = now()
        FROM due
        WHERE d.id = due.id
        RETURNING d.id`,
        [
          String(workerId),
          boundedLimit,
          boundedLease
        ]
      );

    const ids =
      result.rows.map(
        (row) => String(row.id)
      );
    if (!ids.length) return [];

    const details =
      await this.pool.query(
        `SELECT
          d.*,
          e.name AS endpoint_name,
          e.url AS endpoint_url,
          e.signing_key_id,
          e.secret_generation,
          ge.event_id,
          ge.event_type,
          ge.occurred_at,
          ge.payload AS event_payload
        FROM webhook_deliveries d
        JOIN webhook_endpoints e
          ON e.id =
            d.webhook_endpoint_id
        JOIN geofence_events ge
          ON ge.id =
            d.geofence_event_id
        WHERE d.id =
          ANY($1::bigint[])
        ORDER BY d.id ASC`,
        [ids]
      );

    return details.rows.map(
      (row) => ({
        ...mapDelivery(row),
        signingKeyId:
          row.signing_key_id,
        secretGeneration:
          Number(
            row.secret_generation
          ),
        eventId:
          row.event_id,
        eventType:
          row.event_type,
        occurredAt:
          iso(row.occurred_at),
        eventPayload:
          row.event_payload || {}
      })
    );
  }

  webhookSecretForDelivery(
    delivery
  ) {
    return deriveWebhookSecret({
      keys:
        this.webhookSigningKeys,
      keyId:
        delivery.signingKeyId,
      projectId:
        delivery.projectId,
      endpointId:
        delivery.webhookEndpointId,
      generation:
        delivery.secretGeneration
    });
  }

  async finishWebhookAttempt({
    delivery,
    startedAt,
    responseStatus = null,
    responseBodyExcerpt = null,
    errorText = null,
    latencyMs = 0,
    delivered = false,
    maxAttempts = 8
  }) {
    const attempt =
      Number(
        delivery.attemptCount || 0
      ) + 1;
    const exhausted =
      !delivered &&
      attempt >= maxAttempts;
    const delaySeconds =
      Math.min(
        3600,
        30 *
          2 **
            Math.max(
              0,
              attempt - 1
            )
      );

    const client =
      await this.pool.connect();
    try {
      await client.query("BEGIN");
      const historyAttemptResult =
        await client.query(
          `SELECT
            COALESCE(
              max(attempt_number),
              0
            ) + 1 AS attempt_number
          FROM webhook_delivery_attempts
          WHERE webhook_delivery_id =
            $1`,
          [delivery.id]
        );
      const historyAttempt =
        Number(
          historyAttemptResult
            .rows[0]
            ?.attempt_number || 1
        );

      await client.query(
        `INSERT INTO webhook_delivery_attempts (
          webhook_delivery_id,
          attempt_number,
          started_at,
          completed_at,
          response_status,
          latency_ms,
          error_text
        ) VALUES (
          $1,$2,$3,now(),$4,$5,$6
        )
        ON CONFLICT (
          webhook_delivery_id,
          attempt_number
        ) DO NOTHING`,
        [
          delivery.id,
          historyAttempt,
          startedAt,
          responseStatus,
          Math.max(
            0,
            Math.round(
              Number(latencyMs) || 0
            )
          ),
          errorText
        ]
      );

      await client.query(
        `UPDATE webhook_deliveries
        SET status = $2,
            attempt_count = $3,
            next_attempt_at = CASE
              WHEN $2 = 'retry'
              THEN now() +
                ($4::double precision *
                  interval '1 second')
              ELSE next_attempt_at
            END,
            response_status = $5,
            response_body_excerpt = $6,
            last_error = $7,
            delivered_at = CASE
              WHEN $2 = 'delivered'
              THEN now()
              ELSE delivered_at
            END,
            locked_at = NULL,
            locked_by = NULL,
            updated_at = now()
        WHERE id = $1`,
        [
          delivery.id,
          delivered
            ? "delivered"
            : exhausted
              ? "dead"
              : "retry",
          attempt,
          delaySeconds,
          responseStatus,
          responseBodyExcerpt,
          errorText
        ]
      );
      await client.query("COMMIT");
    } catch (error) {
      try {
        await client.query(
          "ROLLBACK"
        );
      } catch {}
      throw error;
    } finally {
      client.release();
    }
  }
}
