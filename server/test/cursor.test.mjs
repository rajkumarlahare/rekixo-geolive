import test from "node:test";
import assert from "node:assert/strict";
import {
  CursorError,
  decodeCursor,
  encodeCursor
} from "../src/cursor.mjs";

test("cursor round-trips stable fields", () => {
  const encoded = encodeCursor({
    receivedAt: "2026-09-28T00:00:00.000Z",
    userId: "u-1"
  });
  assert.deepEqual(
    decodeCursor(encoded, ["receivedAt", "userId"]),
    {
      v: 1,
      receivedAt: "2026-09-28T00:00:00.000Z",
      userId: "u-1"
    }
  );
});

test("invalid cursor fails closed", () => {
  assert.throws(
    () => decodeCursor("not-json", ["receivedAt"]),
    CursorError
  );
});
