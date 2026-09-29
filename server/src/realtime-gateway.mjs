import crypto from "node:crypto";
import {
  authenticateRequest,
  originAllowed,
  packageAllowed
} from "./auth.mjs";
import { sha256Secret } from "./passwords.mjs";
import {
  RedisFanout
} from "./redis-fanout.mjs";
import {
  upgradeWebSocket
} from "./websocket-protocol.mjs";

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

function rejectUpgrade(socket, status, reason) {
  const labels = {
    400: "Bad Request",
    401: "Unauthorized",
    402: "Payment Required",
    403: "Forbidden",
    429: "Too Many Requests",
    503: "Service Unavailable"
  };
  const label = labels[status] || "Error";
  try {
    socket.write(
      `HTTP/1.1 ${status} ${label}\r\n` +
      "Connection: close\r\n" +
      "Content-Type: application/json\r\n" +
      "Cache-Control: no-store\r\n\r\n" +
      JSON.stringify({ error: reason })
    );
  } finally {
    socket.destroy();
  }
}

function validProjectId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(String(value || ""));
}

export function adminWebSocketOriginAllowed(
  req,
  { isProduction = false } = {}
) {
  const origin =
    typeof req.headers?.origin === "string"
      ? req.headers.origin.trim()
      : "";
  if (!origin) {
    return !isProduction;
  }

  const host =
    String(req.headers?.host || "")
      .trim()
      .toLowerCase();
  if (!host) return false;

  try {
    const parsed = new URL(origin);
    return (
      ["http:", "https:"].includes(
        parsed.protocol
      ) &&
      parsed.host.toLowerCase() === host
    );
  } catch {
    return false;
  }
}

function sequenceGreater(a, b) {
  try {
    return BigInt(String(a || "0")) > BigInt(String(b || "0"));
  } catch {
    return false;
  }
}

