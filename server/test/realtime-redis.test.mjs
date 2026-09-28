import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { RedisFanout } from "../src/redis-fanout.mjs";

const redisUrl = process.env.REDIS_URL || "";

async function waitFor(predicate, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for Redis fanout readiness");
}

test("P1E Redis fanout delivers an event across instances", {
  skip: redisUrl ? false : "REDIS_URL not configured"
}, async () => {
  const channel = `rekixo:geolive:test:${crypto.randomUUID()}`;
  const a = new RedisFanout({
    redisUrl,
    channel,
    instanceId: "instance-a"
  });
  const b = new RedisFanout({
    redisUrl,
    channel,
    instanceId: "instance-b"
  });

  let received = null;
  a.start(() => {});
  b.start((event) => {
    received = event;
  });

  try {
    await waitFor(() => a.ready && b.ready);

    const event = {
      sequence: "42",
      eventId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      type: "location",
      userId: "redis-user",
      payload: {
        userId: "redis-user",
        latitude: 21.25,
        longitude: 81.63
      },
      createdAt: new Date().toISOString()
    };

    assert.equal(a.publish(event), true);

    await waitFor(() => received?.sequence === "42");
    assert.equal(received.userId, "redis-user");
    assert.equal(received.projectId, event.projectId);
  } finally {
    a.close();
    b.close();
  }
});
