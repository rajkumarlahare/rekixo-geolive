import test from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword,
  normalizeAdminEmail,
  validateAdminPassword,
  verifyPassword
} from "../src/passwords.mjs";

test("admin password hashes verify without storing plaintext", async () => {
  const password = "GeoLive-Strong-Password-2026";
  const encoded = await hashPassword(password);

  assert.match(encoded, /^scrypt\$/);
  assert.equal(encoded.includes(password), false);
  assert.equal(await verifyPassword(password, encoded), true);
  assert.equal(await verifyPassword("Wrong-Password-2026", encoded), false);
});

test("admin password policy rejects weak values", () => {
  assert.throws(() => validateAdminPassword("short"), /12-256/);
  assert.throws(() => validateAdminPassword("onlyletterslong"), /letters and numbers/);
});

test("admin emails are normalized", () => {
  assert.equal(
    normalizeAdminEmail("  Owner@Example.COM "),
    "owner@example.com"
  );
});
