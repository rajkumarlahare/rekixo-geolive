import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { ClientTokenService } from "../src/client-token.mjs";

const projectId = "11111111-1111-4111-8111-111111111111";
const issuerKeyId = "22222222-2222-4222-8222-222222222222";

test("P2 short-lived client tokens bind subject/project and expire", () => {
  let now = Date.parse("2026-09-28T00:00:00Z");
  const service = new ClientTokenService({
    signingKeys: [
      { kid: "k2", secret: crypto.randomBytes(32) },
      { kid: "k1", secret: crypto.randomBytes(32) }
    ],
    now: () => now
  });

  const issued = service.issue({
    projectId,
    userId: "user-123",
    issuerKeyId,
    ttlSeconds: 300,
    packageId: "com.rekixo.test",
    platform: "android",
    attested: true,
    proofPublicKey: "proof-key-placeholder"
  });

  assert.match(issued.token, /^rgl_client_/);

  const verified = service.verify(
    issued.token,
    "location:write"
  );
  assert.equal(verified.ok, true);
  assert.equal(verified.key.projectId, projectId);
  assert.equal(verified.key.subject, "user-123");
  assert.equal(
    verified.key.packageId,
    "com.rekixo.test"
  );
  assert.equal(verified.key.attested, true);

  const wrongScope = service.verify(
    issued.token,
    "users:read"
  );
  assert.equal(wrongScope.ok, false);
  assert.equal(
    wrongScope.error,
    "insufficient_scope"
  );

  const tampered =
    issued.token.slice(0, -1) +
    (issued.token.endsWith("A") ? "B" : "A");
  assert.equal(
    service.verify(tampered).ok,
    false
  );

  now += 301000;
  const expired = service.verify(issued.token);
  assert.equal(expired.ok, false);
  assert.equal(
    expired.error,
    "client_token_expired"
  );
});

test("P2 signing-key ring verifies tokens across rotation", () => {
  const oldKey = {
    kid: "old",
    secret: crypto.randomBytes(32)
  };
  const newKey = {
    kid: "new",
    secret: crypto.randomBytes(32)
  };

  const oldService = new ClientTokenService({
    signingKeys: [oldKey]
  });
  const token = oldService.issue({
    projectId,
    userId: "rotation-user",
    issuerKeyId
  }).token;

  const rotated = new ClientTokenService({
    signingKeys: [newKey, oldKey]
  });
  assert.equal(rotated.verify(token).ok, true);

  const retired = new ClientTokenService({
    signingKeys: [newKey]
  });
  assert.equal(retired.verify(token).ok, false);
  assert.equal(
    retired.verify(token).error,
    "client_token_key_unavailable"
  );
});
