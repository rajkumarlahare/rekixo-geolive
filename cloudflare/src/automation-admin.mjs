import { decodeCursor, encodeCursor } from "./geo.mjs";
import {
  deriveWebhookSecret,
  validateWebhookUrl
} from "./webhooks.mjs";

function json(value, status = 200) {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" }
  });
}

function parseJson(value, fallback) {
  try { return JSON.parse(value ?? ""); } catch { return fallback; }
}

function mapGeofence(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    status: row.status,
    shapeType: row.shape_type,
    latitude: row.center_lat == null ? null : Number(row.center_lat),
    longitude: row.center_lng == null ? null : Number(row.center_lng),
    radiusM: row.radius_m == null ? null : Number(row.radius_m),
    points: row.polygon_json ? parseJson(row.polygon_json, null) : null,
    dwellSeconds: Number(row.dwell_seconds || 0),
    metadata: parseJson(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  };
}

function mapEndpoint(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    url: row.url,
    status: row.status,
    signingKeyId: "cloudflare-derived",
    secretGeneration: Number(row.secret_generation || 1),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  };
}

function mapRule(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    geofenceId: row.geofence_id || null,
    webhookEndpointId: row.webhook_endpoint_id,
    name: row.name,
    enabled: Boolean(row.enabled),
    eventTypes: parseJson(row.event_types_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  };
}

function mapEvent(row) {
  return {
    id: String(row.id),
    eventId: row.event_id,
    projectId: row.project_id,
    geofenceId: row.geofence_id,
    geofenceName: row.geofence_name || undefined,
    userId: row.external_user_id,
    eventType: row.event_type,
    occurredAt: row.occurred_at,
    payload: parseJson(row.payload_json, {}),
    createdAt: row.created_at
  };
}

