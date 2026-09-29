import {
  authenticateIntegration,
  corsHeaders
} from "./auth.mjs";
import {
  clusterUsers,
  cleanupRetention,
  emitDueDwellEvents,
  heatmapHistory,
  listUsersPage,
  movementHistory,
  recordUsage,
  summary,
  upsertLocation
} from "./d1-store.mjs";
import {
  normalizeGridDegrees,
  parseWindow,
  validateLocationInput
} from "./geo.mjs";
import {
  assertProjectAccess,
  authenticateAdmin,
  handleAdmin,
  handleBootstrap
} from "./admin.mjs";
import { processWebhookMessage } from "./webhooks.mjs";
export { ProjectRealtimeRoom } from "./realtime-room.mjs";

const VERSION = "0.17.0";

function thresholds(env) {
  return {
    onlineSeconds: Number(env.GEOLIVE_ONLINE_SECONDS || 120),
    recentSeconds: Number(env.GEOLIVE_RECENT_SECONDS || 900),
    inactiveSeconds: Number(env.GEOLIVE_INACTIVE_SECONDS || 86400)
  };
}

function securityHeaders() {
  return {
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-frame-options": "DENY",
    "permissions-policy": "geolocation=(), camera=(), microphone=()"
  };
}

function json(value, status = 200, headers = {}) {
  return Response.json(value, {
    status,
    headers: {
      ...securityHeaders(),
      "cache-control": "no-store",
      ...headers
    }
  });
}

