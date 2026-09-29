import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.mjs";
import { MemoryGeoLiveStore } from "../src/store-memory.mjs";
import { createGeoLiveServer } from "../src/server.mjs";
import {
  adminWebSocketOriginAllowed,
  createRealtimeGateway
} from "../src/realtime-gateway.mjs";

function waitForMessage(socket, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("WebSocket message timeout")),
      timeoutMs
    );

    const onMessage = (event) => {
      let value;
      try {
        value = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!predicate(value)) return;
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      resolve(value);
    };

    socket.addEventListener("message", onMessage);
  });
}

test("admin WebSocket origin policy rejects cross-site production upgrades", () => {
  assert.equal(
    adminWebSocketOriginAllowed(
      {
        headers: {
          origin: "https://geolive.example.com",
          host: "geolive.example.com"
        }
      },
      { isProduction: true }
    ),
    true
  );
  assert.equal(
    adminWebSocketOriginAllowed(
      {
        headers: {
          origin: "https://evil.example.com",
          host: "geolive.example.com"
        }
      },
      { isProduction: true }
    ),
    false
  );
  assert.equal(
    adminWebSocketOriginAllowed(
      {
        headers: {
          host: "geolive.example.com"
        }
      },
      { isProduction: true }
    ),
    false
  );
  assert.equal(
    adminWebSocketOriginAllowed(
      {
        headers: {
          host: "127.0.0.1:8787"
        }
      },
      { isProduction: false }
    ),
    true
  );
});

test("P1E integration WebSocket authenticates and receives live location", {
  skip:
    typeof globalThis.WebSocket === "function"
      ? false
      : "Node WebSocket client unavailable"
}, async () => {
  const config = loadConfig({
    NODE_ENV: "test",
    GEOLIVE_PERSISTENCE: "memory",
    GEOLIVE_DEV_PROJECT_ID: "demo-project",
    GEOLIVE_DEV_INGEST_KEY: "rgl_dev_ingest_ci",
    GEOLIVE_DEV_ADMIN_KEY: "rgl_dev_read_ci"
  });

  const store = new MemoryGeoLiveStore();
  const gateway = createRealtimeGateway({
    config,
    keyStore: null,
    adminStore: null,
    opsStore: null,
    realtimeStore: null
  });
  const server = createGeoLiveServer({
    config,
    store,
    realtimeGateway: gateway
  });
  gateway.attach(server);
  gateway.start();

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  const socket = new WebSocket(
    `ws://127.0.0.1:${address.port}/v1/realtime`
  );

  try {
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });

    const readyPromise = waitForMessage(
      socket,
      (message) => message.type === "ready"
    );

    socket.send(JSON.stringify({
      type: "authenticate",
      token: "rgl_dev_read_ci",
      resumeAfter: "0"
    }));

    const ready = await readyPromise;
    assert.equal(ready.projectId, "demo-project");

    const livePromise = waitForMessage(
      socket,
      (message) =>
        message.type === "location" &&
        message.userId === "user-ci"
    );

    const response = await fetch(`${base}/v1/locations`, {
      method: "POST",
      headers: {
        authorization: "Bearer rgl_dev_ingest_ci",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        userId: "user-ci",
        latitude: 21.2514,
        longitude: 81.6296
      })
    });

    assert.equal(response.status, 202);
    const live = await livePromise;
    assert.equal(live.payload.userId, "user-ci");
    assert.ok(live.sequence);
  } finally {
    try {
      socket.close();
    } catch {}
    gateway.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
