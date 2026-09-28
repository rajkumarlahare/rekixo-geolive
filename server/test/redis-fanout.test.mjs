import test from "node:test";
import assert from "node:assert/strict";
import {
  redisProtocol
} from "../src/redis-fanout.mjs";

test("Redis protocol encodes commands without dependencies", () => {
  const encoded = redisProtocol.command([
    "PUBLISH",
    "geo",
    "hello"
  ]);
  assert.equal(
    encoded.toString("utf8"),
    "*3\r\n$7\r\nPUBLISH\r\n$3\r\ngeo\r\n$5\r\nhello\r\n"
  );
});

test("Redis protocol parses pubsub messages", () => {
  const payload = Buffer.from(
    "*3\r\n$7\r\nmessage\r\n$3\r\ngeo\r\n$5\r\nhello\r\n"
  );
  const parsed = redisProtocol.parseValue(payload, 0);
  assert.deepEqual(
    parsed.value,
    ["message", "geo", "hello"]
  );
  assert.equal(parsed.next, payload.length);
});