function mapDelivery(row) {
  return {
    id: String(row.id),
    deliveryId: row.delivery_id,
    projectId: row.project_id,
    webhookEndpointId: row.webhook_endpoint_id,
    endpointName: row.endpoint_name || undefined,
    endpointUrl: row.endpoint_url || undefined,
    alertRuleId: row.alert_rule_id,
    alertRuleName: row.alert_rule_name || undefined,
    geofenceEventId: String(row.geofence_event_id),
    eventId: row.event_id || undefined,
    eventType: row.event_type || undefined,
    occurredAt: row.occurred_at || undefined,
    userId: row.external_user_id || undefined,
    geofenceId: row.geofence_id || undefined,
    geofenceName: row.geofence_name || undefined,
    status: row.status,
    attemptCount: Number(row.attempt_count || 0),
    nextAttemptAt: row.next_attempt_at,
    responseStatus: row.response_status == null ? null : Number(row.response_status),
    responseBodyExcerpt: row.response_body_excerpt || null,
    lastError: row.last_error || null,
    deliveredAt: row.delivered_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function validName(value, max = 120) {
  const name = String(value || "").trim();
  if (name.length < 2 || name.length > max) {
    throw Object.assign(new Error("invalid_name"), { code: "invalid_name", status: 400 });
  }
  return name;
}

function normalizedPolygon(points) {
  if (!Array.isArray(points) || points.length < 3 || points.length > 500) {
    throw Object.assign(new Error("invalid_polygon"), { code: "invalid_polygon", status: 400 });
  }
  const normalized = points.map((point) => {
    if (!Array.isArray(point) || point.length < 2) {
      throw Object.assign(new Error("invalid_polygon"), { code: "invalid_polygon", status: 400 });
    }
    const lng = Number(point[0]);
    const lat = Number(point[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw Object.assign(new Error("invalid_polygon"), { code: "invalid_polygon", status: 400 });
    }
    return [lng, lat];
  });
  if (normalized.length >= 4) {
    const first = normalized[0];
    const last = normalized[normalized.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) return normalized;
  }
  return [...normalized, [...normalized[0]]];
}

function geofenceShape(body) {
  const shapeType = String(body.shapeType || "");
  const dwellSeconds = Number(body.dwellSeconds ?? 300);
  if (!Number.isInteger(dwellSeconds) || dwellSeconds < 0 || dwellSeconds > 604800) {
    throw Object.assign(new Error("invalid_dwell"), { code: "invalid_dwell", status: 400 });
  }
  if (shapeType === "circle") {
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);
    const radiusM = Number(body.radiusM);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
        !Number.isFinite(radiusM) || radiusM < 10 || radiusM > 1000000) {
      throw Object.assign(new Error("invalid_circle"), { code: "invalid_circle", status: 400 });
    }
    return {
      shapeType,
      latitude,
      longitude,
      radiusM,
      points: null,
      dwellSeconds
    };
  }
  if (shapeType === "polygon") {
    return {
      shapeType,
      latitude: null,
      longitude: null,
      radiusM: null,
      points: normalizedPolygon(body.points),
      dwellSeconds
    };
  }
  throw Object.assign(new Error("invalid_shape_type"), { code: "invalid_shape_type", status: 400 });
}

async function geofences(request, env, project, resource, adminUserId) {
  const item = resource.match(/^geofences\/([^/]+)$/);
  if (resource === "geofences" && request.method === "GET") {
    const result = await env.DB.prepare(
      "SELECT * FROM geofences WHERE project_id=? AND deleted_at IS NULL ORDER BY created_at DESC"
    ).bind(project.id).all();
    return json({ geofences: (result.results || []).map(mapGeofence) });
  }

  if (resource === "geofences" && request.method === "POST") {
    const body = await request.json();
    const name = validName(body.name);
    const shape = geofenceShape(body);
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO geofences(
        id,project_id,name,status,shape_type,center_lat,center_lng,radius_m,
        polygon_json,dwell_seconds,metadata_json,created_by_admin_user_id,
        updated_by_admin_user_id,created_at,updated_at
      ) VALUES(?,?,?,'active',?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      id,project.id,name,shape.shapeType,shape.latitude,shape.longitude,
      shape.radiusM,shape.points ? JSON.stringify(shape.points) : null,
      shape.dwellSeconds,JSON.stringify(body.metadata || {}),adminUserId,
      adminUserId,now,now
    ).run();
    const row = await env.DB.prepare("SELECT * FROM geofences WHERE id=?").bind(id).first();
    return json({ geofence: mapGeofence(row) }, 201);
  }

  if (!item) return null;
  const id = decodeURIComponent(item[1]);
  const existing = await env.DB.prepare(
    "SELECT * FROM geofences WHERE id=? AND project_id=? AND deleted_at IS NULL"
  ).bind(id,project.id).first();
  if (!existing) return json({ error: "geofence_not_found" },404);

  if (request.method === "PATCH") {
    const body = await request.json();
    const now = new Date().toISOString();
    let shape = null;
    if (body.shapeType || body.latitude != null || body.longitude != null || body.radiusM != null || body.points) {
      shape = geofenceShape({
        shapeType: body.shapeType || existing.shape_type,
        latitude: body.latitude ?? existing.center_lat,
        longitude: body.longitude ?? existing.center_lng,
        radiusM: body.radiusM ?? existing.radius_m,
        points: body.points ?? parseJson(existing.polygon_json, null),
        dwellSeconds: body.dwellSeconds ?? existing.dwell_seconds
      });
    }
    const name = body.name == null ? existing.name : validName(body.name);
    const status = body.status == null ? existing.status : String(body.status);
    if (!["active","paused"].includes(status)) return json({error:"invalid_status"},400);
    const dwell = shape ? shape.dwellSeconds : Number(body.dwellSeconds ?? existing.dwell_seconds);
    if (!Number.isInteger(dwell) || dwell < 0 || dwell > 604800) return json({error:"invalid_dwell"},400);
    const finalShape = shape || {
      shapeType: existing.shape_type,
      latitude: existing.center_lat,
      longitude: existing.center_lng,
      radiusM: existing.radius_m,
      points: parseJson(existing.polygon_json,null)
    };
    await env.DB.prepare(
      `UPDATE geofences SET
        name=?,status=?,shape_type=?,center_lat=?,center_lng=?,radius_m=?,
        polygon_json=?,dwell_seconds=?,updated_by_admin_user_id=?,updated_at=?
       WHERE id=? AND project_id=?`
    ).bind(
      name,status,finalShape.shapeType,finalShape.latitude,finalShape.longitude,
      finalShape.radiusM,finalShape.points ? JSON.stringify(finalShape.points) : null,
      dwell,adminUserId,now,id,project.id
    ).run();
    const row=await env.DB.prepare("SELECT * FROM geofences WHERE id=?").bind(id).first();
    return json({geofence:mapGeofence(row)});
  }

  if (request.method === "DELETE") {
    const now=new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE geofences SET status='deleted',deleted_at=?,updated_at=? WHERE id=? AND project_id=?"
      ).bind(now,now,id,project.id),
      env.DB.prepare(
        "UPDATE alert_rules SET enabled=0,updated_at=? WHERE project_id=? AND geofence_id=?"
      ).bind(now,project.id,id)
    ]);
    return json({ok:true});
  }
  return null;
}

