import {
  hashPassword,
  normalizeAdminEmail,
  randomCsrfToken,
  randomSessionToken,
  sha256Secret,
  verifyPassword
} from "../../server/src/passwords.mjs";
import { randomSecret } from "./auth.mjs";
import {
  clusterUsers,
  facets,
  heatmapHistory,
  listUsersPage,
  movementHistory,
  summary
} from "./d1-store.mjs";
import { parseWindow, normalizeGridDegrees } from "./geo.mjs";
import { handleAutomationAdmin } from "./automation-admin.mjs";

const COOKIE = "gla_session";

function json(value, status = 200, headers = {}) {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      ...headers
    }
  });
}

function parseCookie(request, name) {
  const raw = String(request.headers.get("cookie") || "");
  for (const part of raw.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return "";
}

function sessionCookie(token, maxAgeSeconds) {
  return [
    `${COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`
  ].join("; ");
}

async function visibleContext(env, user) {
  const memberships = await env.DB.prepare(
    `SELECT m.account_id,m.role,a.name,a.status
     FROM account_memberships m
     JOIN accounts a ON a.id=m.account_id
     WHERE m.admin_user_id=? AND a.status<>'deleted'
     ORDER BY a.created_at ASC`
  ).bind(user.id).all();
  const accounts = (memberships.results || []).map((row) => ({
    id: row.account_id,
    name: row.name,
    status: row.status,
    role: row.role
  }));
  if (!accounts.length) return { accounts: [], projects: [] };

  const ids = accounts.map((x) => x.id);
  const placeholders = ids.map(() => "?").join(",");
  const projectsResult = await env.DB.prepare(
    `SELECT id,account_id,slug,name,status,created_at,updated_at
     FROM projects
     WHERE account_id IN (${placeholders}) AND status<>'deleted'
     ORDER BY created_at ASC`
  ).bind(...ids).all();
  const roleByAccount = new Map(accounts.map((a) => [a.id, a.role]));
  const projects = (projectsResult.results || []).map((row) => ({
    id: row.id,
    accountId: row.account_id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    role: roleByAccount.get(row.account_id) || "viewer",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
  return { accounts, projects };
}

export async function authenticateAdmin(env, request, { csrf = false } = {}) {
  const token = parseCookie(request, COOKIE);
  if (!token) return { ok: false, status: 401, error: "admin_session_required" };
  const hash = sha256Secret(token);
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `SELECT s.id AS session_id,s.csrf_hash,s.expires_at,u.id,u.email,u.display_name,u.status
     FROM admin_sessions s
     JOIN admin_users u ON u.id=s.admin_user_id
     WHERE s.token_hash=? AND s.expires_at>? AND u.status='active'
     LIMIT 1`
  ).bind(hash, now).first();
  if (!row) return { ok: false, status: 401, error: "admin_session_required" };

  if (csrf) {
    const supplied = String(request.headers.get("x-csrf-token") || "");
    if (!supplied || sha256Secret(supplied) !== row.csrf_hash) {
      return { ok: false, status: 403, error: "csrf_invalid" };
    }
  }

  await env.DB.prepare(
    "UPDATE admin_sessions SET last_seen_at=? WHERE id=?"
  ).bind(now, row.session_id).run();

  return {
    ok: true,
    sessionId: row.session_id,
    user: {
      id: row.id,
      email: row.email,
      displayName: row.display_name
    }
  };
}

export async function assertProjectAccess(env, userId, projectId, write = false) {
  const row = await env.DB.prepare(
    `SELECT p.id,p.account_id,p.slug,p.name,p.status,m.role
     FROM projects p
     JOIN account_memberships m
       ON m.account_id=p.account_id AND m.admin_user_id=?
     WHERE p.id=? AND p.status<>'deleted'
     LIMIT 1`
  ).bind(userId, projectId).first();
  if (!row) {
    throw Object.assign(new Error("project_not_found"), { code: "project_not_found", status: 404 });
  }
  if (write && !["owner","admin"].includes(row.role)) {
    throw Object.assign(new Error("project_role_denied"), { code: "project_role_denied", status: 403 });
  }
  return {
    id: row.id,
    accountId: row.account_id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    role: row.role
  };
}

export async function handleBootstrap(request, env) {
  const expected = String(env.GEOLIVE_BOOTSTRAP_TOKEN || "");
  const supplied = String(request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!expected || !supplied || sha256Secret(expected) !== sha256Secret(supplied)) {
    return json({ error: "bootstrap_denied" }, 403);
  }

  const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM admin_users").first();
  if (Number(count?.count || 0) > 0) {
    return json({ error: "already_bootstrapped" }, 409);
  }

  const body = await request.json();
  const email = normalizeAdminEmail(body.email);
  const displayName = String(body.displayName || "").trim();
  const accountName = String(body.accountName || "Rekixo").trim();
  const projectName = String(body.projectName || "GeoLive Production").trim();
  const projectSlug = String(body.projectSlug || "production").trim().toLowerCase();
  if (displayName.length < 2 || accountName.length < 2 || projectName.length < 2 ||
      !/^[a-z0-9][a-z0-9-]{1,62}$/.test(projectSlug)) {
    return json({ error: "invalid_bootstrap_input" }, 400);
  }

  const now = new Date().toISOString();
  const userId = crypto.randomUUID();
  const accountId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const passwordHash = await hashPassword(body.password);
  const keySecret = randomSecret("rgl_live_", 32);
  const keyId = crypto.randomUUID();
  const keyHash = sha256Secret(keySecret);
  const prefix = keySecret.slice(0, 16);
  const scopes = [
    "location:write","users:read","history:read","summary:read","events:read","tokens:issue"
  ];

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO accounts(id,name,status,created_at,updated_at) VALUES(?,?,'active',?,?)"
    ).bind(accountId,accountName,now,now),
    env.DB.prepare(
      `INSERT INTO admin_users(
        id,email,display_name,password_hash,status,created_at,updated_at
      ) VALUES(?,?,?,?,'active',?,?)`
    ).bind(userId,email,displayName,passwordHash,now,now),
    env.DB.prepare(
      `INSERT INTO account_memberships(
        account_id,admin_user_id,role,created_at,updated_at
      ) VALUES(?,?,'owner',?,?)`
    ).bind(accountId,userId,now,now),
    env.DB.prepare(
      `INSERT INTO projects(
        id,account_id,slug,name,status,created_at,updated_at
      ) VALUES(?,?,?,?,'active',?,?)`
    ).bind(projectId,accountId,projectSlug,projectName,now,now),
    env.DB.prepare(
      `INSERT INTO project_limits(
        project_id,max_live_users,history_retention_days,realtime_retention_hours,
        geofence_event_retention_days,webhook_delivery_retention_days,updated_at
      ) VALUES(?,100000,30,24,90,30,?)`
    ).bind(projectId,now),
    env.DB.prepare(
      `INSERT INTO api_keys(
        id,project_id,name,prefix,secret_hash,scopes_json,
        allowed_origins_json,allowed_packages_json,created_by_admin_user_id,
        created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      keyId,projectId,"Production bootstrap key",prefix,keyHash,
      JSON.stringify(scopes),JSON.stringify([]),JSON.stringify([]),userId,now,now
    ),
    env.DB.prepare(
      `INSERT INTO audit_log(
        admin_user_id,account_id,project_id,action,details_json,created_at
      ) VALUES(?,?,?,'cloudflare.bootstrap',?,?)`
    ).bind(userId,accountId,projectId,JSON.stringify({ projectSlug }),now)
  ]);

  return json({
    created: true,
    user: { id: userId, email, displayName },
    account: { id: accountId, name: accountName },
    project: { id: projectId, slug: projectSlug, name: projectName },
    integrationKey: {
      id: keyId,
      secret: keySecret,
      scopes,
      note: "This secret is returned once. Store it securely."
    }
  }, 201);
}

async function login(request, env) {
  const body = await request.json();
  let email;
  try { email = normalizeAdminEmail(body.email); }
  catch { return json({ error: "invalid_credentials" }, 401); }

  const row = await env.DB.prepare(
    `SELECT id,email,display_name,password_hash,status,failed_login_count,locked_until
     FROM admin_users WHERE lower(email)=lower(?) LIMIT 1`
  ).bind(email).first();
  const now = new Date();
  if (!row || row.status !== "active") {
    return json({ error: "invalid_credentials" }, 401);
  }
  if (row.locked_until && new Date(row.locked_until) > now) {
    return json({ error: "login_locked" }, 429);
  }

  const valid = await verifyPassword(String(body.password || ""), row.password_hash);
  if (!valid) {
    const nextFailures = Number(row.failed_login_count || 0) + 1;
    const maxFailures = Number(env.GEOLIVE_ADMIN_MAX_FAILED_LOGINS || 5);
    const lockMinutes = Number(env.GEOLIVE_ADMIN_LOCK_MINUTES || 15);
    const lockedUntil = nextFailures >= maxFailures
      ? new Date(now.getTime() + lockMinutes * 60000).toISOString()
      : null;
    await env.DB.prepare(
      "UPDATE admin_users SET failed_login_count=?,locked_until=?,updated_at=? WHERE id=?"
    ).bind(nextFailures,lockedUntil,now.toISOString(),row.id).run();
    return json({ error: lockedUntil ? "login_locked" : "invalid_credentials" }, lockedUntil ? 429 : 401);
  }

  const token = randomSessionToken();
  const csrf = randomCsrfToken();
  const hours = Math.min(Math.max(Number(env.GEOLIVE_ADMIN_SESSION_HOURS || 12),1),168);
  const expires = new Date(now.getTime() + hours * 3600000).toISOString();
  const sessionId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO admin_sessions(
        id,admin_user_id,token_hash,csrf_hash,expires_at,created_at,last_seen_at
      ) VALUES(?,?,?,?,?,?,?)`
    ).bind(sessionId,row.id,sha256Secret(token),sha256Secret(csrf),expires,now.toISOString(),now.toISOString()),
    env.DB.prepare(
      "UPDATE admin_users SET failed_login_count=0,locked_until=NULL,updated_at=? WHERE id=?"
    ).bind(now.toISOString(),row.id)
  ]);

  const user = { id: row.id, email: row.email, displayName: row.display_name };
  const context = await visibleContext(env, user);
  return json({
    user,
    platformRole: null,
    ...context,
    csrfToken: csrf
  }, 200, { "set-cookie": sessionCookie(token, hours * 3600) });
}

