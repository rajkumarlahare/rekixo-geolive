import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.mjs";
import { MemoryGeoLiveStore } from "../src/store-memory.mjs";
import { createGeoLiveServer } from "../src/server.mjs";
import { createRealtimeGateway } from "../src/realtime-gateway.mjs";

function deniedCommercialStore() {
  return {
    async assertProjectFeature(
      projectId,
      feature
    ) {
      assert.equal(projectId, "demo-project");
      assert.equal(feature, "realtime");
      throw Object.assign(
        new Error("feature_not_entitled"),
        {
          code: "feature_not_entitled",
          status: 402
        }
      );
    }
  };
}

function waitForMessage(
  socket,
  predicate,
  timeoutMs = 5000
) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            "WebSocket message timeout"
          )
        ),
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
      socket.removeEventListener(
        "message",
        onMessage
      );
      resolve(value);
    };

    socket.addEventListener(
      "message",
      onMessage
    );
  });
}

function testConfig() {
  return loadConfig({
    NODE_ENV: "test",
    GEOLIVE_PERSISTENCE: "memory",
    GEOLIVE_DEV_PROJECT_ID:
      "demo-project",
    GEOLIVE_DEV_INGEST_KEY:
      "rgl_dev_ingest_commercial_ci",
    GEOLIVE_DEV_ADMIN_KEY:
      "rgl_dev_read_commercial_ci"
  });
}

test("P3 realtime entitlement blocks public SSE readers", async () => {
  const config = testConfig();
  const store = new MemoryGeoLiveStore();
  const commercialStore =
    deniedCommercialStore();
  const server = createGeoLiveServer({
    config,
    store,
    commercialStore
  });

  await new Promise((resolve) => {
    server.listen(
      0,
      "127.0.0.1",
      resolve
    );
  });

  try {
    const address = server.address();
    const response = await fetch(
      `http://127.0.0.1:${address.port}/v1/events`,
      {
        headers: {
          authorization:
            "Bearer rgl_dev_read_commercial_ci"
        }
      }
    );

    assert.equal(response.status, 402);
    assert.deepEqual(
      await response.json(),
      {
        error: "feature_not_entitled"
      }
    );
  } finally {
    await new Promise((resolve) =>
      server.close(resolve)
    );
  }
});

test("P3 realtime entitlement blocks public WebSocket readers", {
  skip:
    typeof globalThis.WebSocket ===
    "function"
      ? false
      : "Node WebSocket client unavailable"
}, async () => {
  const config = testConfig();
  const store = new MemoryGeoLiveStore();
  const commercialStore =
    deniedCommercialStore();

  const gateway = createRealtimeGateway({
    config,
    commercialStore
  });
  const server = createGeoLiveServer({
    config,
    store,
    commercialStore,
    realtimeGateway: gateway
  });
  gateway.attach(server);
  gateway.start();

  await new Promise((resolve) => {
    server.listen(
      0,
      "127.0.0.1",
      resolve
    );
  });

  const address = server.address();
  const socket = new WebSocket(
    `ws://127.0.0.1:${address.port}/v1/realtime`
  );

  try {
    await new Promise(
      (resolve, reject) => {
        socket.addEventListener(
          "open",
          resolve,
          { once: true }
        );
        socket.addEventListener(
          "error",
          reject,
          { once: true }
        );
      }
    );

    const errorPromise =
      waitForMessage(
        socket,
        (message) =>
          message.type === "error"
      );

    socket.send(
      JSON.stringify({
        type: "authenticate",
        token:
          "rgl_dev_read_commercial_ci"
      })
    );

    const message =
      await errorPromise;
    assert.equal(
      message.error,
      "feature_not_entitled"
    );
  } finally {
    try {
      socket.close();
    } catch {}
    gateway.close();
    await new Promise((resolve) =>
      server.close(resolve)
    );
  }
});
