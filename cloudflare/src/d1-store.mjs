import {
  decodeCursor,
  encodeCursor,
  geofenceContains,
  normalizeGridDegrees,
  presenceStatus,
  thresholdCutoffs
} from "./geo.mjs";

function j(value, fallback = null) {
  if (value == null) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function mapLive(row, thresholds, now = Date.now()) {
  return {
    userId: row.external_user_id,
    name: row.display_name || null,
    email: row.email || null,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    accuracyM: row.accuracy_m == null ? null : Number(row.accuracy_m),
    altitudeM: row.altitude_m == null ? null : Number(row.altitude_m),
    headingDeg: row.heading_deg == null ? null : Number(row.heading_deg),
    speedMps: row.speed_mps == null ? null : Number(row.speed_mps),
    capturedAt: row.captured_at || null,
    receivedAt: row.received_at,
    lastSeenAt: row.received_at,
    country: row.country || null,
    state: row.state || null,
    city: row.city || null,
    device: j(row.device_json, null),
    metadata: j(row.metadata_json, null),
    status: presenceStatus(row.received_at, now, thresholds)
  };
}

export async function recordUsage(env, projectId, field, amount = 1) {
  const allowed = new Set([
    "location_writes",
    "api_reads",
    "realtime_events",
    "webhook_attempts"
  ]);
  if (!allowed.has(field)) return;
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  await env.DB.prepare(
    `INSERT INTO usage_daily(
      project_id, usage_date, ${field}, updated_at
    ) VALUES(?,?,?,?)
    ON CONFLICT(project_id,usage_date)
    DO UPDATE SET
      ${field}=${field}+excluded.${field},
      updated_at=excluded.updated_at`
  ).bind(projectId, day, amount, now.toISOString()).run();
}

export async function upsertLocation(env, projectId, input) {
  const now = new Date().toISOString();
  const project = await env.DB.prepare(
    `SELECT p.status,
      COALESCE(l.max_live_users,100000) AS max_live_users
     FROM projects p
     LEFT JOIN project_limits l ON l.project_id=p.id
     WHERE p.id=?`
  ).bind(projectId).first();
  if (!project) {
    throw Object.assign(new Error("project_not_found"), { code: "project_not_found", status: 404 });
  }
  if (project.status !== "active") {
    throw Object.assign(new Error("project_not_active"), { code: "project_not_active", status: 403 });
  }

  const existing = await env.DB.prepare(
    "SELECT 1 AS ok FROM users WHERE project_id=? AND external_user_id=?"
  ).bind(projectId, input.userId).first();
  if (!existing) {
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM users WHERE project_id=?"
    ).bind(projectId).first();
    if (Number(count?.count || 0) >= Number(project.max_live_users || 100000)) {
      throw Object.assign(new Error("project_live_user_quota_exceeded"), {
        code: "project_live_user_quota_exceeded",
        status: 429
      });
    }
  }

  const deviceJson = input.device ? JSON.stringify(input.device) : null;
  const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;
  const eventId = crypto.randomUUID();
  const eventPayload = {
    userId: input.userId,
    name: input.name,
    email: input.email,
    latitude: input.latitude,
    longitude: input.longitude,
    accuracyM: input.accuracyM,
    altitudeM: input.altitudeM,
    headingDeg: input.headingDeg,
    speedMps: input.speedMps,
    capturedAt: input.capturedAt,
    receivedAt: now,
    country: input.country,
    state: input.state,
    city: input.city,
    device: input.device,
    metadata: input.metadata
  };

  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users(
        project_id,external_user_id,display_name,email,first_seen_at,updated_at
      ) VALUES(?,?,?,?,?,?)
      ON CONFLICT(project_id,external_user_id)
      DO UPDATE SET
        display_name=COALESCE(excluded.display_name,users.display_name),
        email=COALESCE(excluded.email,users.email),
        updated_at=excluded.updated_at`
    ).bind(projectId,input.userId,input.name,input.email,now,now),
    env.DB.prepare(
      `INSERT INTO live_user_state(
        project_id,external_user_id,latitude,longitude,accuracy_m,altitude_m,
        heading_deg,speed_mps,captured_at,received_at,country,state,city,
        device_json,metadata_json
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(project_id,external_user_id)
      DO UPDATE SET
        latitude=excluded.latitude,
        longitude=excluded.longitude,
        accuracy_m=excluded.accuracy_m,
        altitude_m=excluded.altitude_m,
        heading_deg=excluded.heading_deg,
        speed_mps=excluded.speed_mps,
        captured_at=excluded.captured_at,
        received_at=excluded.received_at,
        country=COALESCE(excluded.country,live_user_state.country),
        state=COALESCE(excluded.state,live_user_state.state),
        city=COALESCE(excluded.city,live_user_state.city),
        device_json=COALESCE(excluded.device_json,live_user_state.device_json),
        metadata_json=COALESCE(excluded.metadata_json,live_user_state.metadata_json)
      WHERE live_user_state.received_at<=excluded.received_at`
    ).bind(
      projectId,input.userId,input.latitude,input.longitude,input.accuracyM,
      input.altitudeM,input.headingDeg,input.speedMps,input.capturedAt,now,
      input.country,input.state,input.city,deviceJson,metadataJson
    ),
    env.DB.prepare(
      `INSERT INTO location_history(
        project_id,external_user_id,latitude,longitude,accuracy_m,altitude_m,
        heading_deg,speed_mps,captured_at,received_at,country,state,city,
        device_json,metadata_json
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      projectId,input.userId,input.latitude,input.longitude,input.accuracyM,
      input.altitudeM,input.headingDeg,input.speedMps,input.capturedAt,now,
      input.country,input.state,input.city,deviceJson,metadataJson
    ),
    env.DB.prepare(
      `INSERT INTO realtime_events(
        event_id,project_id,event_type,external_user_id,payload_json,created_at
      ) VALUES(?,?,?,?,?,?)`
    ).bind(eventId,projectId,"location",input.userId,JSON.stringify(eventPayload),now)
  ]);

  const historyId = Number(results[2]?.meta?.last_row_id || 0) || null;
  const sequence = Number(results[3]?.meta?.last_row_id || 0) || null;
  await recordUsage(env, projectId, "location_writes", 1);
  await recordUsage(env, projectId, "realtime_events", 1);

  const automationEvents = await evaluateGeofences(
    env,
    projectId,
    input.userId,
    historyId,
    eventPayload
  );

  return {
    ...eventPayload,
    historyId,
    sequence,
    automationEvents
  };
}

