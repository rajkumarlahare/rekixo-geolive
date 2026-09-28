import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptWebSocketKey,
  encodeWebSocketFrame
} from "../src/websocket-protocol.mjs";

test("WebSocket accept key follows RFC 6455", () => {
  assert.equal(
    acceptWebSocketKey("dGhlIHNhbXBsZSBub25jZQ=="),
    "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
  );
});

test("server text frames are final and unmasked", () => {
  const frame = encodeWebSocketFrame(0x1, "hi");
  assert.deepEqual(
    [...frame],
    [0x81, 0x02, 0x68, 0x69]
  );
});