export function createRealtimeGateway({
  config,
  keyStore = null,
  adminStore = null,
  opsStore = null,
  realtimeStore = null,
  commercialStore = null
}) {
  const instanceId = crypto.randomUUID();
  const rooms = new Map();
  const peers = new Set();
  let server = null;
  let upgradeHandler = null;
  let closed = false;
  let localSequence = BigInt(Date.now()) * 1000n;

  const fanout = new RedisFanout({
    redisUrl: config.realtime?.redisUrl || "",
    channel:
      config.realtime?.redisChannel ||
      "rekixo:geolive:events",
    instanceId
  });

  function room(projectId) {
    let set = rooms.get(projectId);
    if (!set) {
      set = new Set();
      rooms.set(projectId, set);
    }
    return set;
  }

  function leave(peer) {
    peers.delete(peer);
    if (!peer.projectId) return;
    const set = rooms.get(peer.projectId);
    if (!set) return;
    set.delete(peer);
    if (set.size === 0) {
      rooms.delete(peer.projectId);
    }
  }

  function sendEvent(peer, event) {
    if (peer.closed) return;
    peer.sendJson(
      {
        type: event.type,
        sequence: event.sequence,
        eventId: event.eventId,
        projectId: event.projectId,
        userId: event.userId,
        payload: event.payload,
        createdAt: event.createdAt
      },
      {
        coalesceKey:
          event.type === "location" && event.userId
            ? `location:${event.userId}`
            : ""
      }
    );
  }

  function broadcastLocal(event) {
    const set = rooms.get(event.projectId);
    if (!set) return;

    for (const peer of set) {
      if (peer._replaying) {
        if (peer._heldEvents.length >= 2000) {
          peer.sendJson({
            type: "resync_required",
            reason: "replay_backlog",
            latestSequence: event.sequence
          });
          peer._heldEvents.length = 0;
          peer._replaying = false;
        } else {
          peer._heldEvents.push(event);
        }
        continue;
      }
      sendEvent(peer, event);
    }
  }

  async function publish(event) {
    if (!event?.projectId) return;

    const normalized = {
      ...event,
      sequence:
        event.sequence ||
        String(++localSequence),
      eventId:
        event.eventId ||
        crypto.randomUUID(),
      createdAt:
        event.createdAt ||
        new Date().toISOString()
    };

    broadcastLocal(normalized);
    fanout.publish(normalized);
    return normalized;
  }

  async function replayAndReady(
    peer,
    projectId,
    afterSequence
  ) {
    peer._replaying = true;
    peer._heldEvents = [];

    let latestSequence = "0";
    let lastSent = String(afterSequence || "0");

    try {
      if (realtimeStore) {
        latestSequence =
          await realtimeStore.latestSequence(projectId);

        if (afterSequence !== undefined && afterSequence !== null) {
          const replay = await realtimeStore.replay(
            projectId,
            afterSequence,
            {
              limit:
                config.realtime?.maxReplayEvents ||
                1000
            }
          );

          if (replay.resyncRequired || replay.hasMore) {
            peer.sendJson({
              type: "resync_required",
              reason: replay.resyncRequired
                ? "replay_anchor_unavailable"
                : "replay_limit",
              latestSequence:
                replay.latestSequence ||
                await realtimeStore.latestSequence(projectId)
            });
            peer._heldEvents.length = 0;
            peer._replaying = false;
            return;
          }

          for (const event of replay.events) {
            sendEvent(peer, event);
            lastSent = event.sequence;
          }
          latestSequence = replay.latestSequence;
        }
      }

      const held = peer._heldEvents
        .filter((event) =>
          sequenceGreater(event.sequence, lastSent)
        )
        .sort((a, b) => {
          const aa = BigInt(a.sequence);
          const bb = BigInt(b.sequence);
          return aa < bb ? -1 : aa > bb ? 1 : 0;
        });

      for (const event of held) {
        sendEvent(peer, event);
        lastSent = event.sequence;
        latestSequence = event.sequence;
      }

      peer.sendJson({
        type: "ready",
        projectId,
        latestSequence
      });
    } finally {
      peer._heldEvents.length = 0;
      peer._replaying = false;
    }
  }

  async function enforceRealtimeRead(projectId) {
    if (!opsStore) return { ok: true };
    const limits =
      await opsStore.getProjectLimits(projectId);
    const rate =
      await opsStore.consumeProjectRateLimit(
        projectId,
        "read",
        limits.readRequestsPerMinute
      );
    if (!rate.allowed) {
      await opsStore.recordSecurityEvent({
        projectId,
        eventType: "realtime.connection_rate_limited",
        severity: "warning",
        metadata: {}
      });
      return {
        ok: false,
        status: 429,
        error: "rate_limited"
      };
    }
    await opsStore.recordRead(projectId);
    return { ok: true };
  }

  async function authorizeAdmin(req, url) {
    if (!adminStore) {
      return {
        ok: false,
        status: 503,
        error: "admin_requires_postgres"
      };
    }

    if (
      !adminWebSocketOriginAllowed(
        req,
        config
      )
    ) {
      return {
        ok: false,
        status: 403,
        error: "origin_not_allowed"
      };
    }

    const projectId = url.searchParams.get("projectId");
    if (!validProjectId(projectId)) {
      return {
        ok: false,
        status: 400,
        error: "invalid_project_id"
      };
    }

    const cookies = parseCookies(req.headers.cookie);
    const token = cookies.geolive_admin_session;
    if (!token) {
      return {
        ok: false,
        status: 401,
        error: "admin_auth_required"
      };
    }

    const session = await adminStore.getSession(
      sha256Secret(token)
    );
    if (!session) {
      return {
        ok: false,
        status: 401,
        error: "admin_auth_required"
      };
    }

    try {
      await adminStore.authorizeProject(
        session.user.id,
        projectId
      );
    } catch (error) {
      return {
        ok: false,
        status: error.status || 403,
        error: error.code || "project_forbidden"
      };
    }

    const rate = await enforceRealtimeRead(projectId);
    if (!rate.ok) return rate;

    return {
      ok: true,
      projectId,
      after: url.searchParams.has("after")
        ? url.searchParams.get("after")
        : undefined
    };
  }

  async function handleAdminUpgrade(
    req,
    socket,
    url
  ) {
    const auth = await authorizeAdmin(req, url);
    if (!auth.ok) {
      rejectUpgrade(
        socket,
        auth.status,
        auth.error
      );
      return;
    }

    const peer = upgradeWebSocket(req, socket);
    if (!peer) return;

    peer.projectId = auth.projectId;
    peer.kind = "admin";
    peer._replaying = true;
    peer._heldEvents = [];
    peers.add(peer);
    room(auth.projectId).add(peer);
    peer.onClose = () => leave(peer);

    peer.onText = (text) => {
      if (text.length > 1024) {
        peer.close(1009, "message_too_large");
        return;
      }
      try {
        const message = JSON.parse(text);
        if (message.type === "ping") {
          peer.sendJson({
            type: "pong",
            at: new Date().toISOString()
          });
        }
      } catch {
        peer.close(1003, "invalid_json");
      }
    };

    await replayAndReady(
      peer,
      auth.projectId,
      auth.after
    );
  }

  async function handleIntegrationUpgrade(
    req,
    socket
  ) {
    const peer = upgradeWebSocket(req, socket);
    if (!peer) return;

    peer.kind = "integration";
    peer._replaying = false;
    peer._heldEvents = [];
    peers.add(peer);
    peer.onClose = () => leave(peer);

    const origin =
      typeof req.headers.origin === "string"
        ? req.headers.origin
        : "";

    const authTimer = setTimeout(() => {
      if (!peer.projectId) {
        peer.close(1008, "authentication_timeout");
      }
    }, config.realtime?.authTimeoutMs || 5000);
    authTimer.unref?.();

    peer.onClose = () => {
      clearTimeout(authTimer);
      leave(peer);
    };

    peer.onText = async (text) => {
      if (peer.projectId) {
        try {
          const message = JSON.parse(text);
          if (message.type === "ping") {
            peer.sendJson({
              type: "pong",
              at: new Date().toISOString()
            });
          }
        } catch {
          peer.close(1003, "invalid_json");
        }
        return;
      }

      let message;
      try {
        message = JSON.parse(text);
      } catch {
        peer.close(1003, "invalid_json");
        return;
      }

      if (
        message?.type !== "authenticate" ||
        typeof message.token !== "string" ||
        message.token.length > 512
      ) {
        peer.close(1008, "authentication_required");
        return;
      }

      const synthetic = {
        headers: {
          authorization: `Bearer ${message.token}`,
          "x-geolive-package":
            typeof message.packageId === "string"
              ? message.packageId
              : ""
        }
      };

      const auth = await authenticateRequest(
        synthetic,
        {
          keyStore,
          environmentKeys: config.keys
        },
        "events:read"
      );

      if (!auth.ok) {
        peer.sendJson({
          type: "error",
          error: auth.error
        });
        peer.close(1008, "authentication_failed");
        return;
      }

      if (
        origin &&
        !originAllowed(
          origin,
          auth.key,
          config.allowedOrigins
        )
      ) {
        peer.sendJson({
          type: "error",
          error: "origin_not_allowed"
        });
        peer.close(1008, "origin_not_allowed");
        return;
      }

      if (
        !packageAllowed(
          synthetic.headers["x-geolive-package"],
          auth.key
        )
      ) {
        peer.sendJson({
          type: "error",
          error: "package_not_allowed"
        });
        peer.close(1008, "package_not_allowed");
        return;
      }

      if (commercialStore) {
        try {
          await commercialStore.assertProjectFeature(
            auth.key.projectId,
            "realtime"
          );
        } catch (error) {
          peer.sendJson({
            type: "error",
            error:
              error.code ||
              "feature_not_entitled"
          });
          peer.close(
            1008,
            error.code ||
              "feature_not_entitled"
          );
          return;
        }
      }

      const rate = await enforceRealtimeRead(
        auth.key.projectId
      );
      if (!rate.ok) {
        peer.sendJson({
          type: "error",
          error: rate.error
        });
        peer.close(1013, "rate_limited");
        return;
      }

      clearTimeout(authTimer);
      peer.projectId = auth.key.projectId;
      peer.keyId = auth.key.id;
      peer._replaying = true;
      room(peer.projectId).add(peer);

      const after =
        message.resumeAfter === undefined ||
        message.resumeAfter === null ||
        message.resumeAfter === ""
          ? undefined
          : String(message.resumeAfter);

      await replayAndReady(
        peer,
        peer.projectId,
        after
      );
    };
  }

  async function handleUpgrade(
    req,
    socket,
    head
  ) {
    if (closed) {
      rejectUpgrade(
        socket,
        503,
        "realtime_unavailable"
      );
      return;
    }

    const url = new URL(
      req.url || "/",
      "http://localhost"
    );

    if (head?.length) {
      socket.unshift(head);
    }

    try {
      if (
        url.pathname ===
        "/v1/admin/realtime"
      ) {
        await handleAdminUpgrade(
          req,
          socket,
          url
        );
        return;
      }

      if (url.pathname === "/v1/realtime") {
        await handleIntegrationUpgrade(
          req,
          socket
        );
        return;
      }

      rejectUpgrade(
        socket,
        404,
        "not_found"
      );
    } catch {
      rejectUpgrade(
        socket,
        500,
        "realtime_error"
      );
    }
  }

  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const peer of peers) {
      if (
        now - peer.lastPongAt >
        (config.realtime?.heartbeatTimeoutMs || 70000)
      ) {
        peer.close(1001, "heartbeat_timeout");
        continue;
      }
      peer.ping();
    }
  }, config.realtime?.heartbeatIntervalMs || 25000);
  heartbeat.unref?.();

  return {
    instanceId,

    attach(httpServer) {
      server = httpServer;
      upgradeHandler = (req, socket, head) => {
        void handleUpgrade(req, socket, head);
      };
      server.on("upgrade", upgradeHandler);
    },

    start() {
      fanout.start((event) => {
        broadcastLocal(event);
      });
    },

    async publish(event) {
      await publish(event);
    },

    ready() {
      if (
        config.realtime?.redisRequired &&
        !fanout.ready
      ) {
        return false;
      }
      return true;
    },

    status() {
      return {
        connections: peers.size,
        rooms: rooms.size,
        redisEnabled: fanout.enabled,
        redisReady: fanout.ready
      };
    },

    close() {
      closed = true;
      clearInterval(heartbeat);
      fanout.close();
      for (const peer of [...peers]) {
        peer.close(1001, "server_shutdown");
      }
      rooms.clear();
      peers.clear();
      if (server && upgradeHandler) {
        server.off("upgrade", upgradeHandler);
      }
      upgradeHandler = null;
    }
  };
}