export async function listUsersPage(env, projectId, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit || 100), 1), 500);
  const cursor = decodeCursor(options.cursor || "");
  const values = [projectId];
  const where = ["l.project_id=?"];
  if (options.search) {
    values.push(`%${String(options.search).trim().toLowerCase()}%`);
    where.push(
      "(lower(l.external_user_id) LIKE ? OR lower(COALESCE(u.display_name,'')) LIKE ? OR lower(COALESCE(u.email,'')) LIKE ?)"
    );
    values.push(values[values.length - 1], values[values.length - 1]);
  }
  if (options.country) { values.push(String(options.country)); where.push("l.country=?"); }
  if (options.state) { values.push(String(options.state)); where.push("l.state=?"); }
  if (options.city) { values.push(String(options.city)); where.push("l.city=?"); }
  if (cursor?.receivedAt && cursor?.userId) {
    values.push(cursor.receivedAt, cursor.receivedAt, cursor.userId);
    where.push("(l.received_at < ? OR (l.received_at = ? AND l.external_user_id > ?))");
  }

  const result = await env.DB.prepare(
    `SELECT l.*,u.display_name,u.email
     FROM live_user_state l
     JOIN users u ON u.project_id=l.project_id AND u.external_user_id=l.external_user_id
     WHERE ${where.join(" AND ")}
     ORDER BY l.received_at DESC,l.external_user_id ASC
     LIMIT ?`
  ).bind(...values, limit + 1).all();

  const now = Date.now();
  let users = (result.results || []).map((row) => mapLive(row, options.thresholds, now));
  if (options.status) users = users.filter((row) => row.status === options.status);
  const hasMore = users.length > limit;
  users = users.slice(0, limit);
  const last = users[users.length - 1];
  return {
    users,
    nextCursor: hasMore && last
      ? encodeCursor({ receivedAt: last.receivedAt, userId: last.userId })
      : null
  };
}