async function me(request, env) {
  const auth = await authenticateAdmin(env, request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const context = await visibleContext(env, auth.user);
  const csrf = randomCsrfToken();
  await env.DB.prepare(
    "UPDATE admin_sessions SET csrf_hash=? WHERE id=?"
  ).bind(sha256Secret(csrf),auth.sessionId).run();
  return json({
    user: auth.user,
    platformRole: null,
    ...context,
    csrfToken: csrf
  });
}

async function logout(request, env) {
  const auth = await authenticateAdmin(env, request, { csrf: true });
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  await env.DB.prepare("DELETE FROM admin_sessions WHERE id=?").bind(auth.sessionId).run();
  return json({ ok: true }, 200, { "set-cookie": sessionCookie("", 0) });
}

async function projectMetrics(env, projectId, hours) {
  const since = new Date(Date.now() - Math.min(Math.max(Number(hours)||24,1),168)*3600000).toISOString();
  const reads = await env.DB.prepare(
    `SELECT
      COALESCE(SUM(location_writes),0)+COALESCE(SUM(api_reads),0) AS requests,
      COALESCE(SUM(location_writes),0) AS writes,
      COALESCE(SUM(api_reads),0) AS reads,
      COALESCE(SUM(realtime_events),0) AS realtime_events,
      COALESCE(SUM(webhook_attempts),0) AS webhook_attempts
     FROM usage_daily
     WHERE project_id=? AND usage_date>=substr(?,1,10)`
  ).bind(projectId,since).first();
  return {
    metrics: {
      totals: {
        requests: Number(reads?.requests || 0),
        writes: Number(reads?.writes || 0),
        reads: Number(reads?.reads || 0),
        realtimeEvents: Number(reads?.realtime_events || 0),
        webhookAttempts: Number(reads?.webhook_attempts || 0)
      }
    }
  };
}

async function listGeofences(env, projectId) {
  const result = await env.DB.prepare(
    `SELECT id,project_id,name,status,shape_type,center_lat,center_lng,radius_m,
      polygon_json,dwell_seconds,metadata_json,created_at,updated_at
     FROM geofences
     WHERE project_id=? AND deleted_at IS NULL
     ORDER BY created_at DESC`
  ).bind(projectId).all();
  return {
    geofences: (result.results || []).map((row) => ({
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      status: row.status,
      shapeType: row.shape_type,
      center: row.center_lat == null ? null : {
        latitude: Number(row.center_lat),
        longitude: Number(row.center_lng)
      },
      radiusM: row.radius_m == null ? null : Number(row.radius_m),
      polygon: row.polygon_json ? JSON.parse(row.polygon_json) : null,
      dwellSeconds: Number(row.dwell_seconds || 0),
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : {},
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  };
}

async function createProject(request, env, auth) {
  const body = await request.json();
  const accountId = String(body.accountId || "");
  const membership = await env.DB.prepare(
    "SELECT role FROM account_memberships WHERE account_id=? AND admin_user_id=?"
  ).bind(accountId,auth.user.id).first();
  if (!membership || !["owner","admin"].includes(membership.role)) {
    return json({ error: "account_role_denied" }, 403);
  }
  const slug = String(body.slug || "").trim().toLowerCase();
  const name = String(body.name || "").trim();
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug) || name.length < 2 || name.length > 120) {
    return json({ error: "invalid_project" }, 400);
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO projects(id,account_id,slug,name,status,created_at,updated_at) VALUES(?,?,?,?,'active',?,?)"
    ).bind(id,accountId,slug,name,now,now),
    env.DB.prepare(
      `INSERT INTO project_limits(
        project_id,max_live_users,history_retention_days,realtime_retention_hours,
        geofence_event_retention_days,webhook_delivery_retention_days,updated_at
      ) VALUES(?,100000,30,24,90,30,?)`
    ).bind(id,now)
  ]);
  return json({ project: { id, accountId, slug, name, status: "active", role: membership.role } }, 201);
}