async function endpoints(request, env, project, resource, adminUserId) {
  const item=resource.match(/^webhook-endpoints\/([^/]+)$/);
  const rotate=resource.match(/^webhook-endpoints\/([^/]+)\/rotate$/);
  if(resource==="webhook-endpoints" && request.method==="GET"){
    const result=await env.DB.prepare(
      "SELECT * FROM webhook_endpoints WHERE project_id=? AND deleted_at IS NULL ORDER BY created_at DESC"
    ).bind(project.id).all();
    return json({endpoints:(result.results||[]).map(mapEndpoint)});
  }
  if(resource==="webhook-endpoints" && request.method==="POST"){
    const body=await request.json();
    const name=validName(body.name,80);
    let url;
    try{url=validateWebhookUrl(body.url);}catch(error){return json({error:error.code},error.status||400);}
    const id=crypto.randomUUID(),now=new Date().toISOString(),generation=1;
    await env.DB.prepare(
      `INSERT INTO webhook_endpoints(
        id,project_id,name,url,status,secret_generation,created_by_admin_user_id,
        updated_by_admin_user_id,created_at,updated_at
      ) VALUES(?,?,?,?,'active',?,?,?,?,?)`
    ).bind(id,project.id,name,url,generation,adminUserId,adminUserId,now,now).run();
    const row=await env.DB.prepare("SELECT * FROM webhook_endpoints WHERE id=?").bind(id).first();
    return json({
      endpoint:mapEndpoint(row),
      secret:deriveWebhookSecret(env,project.id,id,generation)
    },201);
  }
  if(rotate && request.method==="POST"){
    const id=decodeURIComponent(rotate[1]);
    const row=await env.DB.prepare(
      "SELECT * FROM webhook_endpoints WHERE id=? AND project_id=? AND deleted_at IS NULL"
    ).bind(id,project.id).first();
    if(!row)return json({error:"webhook_endpoint_not_found"},404);
    const generation=Number(row.secret_generation||1)+1,now=new Date().toISOString();
    await env.DB.prepare(
      "UPDATE webhook_endpoints SET secret_generation=?,updated_by_admin_user_id=?,updated_at=? WHERE id=?"
    ).bind(generation,adminUserId,now,id).run();
    return json({endpoint:{...mapEndpoint(row),secretGeneration:generation},secret:deriveWebhookSecret(env,project.id,id,generation)},201);
  }
  if(!item)return null;
  const id=decodeURIComponent(item[1]);
  const row=await env.DB.prepare(
    "SELECT * FROM webhook_endpoints WHERE id=? AND project_id=? AND deleted_at IS NULL"
  ).bind(id,project.id).first();
  if(!row)return json({error:"webhook_endpoint_not_found"},404);
  if(request.method==="PATCH"){
    const body=await request.json(),now=new Date().toISOString();
    const name=body.name==null?row.name:validName(body.name,80);
    let url=row.url;
    if(body.url!=null){try{url=validateWebhookUrl(body.url);}catch(error){return json({error:error.code},error.status||400);}}
    const status=body.status==null?row.status:String(body.status);
    if(!["active","paused"].includes(status))return json({error:"invalid_status"},400);
    await env.DB.prepare(
      "UPDATE webhook_endpoints SET name=?,url=?,status=?,updated_by_admin_user_id=?,updated_at=? WHERE id=?"
    ).bind(name,url,status,adminUserId,now,id).run();
    const next=await env.DB.prepare("SELECT * FROM webhook_endpoints WHERE id=?").bind(id).first();
    return json({endpoint:mapEndpoint(next)});
  }
  if(request.method==="DELETE"){
    const now=new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE webhook_endpoints SET status='deleted',deleted_at=?,updated_at=? WHERE id=?"
      ).bind(now,now,id),
      env.DB.prepare(
        "UPDATE alert_rules SET enabled=0,updated_at=? WHERE project_id=? AND webhook_endpoint_id=?"
      ).bind(now,project.id,id),
      env.DB.prepare(
        `UPDATE webhook_deliveries SET status='dead',last_error='endpoint_deleted',updated_at=?
         WHERE project_id=? AND webhook_endpoint_id=? AND status IN ('pending','retry')`
      ).bind(now,project.id,id)
    ]);
    return json({ok:true});
  }
  return null;
}