export async function summary(env, projectId, thresholds = {}) {
  const c = thresholdCutoffs(new Date(), thresholds);
  const row = await env.DB.prepare(
    `SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN received_at>=? THEN 1 ELSE 0 END) AS online,
      SUM(CASE WHEN received_at<? AND received_at>=? THEN 1 ELSE 0 END) AS recent,
      SUM(CASE WHEN received_at<? AND received_at>=? THEN 1 ELSE 0 END) AS offline,
      SUM(CASE WHEN received_at<? THEN 1 ELSE 0 END) AS inactive,
      SUM(CASE WHEN received_at>=? THEN 1 ELSE 0 END) AS today_active
     FROM live_user_state
     WHERE project_id=?`
  ).bind(c.online,c.online,c.recent,c.recent,c.inactive,c.inactive,c.today,projectId).first();
  return {
    total: Number(row?.total || 0),
    online: Number(row?.online || 0),
    recent: Number(row?.recent || 0),
    offline: Number(row?.offline || 0),
    inactive: Number(row?.inactive || 0),
    todayActive: Number(row?.today_active || 0)
  };
}

export async function facets(env, projectId) {
  const [countries, states, cities] = await env.DB.batch([
    env.DB.prepare(
      "SELECT country AS value,COUNT(*) AS count FROM live_user_state WHERE project_id=? AND country IS NOT NULL GROUP BY country ORDER BY count DESC,value ASC LIMIT 250"
    ).bind(projectId),
    env.DB.prepare(
      "SELECT state AS value,COUNT(*) AS count FROM live_user_state WHERE project_id=? AND state IS NOT NULL GROUP BY state ORDER BY count DESC,value ASC LIMIT 500"
    ).bind(projectId),
    env.DB.prepare(
      "SELECT city AS value,COUNT(*) AS count FROM live_user_state WHERE project_id=? AND city IS NOT NULL GROUP BY city ORDER BY count DESC,value ASC LIMIT 1000"
    ).bind(projectId)
  ]);
  const map = (r) => (r.results || []).map((x) => ({ value: x.value, count: Number(x.count || 0) }));
  return { countries: map(countries), states: map(states), cities: map(cities) };
}

export async function clusterUsers(env, projectId, options = {}) {
  const grid = normalizeGridDegrees(options.gridDegrees, 8);
  const c = thresholdCutoffs(new Date(), options.thresholds);
  const values = [c.online,c.recent,c.inactive,grid,grid,projectId];
  const where = ["project_id=?"];
  if (options.country) { values.push(String(options.country)); where.push("country=?"); }
  if (options.state) { values.push(String(options.state)); where.push("state=?"); }
  if (options.city) { values.push(String(options.city)); where.push("city=?"); }

  let statusClause = "";
  if (options.status) {
    const s = String(options.status);
    if (!["online","recent","offline","inactive"].includes(s)) {
      throw Object.assign(new Error("invalid_status"), { code: "invalid_status", status: 400 });
    }
    values.push(s);
    statusClause = " AND presence=?";
  }

  const result = await env.DB.prepare(
    `WITH scoped AS (
      SELECT latitude,longitude,country,state,city,
        CASE
          WHEN received_at>=? THEN 'online'
          WHEN received_at>=? THEN 'recent'
          WHEN received_at>=? THEN 'offline'
          ELSE 'inactive'
        END AS presence,
        CAST((latitude+90.0)/? AS INTEGER) AS lat_cell,
        CAST((longitude+180.0)/? AS INTEGER) AS lng_cell
      FROM live_user_state
      WHERE ${where.join(" AND ")}
    )
    SELECT
      AVG(latitude) AS latitude,
      AVG(longitude) AS longitude,
      COUNT(*) AS count,
      SUM(CASE WHEN presence='online' THEN 1 ELSE 0 END) AS online,
      SUM(CASE WHEN presence='recent' THEN 1 ELSE 0 END) AS recent,
      SUM(CASE WHEN presence='offline' THEN 1 ELSE 0 END) AS offline,
      SUM(CASE WHEN presence='inactive' THEN 1 ELSE 0 END) AS inactive
    FROM scoped
    WHERE 1=1 ${statusClause}
    GROUP BY lat_cell,lng_cell
    ORDER BY count DESC
    LIMIT 5000`
  ).bind(...values).all();

  return (result.results || []).map((row) => ({
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    count: Number(row.count || 0),
    online: Number(row.online || 0),
    recent: Number(row.recent || 0),
    offline: Number(row.offline || 0),
    inactive: Number(row.inactive || 0)
  }));
}

