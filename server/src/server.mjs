import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.mjs";
import { authenticate, originAllowed } from "./auth.mjs";
import { MemoryGeoLiveStore } from "./store-memory.mjs";
import { createConfiguredStore } from "./store-factory.mjs";
import { PostgresAdminStore } from "./admin-store-postgres.mjs";
import { handleAdminApi } from "./admin-api.mjs";
import { InputError, validateLocation } from "./validation.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashboardDir = path.resolve(__dirname, "../../dashboard");

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "permissions-policy": "geolocation=(), camera=(), microphone=()"
};

function json(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers
  });
  res.end(body);
}

async function readJson(req, maxBytes = 32 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new InputError("body_too_large");
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new InputError("invalid_json");
  }
}

function corsHeaders(origin, config, key) {
  if (!origin || !originAllowed(origin, key, config.allowedOrigins)) return {};
  return {
    "access-control-allow-origin": origin,
    vary: "Origin",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "Authorization,Content-Type,X-GeoLive-Key",
    "access-control-max-age": "600"
  };
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

async function serveDashboard(res, pathname) {
  const relative = pathname === "/" || pathname === "/dashboard" || pathname === "/dashboard/"
    ? "index.html"
    : pathname.replace(/^\/dashboard\//, "");
  if (!["index.html", "styles.css", "app.js"].includes(relative)) return false;

  try {
    const content = await fs.readFile(path.join(dashboardDir, relative));
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      "content-security-policy": "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      "content-type": MIME[path.extname(relative)] || "application/octet-stream",
      "cache-control": relative === "index.html" ? "no-store" : "public, max-age=300"
    });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

export function createGeoLiveServer({
  config = loadConfig(),
  store = new MemoryGeoLiveStore(),
  adminStore = null
} = {}) {
  const eventClients = new Map();

  function publish(projectId, payload) {
    const clients = eventClients.get(projectId);
    if (!clients) return;
    const frame = `event: location\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const response of clients) response.write(frame);
  }

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://localhost");
      const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";

      if (req.method === "OPTIONS") {
        if (origin && !config.allowedOrigins.includes(origin)) {
          return json(res, 403, { error: "origin_not_allowed" });
        }
        res.writeHead(204, {
          ...SECURITY_HEADERS,
          ...corsHeaders(origin, config)
        });
        return res.end();
      }

      if (await handleAdminApi({
        req,
        res,
        url,
        config,
        adminStore,
        geoStore: store
      })) {
        return;
      }

      if (req.method === "GET" && (url.pathname === "/" || url.pathname.startsWith("/dashboard"))) {
        if (await serveDashboard(res, url.pathname)) return;
      }

      if (req.method === "GET" && url.pathname === "/health") {
        return json(res, 200, {
          ok: true,
          service: "rekixo-geolive",
          version: "0.3.0"
        });
      }

      if (req.method === "GET" && url.pathname === "/ready") {
        const persistenceReady = typeof store.ready === "function"
          ? await store.ready()
          : true;
        const adminReady = adminStore
          ? await adminStore.ready()
          : !config.isProduction;
        const ready = config.keys.length > 0
          && persistenceReady
          && adminReady
          && (!config.isProduction || config.persistence === "postgres");

        return json(res, ready ? 200 : 503, {
          ready,
          credentialCount: config.keys.length,
          persistence: config.persistence,
          persistenceReady,
          adminReady
        });
      }

      if (req.method === "POST" && url.pathname === "/v1/locations") {
        const auth = authenticate(req, config.keys, "location:write");
        if (!auth.ok) return json(res, auth.status, { error: auth.error });
        const headers = corsHeaders(origin, config, auth.key);
        if (origin && !headers["access-control-allow-origin"]) {
          return json(res, 403, { error: "origin_not_allowed" });
        }

        const input = validateLocation(await readJson(req));
        const receivedAt = new Date().toISOString();
        const record = await store.upsertLocation(auth.key.projectId, {
          ...input,
          receivedAt
        });
        publish(auth.key.projectId, { type: "location", user: record });
        return json(res, 202, {
          accepted: true,
          userId: record.userId,
          receivedAt
        }, headers);
      }

      if (req.method === "GET" && url.pathname === "/v1/users") {
        const auth = authenticate(req, config.keys, "users:read");
        if (!auth.ok) return json(res, auth.status, { error: auth.error });
        const headers = corsHeaders(origin, config, auth.key);
        if (origin && !headers["access-control-allow-origin"]) {
          return json(res, 403, { error: "origin_not_allowed" });
        }

        const users = await store.listUsers(auth.key.projectId, {
          search: url.searchParams.get("search") || "",
          status: url.searchParams.get("status") || "",
          country: url.searchParams.get("country") || "",
          state: url.searchParams.get("state") || "",
          city: url.searchParams.get("city") || "",
          limit: url.searchParams.get("limit") || 500,
          thresholds: config.thresholds
        });
        return json(res, 200, {
          projectId: auth.key.projectId,
          users
        }, headers);
      }

      if (req.method === "GET" && url.pathname === "/v1/summary") {
        const auth = authenticate(req, config.keys, "summary:read");
        if (!auth.ok) return json(res, auth.status, { error: auth.error });
        const headers = corsHeaders(origin, config, auth.key);
        if (origin && !headers["access-control-allow-origin"]) {
          return json(res, 403, { error: "origin_not_allowed" });
        }

        const summary = await store.summary(auth.key.projectId, config.thresholds);
        return json(res, 200, {
          projectId: auth.key.projectId,
          ...summary
        }, headers);
      }

      if (req.method === "GET" && url.pathname === "/v1/events") {
        const auth = authenticate(req, config.keys, "events:read");
        if (!auth.ok) return json(res, auth.status, { error: auth.error });
        const headers = corsHeaders(origin, config, auth.key);
        if (origin && !headers["access-control-allow-origin"]) {
          return json(res, 403, { error: "origin_not_allowed" });
        }

        res.writeHead(200, {
          ...SECURITY_HEADERS,
          ...headers,
          "content-type": "text/event-stream",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive"
        });
        res.write(`event: ready\ndata: ${JSON.stringify({ projectId: auth.key.projectId })}\n\n`);

        let set = eventClients.get(auth.key.projectId);
        if (!set) {
          set = new Set();
          eventClients.set(auth.key.projectId, set);
        }
        set.add(res);

        const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 25000);
        req.on("close", () => {
          clearInterval(heartbeat);
          set.delete(res);
          if (set.size === 0) eventClients.delete(auth.key.projectId);
        });
        return;
      }

      return json(res, 404, { error: "not_found" });
    } catch (error) {
      if (error instanceof InputError) {
        return json(res, 400, { error: error.code });
      }
      if (error?.status && error?.code) {
        return json(res, error.status, { error: error.code });
      }
      console.error("GeoLive request failed", error);
      return json(res, 500, { error: "internal_error" });
    }
  });
}

async function start() {
  const config = loadConfig();
  const store = await createConfiguredStore(config);
  const adminStore = config.persistence === "postgres"
    ? new PostgresAdminStore({ pool: store.pool })
    : null;

  if (config.persistence === "postgres" && typeof store.assertReady === "function") {
    await store.assertReady();
    await adminStore.assertReady();
  }

  const server = createGeoLiveServer({ config, store, adminStore });
  server.listen(config.port, () => {
    console.log(
      `Rekixo GeoLive listening on http://localhost:${config.port} (${config.persistence})`
    );
  });

  async function shutdown(signal) {
    console.log(`GeoLive received ${signal}; shutting down.`);
    server.close(async () => {
      try {
        if (typeof store.close === "function") await store.close();
      } finally {
        process.exit(0);
      }
    });
    setTimeout(() => process.exit(1), 10000).unref();
  }

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start().catch((error) => {
    console.error("GeoLive failed to start", error);
    process.exit(1);
  });
}
