import {
  burnPasswordCheck,
  normalizeAdminEmail,
  randomCsrfToken,
  randomSessionToken,
  sha256Secret,
  timingSafeHexEqual,
  verifyPassword
} from "./passwords.mjs";
import { AdminStoreError } from "./admin-store-postgres.mjs";

const COOKIE_NAME = "geolive_admin_session";

function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...headers
  });
  res.end(body);
}

async function readJson(req, maxBytes = 32 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new AdminStoreError("body_too_large", 400);
    }
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AdminStoreError("invalid_json", 400);
  }
}

function parseCookies(header) {
  const result = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    result[key] = decodeURIComponent(value);
  }
  return result;
}

function sessionToken(req) {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies[COOKIE_NAME]) return cookies[COOKIE_NAME];

  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer gla_")) {
    return auth.slice(7).trim();
  }
  return "";
}

function sessionCookie(token, config) {
  const maxAge = Math.max(60, Math.floor(config.admin.sessionHours * 3600));
  return [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    config.isProduction ? "Secure" : "",
    `Max-Age=${maxAge}`
  ].filter(Boolean).join("; ");
}

function clearCookie(config) {
  return [
    `${COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    config.isProduction ? "Secure" : "",
    "Max-Age=0"
  ].filter(Boolean).join("; ");
}

async function requireSession(req, adminStore) {
  const token = sessionToken(req);
  if (!token) throw new AdminStoreError("admin_auth_required", 401);
  const session = await adminStore.getSession(sha256Secret(token));
  if (!session) throw new AdminStoreError("admin_auth_required", 401);
  return session;
}

function requireCsrf(req, session) {
  const value = req.headers["x-csrf-token"];
  if (typeof value !== "string" || !timingSafeHexEqual(sha256Secret(value), session.csrfHash)) {
    throw new AdminStoreError("csrf_invalid", 403);
  }
}

function validateProjectInput(body, { partial = false } = {}) {
  const out = {};

  if (!partial || body.name !== undefined) {
    const name = String(body.name || "").trim();
    if (name.length < 2 || name.length > 120) {
      throw new AdminStoreError("invalid_project_name", 400);
    }
    out.name = name;
  }

  if (!partial || body.slug !== undefined) {
    const slug = String(body.slug || "").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) {
      throw new AdminStoreError("invalid_project_slug", 400);
    }
    out.slug = slug;
  }

  if (body.status !== undefined) {
    const status = String(body.status);
    if (!["active", "suspended"].includes(status)) {
      throw new AdminStoreError("invalid_project_status", 400);
    }
    out.status = status;
  }

  return out;
}

async function sessionPayload(adminStore, session) {
  const [accounts, projects] = await Promise.all([
    adminStore.listAccounts(session.user.id),
    adminStore.listProjects(session.user.id)
  ]);
  return {
    user: session.user,
    accounts,
    projects
  };
}

export async function handleAdminApi({
  req,
  res,
  url,
  config,
  adminStore,
  geoStore
}) {
  if (!url.pathname.startsWith("/v1/admin/")) return false;

  if (!adminStore) {
    sendJson(res, 503, { error: "admin_requires_postgres" });
    return true;
  }

  try {
    if (req.method === "POST" && url.pathname === "/v1/admin/login") {
      const body = await readJson(req);
      let email;
      try {
        email = normalizeAdminEmail(body.email);
      } catch {
        await burnPasswordCheck(body.password);
        throw new AdminStoreError("invalid_credentials", 401);
      }

      const user = await adminStore.findUserForLogin(email);
      if (!user) {
        await burnPasswordCheck(body.password);
        throw new AdminStoreError("invalid_credentials", 401);
      }

      if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
        await burnPasswordCheck(body.password);
        throw new AdminStoreError("login_temporarily_locked", 429);
      }

      const valid = user.status === "active"
        ? await verifyPassword(body.password, user.password_hash)
        : false;

      if (!valid) {
        await adminStore.recordLoginFailure(user.id, {
          maxFailures: config.admin.maxFailedLogins,
          lockMinutes: config.admin.lockMinutes
        });
        throw new AdminStoreError("invalid_credentials", 401);
      }

      const rawSession = randomSessionToken();
      const rawCsrf = randomCsrfToken();
      const expiresAt = new Date(Date.now() + config.admin.sessionHours * 3600 * 1000);

      const created = await adminStore.createSession({
        userId: user.id,
        tokenHash: sha256Secret(rawSession),
        csrfHash: sha256Secret(rawCsrf),
        expiresAt
      });

      const session = {
        sessionId: created.id,
        csrfHash: sha256Secret(rawCsrf),
        expiresAt: created.expiresAt,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name
        }
      };
      const payload = await sessionPayload(adminStore, session);

      sendJson(res, 200, {
        ...payload,
        csrfToken: rawCsrf,
        expiresAt: expiresAt.toISOString()
      }, {
        "set-cookie": sessionCookie(rawSession, config)
      });
      return true;
    }

    const session = await requireSession(req, adminStore);

    if (req.method === "GET" && url.pathname === "/v1/admin/me") {
      const rawCsrf = randomCsrfToken();
      await adminStore.rotateCsrf(session.sessionId, sha256Secret(rawCsrf));
      const payload = await sessionPayload(adminStore, session);
      sendJson(res, 200, {
        ...payload,
        csrfToken: rawCsrf,
        expiresAt: session.expiresAt instanceof Date
          ? session.expiresAt.toISOString()
          : session.expiresAt
      });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/v1/admin/logout") {
      requireCsrf(req, session);
      await adminStore.revokeSession(session.sessionId, session.user.id);
      sendJson(res, 200, { ok: true }, {
        "set-cookie": clearCookie(config)
      });
      return true;
    }

    if (req.method === "GET" && url.pathname === "/v1/admin/projects") {
      const projects = await adminStore.listProjects(session.user.id);
      sendJson(res, 200, { projects });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/v1/admin/projects") {
      requireCsrf(req, session);
      const body = await readJson(req);
      const accountId = String(body.accountId || "");
      if (!accountId) throw new AdminStoreError("account_required", 400);
      const input = validateProjectInput(body);
      const project = await adminStore.createProject(session.user.id, {
        accountId,
        ...input
      });
      sendJson(res, 201, { project });
      return true;
    }

    const projectMatch = url.pathname.match(
      /^\/v1\/admin\/projects\/([0-9a-f-]{36})(?:\/(users|summary))?$/
    );

    if (projectMatch) {
      const projectId = projectMatch[1];
      const resource = projectMatch[2] || "";

      if (req.method === "GET" && resource === "users") {
        await adminStore.authorizeProject(session.user.id, projectId);
        const users = await geoStore.listUsers(projectId, {
          search: url.searchParams.get("search") || "",
          status: url.searchParams.get("status") || "",
          country: url.searchParams.get("country") || "",
          state: url.searchParams.get("state") || "",
          city: url.searchParams.get("city") || "",
          limit: url.searchParams.get("limit") || 500,
          thresholds: config.thresholds
        });
        sendJson(res, 200, { projectId, users });
        return true;
      }

      if (req.method === "GET" && resource === "summary") {
        await adminStore.authorizeProject(session.user.id, projectId);
        const summary = await geoStore.summary(projectId, config.thresholds);
        sendJson(res, 200, { projectId, ...summary });
        return true;
      }

      if (resource === "" && req.method === "PATCH") {
        requireCsrf(req, session);
        const body = await readJson(req);
        const patch = validateProjectInput(body, { partial: true });
        if (!Object.keys(patch).length) {
          throw new AdminStoreError("empty_project_update", 400);
        }
        const project = await adminStore.updateProject(
          session.user.id,
          projectId,
          patch
        );
        sendJson(res, 200, { project });
        return true;
      }

      if (resource === "" && req.method === "DELETE") {
        requireCsrf(req, session);
        await adminStore.deleteProject(session.user.id, projectId);
        sendJson(res, 200, { ok: true });
        return true;
      }
    }

    sendJson(res, 404, { error: "not_found" });
    return true;
  } catch (error) {
    if (error instanceof AdminStoreError || (error?.status && error?.code)) {
      sendJson(res, error.status || 400, { error: error.code });
      return true;
    }
    console.error("GeoLive admin API failed", error);
    sendJson(res, 500, { error: "internal_error" });
    return true;
  }
}