export async function movementHistory(env, projectId, query) {
  const limit = Math.min(Math.max(Number(query.limit || 250), 1), 1000);
  const cursor = decodeCursor(query.cursor || "");
  const values = [projectId, query.userId, query.from, query.to];
  let cursorSql = "";
  if (cursor?.receivedAt && cursor?.id) {
    cursorSql = " AND (received_at<? OR (received_at=? AND id<?))";
    values.push(cursor.receivedAt, cursor.receivedAt, Number(cursor.id));
  }
  const result = await env.DB.prepare(
    `SELECT id,external_user_id,latitude,longitude,accuracy_m,altitude_m,
      heading_deg,speed_mps,captured_at,received_at,country,state,city,
      device_json,metadata_json
     FROM location_history
     WHERE project_id=? AND external_user_id=? AND received_at>=? AND received_at<=?
     ${cursorSql}
     ORDER BY received_at DESC,id DESC
     LIMIT ?`
  ).bind(...values, limit + 1).all();
  const rows = result.results || [];
  const hasMore = rows.length > limit;
  const points = rows.slice(0, limit).map((row) => ({
    id: String(row.id),
    userId: row.external_user_id,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    accuracyM: row.accuracy_m == null ? null : Number(row.accuracy_m),
    altitudeM: row.altitude_m == null ? null : Number(row.altitude_m),
    headingDeg: row.heading_deg == null ? null : Number(row.heading_deg),
    speedMps: row.speed_mps == null ? null : Number(row.speed_mps),
    capturedAt: row.captured_at,
    receivedAt: row.received_at,
    country: row.country,
    state: row.state,
    city: row.city,
    device: j(row.device_json, null),
    metadata: j(row.metadata_json, null)
  }));
  const last = points[points.length - 1];
  return {
    points,
    nextCursor: hasMore && last
      ? encodeCursor({ receivedAt: last.receivedAt, id: last.id })
      : null
  };
}

export async function heatmapHistory(env, projectId, query) {
  const grid = normalizeGridDegrees(query.gridDegrees, 2);
  const values = [grid,grid,projectId,query.from,query.to];
  let userSql = "";
  if (query.userId) { userSql = " AND external_user_id=?"; values.push(query.userId); }
  const result = await env.DB.prepare(
    `SELECT
      AVG(latitude) AS latitude,
      AVG(longitude) AS longitude,
      COUNT(*) AS count
     FROM location_history
     WHERE project_id=? AND received_at>=? AND received_at<=? ${userSql}
     GROUP BY
       CAST((latitude+90.0)/? AS INTEGER),
       CAST((longitude+180.0)/? AS INTEGER)
     ORDER BY count DESC
     LIMIT 5000`
  ).bind(projectId,query.from,query.to,...(query.userId?[query.userId]:[]),grid,grid).all();
  return (result.results || []).map((row) => ({
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    count: Number(row.count || 0)
  }));
}