async function listKeys(env, projectId) {
  const result = await env.DB.prepare(
    `SELECT id,name,prefix,scopes_json,allowed_origins_json,allowed_packages_json,
      expires_at,revoked_at,created_at,updated_at
     FROM api_keys WHERE project_id=? ORDER BY created_at DESC`
  ).bind(projectId).all();
  return {
    keys: (result.results || []).map((row) => ({
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      scopes: JSON.parse(row.scopes_json || "[]"),
      allowedOrigins: JSON.parse(row.allowed_origins_json || "[]"),
      allowedPackages: JSON.parse(row.allowed_packages_json || "[]"),
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  };
}

async function createKey(request, env, project, adminUserId) {
  const body = await request.json();
  const name = String(body.name || "API key").trim();
  const scopes = Array.isArray(body.scopes) ? [...new Set(body.scopes.map(String))] : [];
  if (name.length < 2 || name.length > 80 || !scopes.length) {
    return json({ error: "invalid_api_key" }, 400);
  }
  const secret = randomSecret("rgl_live_", 32);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO api_keys(
      id,project_id,name,prefix,secret_hash,scopes_json,
      allowed_origins_json,allowed_packages_json,expires_at,
      created_by_admin_user_id,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    id,project.id,name,secret.slice(0,16),sha256Secret(secret),
    JSON.stringify(scopes),
    JSON.stringify(Array.isArray(body.allowedOrigins)?body.allowedOrigins.map(String):[]),
    JSON.stringify(Array.isArray(body.allowedPackages)?body.allowedPackages.map(String):[]),
    body.expiresAt || null,adminUserId,now,now
  ).run();
  return json({ key: { id, name, prefix: secret.slice(0,16), scopes }, secret }, 201);
}

export async function handleAdmin(request, env, thresholds) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/v1/admin/login" && request.method === "POST") return login(request, env);
  if (path === "/v1/admin/me" && request.method === "GET") return me(request, env);
  if (path === "/v1/admin/logout" && request.method === "POST") return logout(request, env);

  const mutation = !["GET","HEAD"].includes(request.method);
  const auth = await authenticateAdmin(env, request, { csrf: mutation });
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  if (path === "/v1/admin/projects" && request.method === "GET") {
    const context = await visibleContext(env, auth.user);
    return json({ projects: context.projects });
  }
  if (path === "/v1/admin/projects" && request.method === "POST") {
    return createProject(request, env, auth);
  }

  const match = path.match(/^\/v1\/admin\/projects\/([^/]+)(?:\/(.*))?$/);
  if (!match) return json({ error: "not_found" }, 404);
  const projectId = decodeURIComponent(match[1]);
  const resource = match[2] || "";
  let project;
  try {
    project = await assertProjectAccess(env, auth.user.id, projectId, mutation);
  } catch (error) {
    return json({ error: error.code || "project_denied" }, error.status || 403);
  }

  if (!resource && request.method === "PATCH") {
    const body = await request.json();
    const fields = [];
    const values = [];
    if (body.name != null) {
      const name = String(body.name).trim();
      if (name.length < 2 || name.length > 120) return json({ error: "invalid_name" },400);
      fields.push("name=?"); values.push(name);
    }
    if (body.slug != null) {
      const slug = String(body.slug).trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) return json({ error:"invalid_slug" },400);
      fields.push("slug=?"); values.push(slug);
    }
    if (body.status != null) {
      if (!["active","suspended"].includes(body.status)) return json({ error:"invalid_status" },400);
      fields.push("status=?"); values.push(body.status);
    }
    if (!fields.length) return json({ project });
    values.push(new Date().toISOString(),projectId);
    await env.DB.prepare(
      `UPDATE projects SET ${fields.join(",")},updated_at=? WHERE id=?`
    ).bind(...values).run();
    return json({ project: { ...project, ...body } });
  }

  const automationResponse = await handleAutomationAdmin({
    request,
    env,
    project,
    resource,
    adminUserId: auth.user.id
  });
  if (automationResponse) return automationResponse;

  if (resource === "summary" && request.method === "GET") {
    return json(await summary(env,projectId,thresholds));
  }
  if (resource === "facets" && request.method === "GET") {
    return json(await facets(env,projectId));
  }
  if (resource === "users" && request.method === "GET") {
    return json(await listUsersPage(env,projectId,{
      search:url.searchParams.get("search")||"",
      status:url.searchParams.get("status")||"",
      country:url.searchParams.get("country")||"",
      state:url.searchParams.get("state")||"",
      city:url.searchParams.get("city")||"",
      limit:url.searchParams.get("limit")||100,
      cursor:url.searchParams.get("cursor")||"",
      thresholds
    }));
  }
  if (resource === "clusters" && request.method === "GET") {
    return json({ clusters: await clusterUsers(env,projectId,{
      gridDegrees:url.searchParams.get("gridDegrees")||8,
      status:url.searchParams.get("status")||"",
      country:url.searchParams.get("country")||"",
      state:url.searchParams.get("state")||"",
      city:url.searchParams.get("city")||"",
      thresholds
    })});
  }
  if (resource === "operations/metrics" && request.method === "GET") {
    return json(await projectMetrics(env,projectId,url.searchParams.get("hours")||24));
  }
  if (resource === "history" && request.method === "GET") {
    const userId=String(url.searchParams.get("userId")||"").trim();
    if(!userId) return json({error:"invalid_userId"},400);
    const window=parseWindow(url.searchParams);
    const page=await movementHistory(env,projectId,{
      userId,...window,limit:url.searchParams.get("limit")||250,
      cursor:url.searchParams.get("cursor")||""
    });
    return json({ projectId,userId,window,...page });
  }
  if (resource === "heatmap" && request.method === "GET") {
    const window=parseWindow(url.searchParams);
    const gridDegrees=normalizeGridDegrees(url.searchParams.get("gridDegrees")||2,2);
    const userId=String(url.searchParams.get("userId")||"").trim()||null;
    const cells=await heatmapHistory(env,projectId,{...window,gridDegrees,userId});
    return json({projectId,window,gridDegrees,userId,cells});
  }
  if (resource === "keys" && request.method === "GET") {
    return json(await listKeys(env,projectId));
  }
  if (resource === "keys" && request.method === "POST") {
    return createKey(request,env,project,auth.user.id);
  }
  const keyMatch=resource.match(/^keys\/([^/]+)\/(revoke|rotate)$/);
  if(keyMatch && request.method==="POST"){
    const keyId=keyMatch[1],action=keyMatch[2],now=new Date().toISOString();
    if(action==="revoke"){
      await env.DB.prepare("UPDATE api_keys SET revoked_at=?,updated_at=? WHERE id=? AND project_id=?")
        .bind(now,now,keyId,projectId).run();
      return json({ok:true});
    }
    const existing=await env.DB.prepare(
      "SELECT name,scopes_json,allowed_origins_json,allowed_packages_json,expires_at FROM api_keys WHERE id=? AND project_id=?"
    ).bind(keyId,projectId).first();
    if(!existing) return json({error:"api_key_not_found"},404);
    await env.DB.prepare("UPDATE api_keys SET revoked_at=?,updated_at=? WHERE id=?").bind(now,now,keyId).run();
    const secret=randomSecret("rgl_live_",32),id=crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO api_keys(
        id,project_id,name,prefix,secret_hash,scopes_json,allowed_origins_json,
        allowed_packages_json,expires_at,created_by_admin_user_id,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(id,projectId,existing.name,secret.slice(0,16),sha256Secret(secret),
      existing.scopes_json,existing.allowed_origins_json,existing.allowed_packages_json,
      existing.expires_at,auth.user.id,now,now).run();
    return json({key:{id,name:existing.name,prefix:secret.slice(0,16),scopes:JSON.parse(existing.scopes_json)},secret},201);
  }

  return json({ error: "not_found" }, 404);
}
