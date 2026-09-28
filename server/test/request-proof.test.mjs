import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  attestationExchangeHash,
  normalizeProofPublicKey,
  requestProofCanonical,
  verifyProofSignature
} from "../src/request-proof.mjs";

test("P2 P-256 request proof verifies exact request body", () => {
  const { publicKey, privateKey } =
    crypto.generateKeyPairSync("ec", {
      namedCurve: "prime256v1"
    });

  const proofPublicKey =
    publicKey.export({
      type: "spki",
      format: "der"
    }).toString("base64url");

  assert.equal(
    normalizeProofPublicKey(proofPublicKey),
    proofPublicKey
  );

  const body = Buffer.from(
    JSON.stringify({
      userId: "proof-user",
      latitude: 21.25,
      longitude: 81.63
    })
  );
  const canonical = requestProofCanonical({
    method: "POST",
    path: "/v1/locations",
    timestamp: "1790553600000",
    nonce: "abcdefghijklmnop",
    body
  });
  const signature = crypto.sign(
    "sha256",
    Buffer.from(canonical),
    privateKey
  ).toString("base64url");

  assert.equal(
    verifyProofSignature({
      proofPublicKey,
      signature,
      canonical
    }),
    true
  );

  const changed = requestProofCanonical({
    method: "POST",
    path: "/v1/locations",
    timestamp: "1790553600000",
    nonce: "abcdefghijklmnop",
    body: Buffer.from("{}")
  });
  assert.equal(
    verifyProofSignature({
      proofPublicKey,
      signature,
      canonical: changed
    }),
    false
  );
});

test("P2 Play Integrity request hash is deterministic", () => {
  const input = {
    projectId: "11111111-1111-4111-8111-111111111111",
    userId: "user-x",
    packageId: "com.example.app",
    clientNonce: "abcdefghijklmnop",
    clientTimestampMs: 1790553600000,
    proofPublicKey: "proof"
  };
  assert.equal(
    attestationExchangeHash(input),
    attestationExchangeHash({ ...input })
  );
  assert.notEqual(
    attestationExchangeHash(input),
    attestationExchangeHash({
      ...input,
      userId: "user-y"
    })
  );
});