async function createGeofenceEvent(env, {
  projectId, geofence, userId, historyId, eventType, occurredAt, location
}) {
  const eventId = crypto.randomUUID();
  const payload = {
    eventId,
    projectId,
    geofenceId: geofence.id,
    geofenceName: geofence.name,
    userId,
    eventType,
    occurredAt,
    location
  };
  const realtimeId = crypto.randomUUID();
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO geofence_events(
        event_id,project_id,geofence_id,external_user_id,source_history_id,
        event_type,occurred_at,payload_json,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?)`
    ).bind(
      eventId,projectId,geofence.id,userId,historyId,eventType,
      occurredAt,JSON.stringify(payload),occurredAt
    ),
    env.DB.prepare(
      `INSERT INTO realtime_events(
        event_id,project_id,event_type,external_user_id,payload_json,created_at
      ) VALUES(?,?,?,?,?,?)`
    ).bind(realtimeId,projectId,`geofence.${eventType}`,userId,JSON.stringify(payload),occurredAt)
  ]);
  const geofenceEventId = Number(results[0]?.meta?.last_row_id || 0);
  const sequence = Number(results[1]?.meta?.last_row_id || 0);

  const rules = await env.DB.prepare(
    `SELECT r.id AS rule_id,r.webhook_endpoint_id
     FROM alert_rules r
     WHERE r.project_id=? AND r.enabled=1 AND r.deleted_at IS NULL
       AND (r.geofence_id IS NULL OR r.geofence_id=?)
       AND EXISTS (
         SELECT 1 FROM json_each(r.event_types_json)
         WHERE value=?
       )`
  ).bind(projectId,geofence.id,eventType).all();

  for (const rule of rules.results || []) {
    const deliveryId = crypto.randomUUID();
    const now = new Date().toISOString();
    const insert = await env.DB.prepare(
      `INSERT OR IGNORE INTO webhook_deliveries(
        delivery_id,project_id,webhook_endpoint_id,alert_rule_id,
        geofence_event_id,status,attempt_count,next_attempt_at,created_at,updated_at
      ) VALUES(?,?,?,?,?,'pending',0,?,?,?)`
    ).bind(
      deliveryId,projectId,rule.webhook_endpoint_id,rule.rule_id,
      geofenceEventId,now,now,now
    ).run();
    if (insert.meta?.changes && env.WEBHOOK_QUEUE) {
      await env.WEBHOOK_QUEUE.send({ deliveryId });
    }
  }

  return { ...payload, sequence: String(sequence) };
}

export async function evaluateGeofences(env, projectId, userId, historyId, location) {
  const fences = await env.DB.prepare(
    `SELECT * FROM geofences
     WHERE project_id=? AND status='active' AND deleted_at IS NULL
     ORDER BY id`
  ).bind(projectId).all();
  const events = [];
  for (const fence of fences.results || []) {
    const inside = geofenceContains(fence, location.latitude, location.longitude);
    const previous = await env.DB.prepare(
      `SELECT is_inside,entered_at,dwell_due_at,dwell_fired_at
       FROM geofence_user_state
       WHERE project_id=? AND geofence_id=? AND external_user_id=?`
    ).bind(projectId,fence.id,userId).first();

    const wasInside = Boolean(previous?.is_inside);
    const occurredAt = location.receivedAt || new Date().toISOString();
    let enteredAt = null;
    let dwellDueAt = null;
    let dwellFiredAt = null;
    let eventType = "";

    if (inside) {
      if (!wasInside) {
        enteredAt = occurredAt;
        dwellDueAt = Number(fence.dwell_seconds || 0) > 0
          ? new Date(new Date(occurredAt).getTime() + Number(fence.dwell_seconds) * 1000).toISOString()
          : null;
        eventType = "enter";
      } else {
        enteredAt = previous.entered_at || occurredAt;
        dwellDueAt = previous.dwell_due_at || null;
        dwellFiredAt = previous.dwell_fired_at || null;
        if (dwellDueAt && !dwellFiredAt && new Date(occurredAt) >= new Date(dwellDueAt)) {
          eventType = "dwell";
          dwellFiredAt = occurredAt;
        }
      }
    } else if (wasInside) {
      eventType = "exit";
    }

    await env.DB.prepare(
      `INSERT INTO geofence_user_state(
        project_id,geofence_id,external_user_id,is_inside,entered_at,
        dwell_due_at,dwell_fired_at,last_seen_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(project_id,geofence_id,external_user_id)
      DO UPDATE SET
        is_inside=excluded.is_inside,
        entered_at=excluded.entered_at,
        dwell_due_at=excluded.dwell_due_at,
        dwell_fired_at=excluded.dwell_fired_at,
        last_seen_at=excluded.last_seen_at,
        updated_at=excluded.updated_at`
    ).bind(
      projectId,fence.id,userId,inside?1:0,
      inside?enteredAt:null,inside?dwellDueAt:null,inside?dwellFiredAt:null,
      occurredAt,occurredAt
    ).run();

    if (eventType) {
      events.push(await createGeofenceEvent(env, {
        projectId,
        geofence: fence,
        userId,
        historyId,
        eventType,
        occurredAt,
        location
      }));
    }
  }
  return events;
}

export async function emitDueDwellEvents(env, limit = 100) {
  const now = new Date().toISOString();
  const due = await env.DB.prepare(
    `SELECT s.*,g.name,l.latitude,l.longitude,l.accuracy_m
     FROM geofence_user_state s
     JOIN geofences g ON g.id=s.geofence_id AND g.project_id=s.project_id
     LEFT JOIN live_user_state l
       ON l.project_id=s.project_id AND l.external_user_id=s.external_user_id
     WHERE s.is_inside=1
       AND s.dwell_due_at IS NOT NULL
       AND s.dwell_fired_at IS NULL
       AND s.dwell_due_at<=?
       AND g.status='active' AND g.deleted_at IS NULL
     ORDER BY s.dwell_due_at ASC
     LIMIT ?`
  ).bind(now, Math.min(Math.max(Number(limit)||100,1),500)).all();

  const events = [];
  for (const row of due.results || []) {
    const event = await createGeofenceEvent(env, {
      projectId: row.project_id,
      geofence: { id: row.geofence_id, name: row.name },
      userId: row.external_user_id,
      historyId: null,
      eventType: "dwell",
      occurredAt: now,
      location: row.latitude == null ? null : {
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        accuracyM: row.accuracy_m == null ? null : Number(row.accuracy_m),
        receivedAt: now
      }
    });
    await env.DB.prepare(
      `UPDATE geofence_user_state
       SET dwell_fired_at=?,updated_at=?
       WHERE project_id=? AND geofence_id=? AND external_user_id=?
         AND dwell_fired_at IS NULL`
    ).bind(now,now,row.project_id,row.geofence_id,row.external_user_id).run();
    events.push(event);
  }
  return events;
}

export async function cleanupRetention(env) {
  const projects = await env.DB.prepare(
    `SELECT p.id,
      COALESCE(l.history_retention_days,30) AS history_days,
      COALESCE(l.realtime_retention_hours,24) AS realtime_hours,
      COALESCE(l.geofence_event_retention_days,90) AS geofence_days,
      COALESCE(l.webhook_delivery_retention_days,30) AS webhook_days
     FROM projects p
     LEFT JOIN project_limits l ON l.project_id=p.id
     WHERE p.status<>'deleted'`
  ).all();
  const now = Date.now();
  for (const p of projects.results || []) {
    const historyBefore = new Date(now - Number(p.history_days)*86400000).toISOString();
    const realtimeBefore = new Date(now - Number(p.realtime_hours)*3600000).toISOString();
    const geofenceBefore = new Date(now - Number(p.geofence_days)*86400000).toISOString();
    const webhookBefore = new Date(now - Number(p.webhook_days)*86400000).toISOString();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM location_history WHERE project_id=? AND received_at<?").bind(p.id,historyBefore),
      env.DB.prepare("DELETE FROM realtime_events WHERE project_id=? AND created_at<?").bind(p.id,realtimeBefore),
      env.DB.prepare("DELETE FROM webhook_deliveries WHERE project_id=? AND created_at<?").bind(p.id,webhookBefore),
      env.DB.prepare("DELETE FROM geofence_events WHERE project_id=? AND created_at<?").bind(p.id,geofenceBefore)
    ]);
  }
}