async function rules(request, env, project, resource, adminUserId) {
  const item=resource.match(/^alert-rules\/([^/]+)$/);
  if(resource==="alert-rules" && request.method==="GET"){
    const result=await env.DB.prepare(
      "SELECT * FROM alert_rules WHERE project_id=? AND deleted_at IS NULL ORDER BY created_at DESC"
    ).bind(project.id).all();
    return json({alertRules:(result.results||[]).map(mapRule)});
  }
  if(resource==="alert-rules" && request.method==="POST"){
    const body=await request.json();
    const name=validName(body.name,100);
    const endpointId=String(body.webhookEndpointId||"");
    const geofenceId=body.geofenceId?String(body.geofenceId):null;
    const types=Array.isArray(body.eventTypes)?[...new Set(body.eventTypes.map(String))]:[];
    if(!endpointId||!types.length||types.some((x)=>!["enter","exit","dwell"].includes(x))){
      return json({error:"invalid_alert_rule"},400);
    }
    const endpoint=await env.DB.prepare(
      "SELECT 1 AS ok FROM webhook_endpoints WHERE id=? AND project_id=? AND deleted_at IS NULL"
    ).bind(endpointId,project.id).first();
    if(!endpoint)return json({error:"webhook_endpoint_not_found"},404);
    if(geofenceId){
      const fence=await env.DB.prepare(
        "SELECT 1 AS ok FROM geofences WHERE id=? AND project_id=? AND deleted_at IS NULL"
      ).bind(geofenceId,project.id).first();
      if(!fence)return json({error:"geofence_not_found"},404);
    }
    const id=crypto.randomUUID(),now=new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO alert_rules(
        id,project_id,geofence_id,webhook_endpoint_id,name,enabled,event_types_json,
        created_by_admin_user_id,updated_by_admin_user_id,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(id,project.id,geofenceId,endpointId,name,body.enabled===false?0:1,JSON.stringify(types),adminUserId,adminUserId,now,now).run();
    const row=await env.DB.prepare("SELECT * FROM alert_rules WHERE id=?").bind(id).first();
    return json({alertRule:mapRule(row)},201);
  }
  if(!item)return null;
  const id=decodeURIComponent(item[1]);
  const row=await env.DB.prepare(
    "SELECT * FROM alert_rules WHERE id=? AND project_id=? AND deleted_at IS NULL"
  ).bind(id,project.id).first();
  if(!row)return json({error:"alert_rule_not_found"},404);
  if(request.method==="PATCH"){
    const body=await request.json(),now=new Date().toISOString();
    const enabled=body.enabled==null?Number(row.enabled):(body.enabled?1:0);
    await env.DB.prepare(
      "UPDATE alert_rules SET enabled=?,updated_by_admin_user_id=?,updated_at=? WHERE id=?"
    ).bind(enabled,adminUserId,now,id).run();
    const next=await env.DB.prepare("SELECT * FROM alert_rules WHERE id=?").bind(id).first();
    return json({alertRule:mapRule(next)});
  }
  if(request.method==="DELETE"){
    const now=new Date().toISOString();
    await env.DB.prepare(
      "UPDATE alert_rules SET enabled=0,deleted_at=?,updated_at=? WHERE id=?"
    ).bind(now,now,id).run();
    return json({ok:true});
  }
  return null;
}

async function eventHistory(request, env, project, resource) {
  if(resource!=="geofence-events"||request.method!=="GET")return null;
  const url=new URL(request.url);
  const limit=Math.min(Math.max(Number(url.searchParams.get("limit")||50),1),200);
  const cursor=decodeCursor(url.searchParams.get("cursor")||"");
  const values=[project.id],where=["e.project_id=?"];
  const eventType=url.searchParams.get("eventType")||"";
  const geofenceId=url.searchParams.get("geofenceId")||"";
  const userId=url.searchParams.get("userId")||"";
  if(eventType){values.push(eventType);where.push("e.event_type=?");}
  if(geofenceId){values.push(geofenceId);where.push("e.geofence_id=?");}
  if(userId){values.push(`%${userId.toLowerCase()}%`);where.push("lower(e.external_user_id) LIKE ?");}
  if(cursor?.id){values.push(Number(cursor.id));where.push("e.id<?");}
  const result=await env.DB.prepare(
    `SELECT e.*,g.name AS geofence_name
     FROM geofence_events e JOIN geofences g ON g.id=e.geofence_id
     WHERE ${where.join(" AND ")}
     ORDER BY e.id DESC LIMIT ?`
  ).bind(...values,limit+1).all();
  const rows=result.results||[],hasMore=rows.length>limit,events=rows.slice(0,limit).map(mapEvent);
  return json({events,nextCursor:hasMore&&events.length?encodeCursor({id:events[events.length-1].id}):null});
}

async function deliveryHistory(request, env, project, resource) {
  const detail=resource.match(/^webhook-deliveries\/([^/]+)$/);
  const retry=resource.match(/^webhook-deliveries\/([^/]+)\/retry$/);
  if(resource==="webhook-deliveries"&&request.method==="GET"){
    const url=new URL(request.url);
    const limit=Math.min(Math.max(Number(url.searchParams.get("limit")||50),1),200);
    const cursor=decodeCursor(url.searchParams.get("cursor")||"");
    const values=[project.id],where=["d.project_id=?"];
    const status=url.searchParams.get("status")||"";
    const endpointId=url.searchParams.get("endpointId")||"";
    const eventType=url.searchParams.get("eventType")||"";
    if(status){values.push(status);where.push("d.status=?");}
    if(endpointId){values.push(endpointId);where.push("d.webhook_endpoint_id=?");}
    if(eventType){values.push(eventType);where.push("ge.event_type=?");}
    if(cursor?.id){values.push(Number(cursor.id));where.push("d.id<?");}
    const result=await env.DB.prepare(
      `SELECT d.*,ep.name AS endpoint_name,ep.url AS endpoint_url,
        r.name AS alert_rule_name,ge.event_id,ge.event_type,ge.occurred_at,
        ge.external_user_id,ge.geofence_id,g.name AS geofence_name
       FROM webhook_deliveries d
       JOIN webhook_endpoints ep ON ep.id=d.webhook_endpoint_id
       JOIN alert_rules r ON r.id=d.alert_rule_id
       JOIN geofence_events ge ON ge.id=d.geofence_event_id
       JOIN geofences g ON g.id=ge.geofence_id
       WHERE ${where.join(" AND ")}
       ORDER BY d.id DESC LIMIT ?`
    ).bind(...values,limit+1).all();
    const rows=result.results||[],hasMore=rows.length>limit,deliveries=rows.slice(0,limit).map(mapDelivery);
    return json({deliveries,nextCursor:hasMore&&deliveries.length?encodeCursor({id:deliveries[deliveries.length-1].id}):null});
  }
  if(detail&&request.method==="GET"){
    const deliveryId=decodeURIComponent(detail[1]);
    const row=await env.DB.prepare(
      `SELECT d.*,ep.name AS endpoint_name,ep.url AS endpoint_url,
        r.name AS alert_rule_name,ge.event_id,ge.event_type,ge.occurred_at,
        ge.external_user_id,ge.geofence_id,ge.payload_json,g.name AS geofence_name
       FROM webhook_deliveries d
       JOIN webhook_endpoints ep ON ep.id=d.webhook_endpoint_id
       JOIN alert_rules r ON r.id=d.alert_rule_id
       JOIN geofence_events ge ON ge.id=d.geofence_event_id
       JOIN geofences g ON g.id=ge.geofence_id
       WHERE d.project_id=? AND d.delivery_id=? LIMIT 1`
    ).bind(project.id,deliveryId).first();
    if(!row)return json({error:"webhook_delivery_not_found"},404);
    const attempts=await env.DB.prepare(
      "SELECT * FROM webhook_delivery_attempts WHERE webhook_delivery_id=? ORDER BY attempt_number DESC,id DESC"
    ).bind(row.id).all();
    return json({
      delivery:mapDelivery(row),
      eventPayload:parseJson(row.payload_json,{}),
      attempts:(attempts.results||[]).map((a)=>({
        id:String(a.id),attemptNumber:Number(a.attempt_number),
        startedAt:a.started_at,completedAt:a.completed_at,
        responseStatus:a.response_status==null?null:Number(a.response_status),
        latencyMs:Number(a.latency_ms||0),errorText:a.error_text||null
      }))
    });
  }
  if(retry&&request.method==="POST"){
    const deliveryId=decodeURIComponent(retry[1]),now=new Date().toISOString();
    const result=await env.DB.prepare(
      `UPDATE webhook_deliveries
       SET status='retry',attempt_count=0,next_attempt_at=?,response_status=NULL,
         response_body_excerpt=NULL,last_error=NULL,delivered_at=NULL,updated_at=?
       WHERE project_id=? AND delivery_id=? AND status='dead'`
    ).bind(now,now,project.id,deliveryId).run();
    if(!result.meta?.changes)return json({error:"webhook_delivery_not_retryable"},409);
    if(env.WEBHOOK_QUEUE)await env.WEBHOOK_QUEUE.send({deliveryId});
    return json({ok:true});
  }
  return null;
}

export async function handleAutomationAdmin({
  request,
  env,
  project,
  resource,
  adminUserId
}) {
  for (const handler of [geofences,endpoints,rules,eventHistory,deliveryHistory]) {
    const response=await handler(request,env,project,resource,adminUserId);
    if(response)return response;
  }
  return null;
}