function allowedOrigins(env) {
  return String(env.GEOLIVE_ALLOWED_ORIGINS || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function preflight(request, env) {
  const origin = String(request.headers.get("origin") || "");
  if (!origin || !allowedOrigins(env).includes(origin)) {
    return json({ error: "origin_not_allowed" }, 403);
  }
  return new Response(null, {
    status: 204,
    headers: {
      ...securityHeaders(),
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "access-control-allow-headers":
        "Authorization,Content-Type,X-GeoLive-Package,X-CSRF-Token",
      "access-control-max-age": "600",
      vary: "Origin"
    }
  });
}

function room(env, projectId) {
  const id = env.REALTIME.idFromName(projectId);
  return env.REALTIME.get(id);
}

async function broadcast(env, projectId, payload) {
  await room(env,projectId).fetch("https://realtime.internal/broadcast", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
}

async function publicAuth(request, env, scope) {
  const auth = await authenticateIntegration(env,request,scope);
  if (!auth.ok) return { response: json({ error: auth.error },auth.status), auth };
  return { auth, response: null };
}

async function handlePublic(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  const limits = thresholds(env);

  if (path === "/v1/realtime" && request.method === "GET") {
    if (request.headers.get("Upgrade") !== "websocket") {
      return json({ error: "websocket_upgrade_required" }, 400);
    }
    const projectId = String(url.searchParams.get("projectId") || "");
    if (!projectId) return json({ error: "project_required" }, 400);
    const target = new URL("https://realtime.internal/socket");
    target.searchParams.set("projectId",projectId);
    target.searchParams.set("mode","integration");
    return room(env,projectId).fetch(new Request(target, request));
  }

  if (path === "/v1/locations" && request.method === "POST") {
    const gate = await publicAuth(request,env,"location:write");
    if (gate.response) return gate.response;
    let body;
    try { body = validateLocationInput(await request.json()); }
    catch (error) { return json({ error: error.code || "invalid_body" },error.status || 400); }

    try {
      const record = await upsertLocation(env,gate.auth.key.projectId,body);
      const event = {
        type: "location",
        sequence: String(record.sequence || "0"),
        projectId: gate.auth.key.projectId,
        userId: record.userId,
        payload: {
          userId: record.userId,
          name: record.name,
          email: record.email,
          latitude: record.latitude,
          longitude: record.longitude,
          accuracyM: record.accuracyM,
          altitudeM: record.altitudeM,
          headingDeg: record.headingDeg,
          speedMps: record.speedMps,
          capturedAt: record.capturedAt,
          receivedAt: record.receivedAt,
          lastSeenAt: record.receivedAt,
          country: record.country,
          state: record.state,
          city: record.city,
          device: record.device,
          metadata: record.metadata
        },
        createdAt: record.receivedAt
      };
      ctx.waitUntil(broadcast(env,gate.auth.key.projectId,event));
      for (const automation of record.automationEvents || []) {
        ctx.waitUntil(broadcast(env,gate.auth.key.projectId,{
          type: `geofence.${automation.eventType}`,
          sequence: automation.sequence,
          projectId: gate.auth.key.projectId,
          userId: automation.userId,
          payload: automation,
          createdAt: automation.occurredAt
        }));
      }
      return json({
        accepted: true,
        userId: record.userId,
        receivedAt: record.receivedAt,
        eventSequence: String(record.sequence || "0")
      },202,corsHeaders(request,gate.auth));
    } catch (error) {
      return json({ error: error.code || "location_write_failed" },error.status || 500,corsHeaders(request,gate.auth));
    }
  }

  if (path === "/v1/users" && request.method === "GET") {
    const gate = await publicAuth(request,env,"users:read");
    if (gate.response) return gate.response;
    const page = await listUsersPage(env,gate.auth.key.projectId,{
      search:url.searchParams.get("search")||"",
      status:url.searchParams.get("status")||"",
      country:url.searchParams.get("country")||"",
      state:url.searchParams.get("state")||"",
      city:url.searchParams.get("city")||"",
      limit:url.searchParams.get("limit")||100,
      cursor:url.searchParams.get("cursor")||"",
      thresholds:limits
    });
    ctx.waitUntil(recordUsage(env,gate.auth.key.projectId,"api_reads",1));
    return json({ projectId: gate.auth.key.projectId, ...page },200,corsHeaders(request,gate.auth));
  }

  if (path === "/v1/clusters" && request.method === "GET") {
    const gate = await publicAuth(request,env,"users:read");
    if (gate.response) return gate.response;
    try {
      const clusters=await clusterUsers(env,gate.auth.key.projectId,{
        gridDegrees:url.searchParams.get("gridDegrees")||8,
        status:url.searchParams.get("status")||"",
        country:url.searchParams.get("country")||"",
        state:url.searchParams.get("state")||"",
        city:url.searchParams.get("city")||"",
        thresholds:limits
      });
      ctx.waitUntil(recordUsage(env,gate.auth.key.projectId,"api_reads",1));
      return json({projectId:gate.auth.key.projectId,clusters},200,corsHeaders(request,gate.auth));
    } catch(error) {
      return json({error:error.code||"invalid_query"},error.status||400,corsHeaders(request,gate.auth));
    }
  }

  if (path === "/v1/summary" && request.method === "GET") {
    const gate = await publicAuth(request,env,"summary:read");
    if (gate.response) return gate.response;
    const payload=await summary(env,gate.auth.key.projectId,limits);
    ctx.waitUntil(recordUsage(env,gate.auth.key.projectId,"api_reads",1));
    return json({projectId:gate.auth.key.projectId,...payload},200,corsHeaders(request,gate.auth));
  }

  if (path === "/v1/history" && request.method === "GET") {
    const gate = await publicAuth(request,env,"history:read");
    if (gate.response) return gate.response;
    try {
      const userId=String(url.searchParams.get("userId")||"").trim();
      if(!userId) return json({error:"invalid_userId"},400,corsHeaders(request,gate.auth));
      const window=parseWindow(url.searchParams);
      const page=await movementHistory(env,gate.auth.key.projectId,{
        userId,...window,limit:url.searchParams.get("limit")||250,
        cursor:url.searchParams.get("cursor")||""
      });
      ctx.waitUntil(recordUsage(env,gate.auth.key.projectId,"api_reads",1));
      return json({projectId:gate.auth.key.projectId,userId,window,...page},200,corsHeaders(request,gate.auth));
    } catch(error) {
      return json({error:error.code||"invalid_history"},error.status||400,corsHeaders(request,gate.auth));
    }
  }

  if (path === "/v1/heatmap" && request.method === "GET") {
    const gate = await publicAuth(request,env,"history:read");
    if (gate.response) return gate.response;
    try {
      const window=parseWindow(url.searchParams);
      const gridDegrees=normalizeGridDegrees(url.searchParams.get("gridDegrees")||2,2);
      const userId=String(url.searchParams.get("userId")||"").trim()||null;
      const cells=await heatmapHistory(env,gate.auth.key.projectId,{...window,gridDegrees,userId});
      ctx.waitUntil(recordUsage(env,gate.auth.key.projectId,"api_reads",1));
      return json({projectId:gate.auth.key.projectId,window,gridDegrees,userId,cells},200,corsHeaders(request,gate.auth));
    } catch(error) {
      return json({error:error.code||"invalid_heatmap"},error.status||400,corsHeaders(request,gate.auth));
    }
  }

  if (path === "/v1/events") {
    return json({
      error: "sse_not_available_on_cloudflare",
      replacement: "/v1/realtime?projectId=<projectId>"
    },501);
  }

  return null;
}

async function handleAdminRealtime(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== "/v1/admin/realtime") return null;
  if (request.headers.get("Upgrade") !== "websocket") {
    return json({error:"websocket_upgrade_required"},400);
  }
  const auth=await authenticateAdmin(env,request);
  if(!auth.ok) return json({error:auth.error},auth.status);
  const projectId=String(url.searchParams.get("projectId")||"");
  if(!projectId) return json({error:"project_required"},400);
  try { await assertProjectAccess(env,auth.user.id,projectId,false); }
  catch(error){ return json({error:error.code||"project_denied"},error.status||403); }

  const target=new URL("https://realtime.internal/socket");
  target.searchParams.set("projectId",projectId);
  target.searchParams.set("mode","admin");
  const headers=new Headers(request.headers);
  headers.set("x-geolive-internal-admin","1");
  return room(env,projectId).fetch(new Request(target,{
    method:"GET",
    headers
  }));
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      if (request.method === "OPTIONS") return preflight(request,env);

      if (url.pathname === "/health") {
        return json({ok:true,service:"rekixo-geolive-cloudflare",version:VERSION,runtime:"cloudflare-workers"});
      }
      if (url.pathname === "/ready") {
        try {
          await env.DB.prepare("SELECT 1 AS ok").first();
          return json({ready:true,service:"rekixo-geolive-cloudflare",version:VERSION,persistence:"d1",realtime:"durable-objects"});
        } catch {
          return json({ready:false,error:"d1_unavailable"},503);
        }
      }
      if (url.pathname === "/internal/bootstrap" && request.method === "POST") {
        return handleBootstrap(request,env);
      }

      const adminRealtime=await handleAdminRealtime(request,env);
      if(adminRealtime) return adminRealtime;

      if (url.pathname.startsWith("/v1/admin/")) {
        return handleAdmin(request,env,thresholds(env));
      }

      const publicResponse=await handlePublic(request,env,ctx);
      if(publicResponse) return publicResponse;

      return json({error:"not_found"},404);
    } catch (error) {
      console.error("GeoLive Cloudflare request failed",error);
      return json({error:error?.code||"internal_error"},error?.status||500);
    }
  },

  async queue(batch, env) {
    for (const message of batch.messages) {
      try {
        await processWebhookMessage(message,env);
      } catch (error) {
        console.error("GeoLive webhook queue failure",error);
        message.retry({ delaySeconds: Math.min(3600,30*(2**Math.max(0,message.attempts-1))) });
      }
    }
  },

  async scheduled(controller, env, ctx) {
    const run = async () => {
      const dwellEvents=await emitDueDwellEvents(env,100);
      for(const event of dwellEvents){
        await broadcast(env,event.projectId,{
          type:`geofence.${event.eventType}`,
          sequence:event.sequence,
          projectId:event.projectId,
          userId:event.userId,
          payload:event,
          createdAt:event.occurredAt
        });
      }
      await cleanupRetention(env);
      await env.DB.prepare(
        "DELETE FROM admin_sessions WHERE expires_at<?"
      ).bind(new Date().toISOString()).run();
    };
    ctx.waitUntil(run());
  }
};
