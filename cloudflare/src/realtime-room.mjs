import { DurableObject } from "cloudflare:workers";
import { authenticateIntegration } from "./auth.mjs";

function sendJson(ws, value) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(value));
  }
}

export class ProjectRealtimeRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong")
    );
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/broadcast" && request.method === "POST") {
      const payload = await request.json();
      for (const ws of this.ctx.getWebSockets()) {
        const attachment = ws.deserializeAttachment() || {};
        if (attachment.authenticated === true) sendJson(ws, payload);
      }
      return Response.json({ delivered: true });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 400 });
    }

    const projectId = url.searchParams.get("projectId") || "";
    const mode = url.searchParams.get("mode") || "integration";
    const trustedAdmin =
      mode === "admin" &&
      request.headers.get("x-geolive-internal-admin") === "1";

    if (!projectId) {
      return Response.json({ error: "project_required" }, { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);

    const state = {
      projectId,
      mode,
      authenticated: trustedAdmin,
      joinedAt: Date.now()
    };
    server.serializeAttachment(state);

    if (trustedAdmin) {
      const latest = await this.env.DB.prepare(
        "SELECT COALESCE(MAX(id),0) AS sequence FROM realtime_events WHERE project_id=?"
      ).bind(projectId).first();
      sendJson(server, {
        type: "ready",
        projectId,
        latestSequence: String(latest?.sequence || 0)
      });
    } else {
      sendJson(server, { type: "authenticate", projectId });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    const attachment = ws.deserializeAttachment() || {};
    if (attachment.authenticated === true) {
      if (String(message) === "ping") sendJson(ws, { type: "pong" });
      return;
    }

    let payload;
    try {
      payload = JSON.parse(String(message));
    } catch {
      ws.close(1008, "invalid_json");
      return;
    }

    if (payload?.type !== "authenticate" || !payload?.token) {
      ws.close(1008, "authentication_required");
      return;
    }

    const request = new Request("https://internal/v1/realtime", {
      headers: {
        authorization: `Bearer ${payload.token}`,
        ...(payload.packageId
          ? { "x-geolive-package": String(payload.packageId) }
          : {})
      }
    });
    const auth = await authenticateIntegration(
      this.env,
      request,
      "events:read"
    );
    if (!auth.ok || auth.key.projectId !== attachment.projectId) {
      ws.close(1008, auth.error || "project_denied");
      return;
    }

    const next = { ...attachment, authenticated: true, keyId: auth.key.id };
    ws.serializeAttachment(next);
    const latest = await this.env.DB.prepare(
      "SELECT COALESCE(MAX(id),0) AS sequence FROM realtime_events WHERE project_id=?"
    ).bind(attachment.projectId).first();

    const resumeAfter = Number(payload.resumeAfter || 0);
    if (Number.isFinite(resumeAfter) && resumeAfter > 0) {
      const replay = await this.env.DB.prepare(
        `SELECT id, event_type, external_user_id, payload_json, created_at
         FROM realtime_events
         WHERE project_id=? AND id>?
         ORDER BY id ASC
         LIMIT 1000`
      ).bind(attachment.projectId, resumeAfter).all();
      for (const row of replay.results || []) {
        sendJson(ws, {
          type: row.event_type,
          sequence: String(row.id),
          projectId: attachment.projectId,
          userId: row.external_user_id,
          payload: JSON.parse(row.payload_json || "{}"),
          createdAt: row.created_at
        });
      }
    }

    sendJson(ws, {
      type: "ready",
      projectId: attachment.projectId,
      latestSequence: String(latest?.sequence || 0)
    });
  }

  async webSocketClose(ws, code, reason) {
    try { ws.close(code, reason); } catch {}
  }
}
