import test from "node:test";
import assert from "node:assert/strict";
import {
  activeWebhookSigningKey,
  deriveWebhookSecret,
  parseWebhookSigningKeys,
  signWebhookPayload
} from "../src/webhook-secrets.mjs";
import {
  isPublicWebhookAddress
} from "../src/webhook-http.mjs";

test("P4B derives stable per-endpoint webhook secrets", () => {
  const rawSecret =
    Buffer.alloc(32, 7)
      .toString("base64url");
  const keys =
    parseWebhookSigningKeys(
      JSON.stringify([
        {
          kid: "primary",
          secret: rawSecret
        }
      ])
    );

  assert.equal(
    activeWebhookSigningKey(
      keys
    ).kid,
    "primary"
  );

  const args = {
    keys,
    keyId: "primary",
    projectId:
      "11111111-1111-4111-8111-111111111111",
    endpointId:
      "22222222-2222-4222-8222-222222222222",
    generation: 1
  };
  const first =
    deriveWebhookSecret(args);
  const second =
    deriveWebhookSecret(args);

  assert.equal(first, second);
  assert.match(
    first,
    /^rgl_whsec_/
  );
  assert.notEqual(
    first,
    deriveWebhookSecret({
      ...args,
      generation: 2
    })
  );

  const signature =
    signWebhookPayload({
      secret: first,
      timestamp: "1790630400",
      body: '{"hello":"world"}'
    });
  assert.match(
    signature,
    /^[a-f0-9]{64}$/
  );
});

test("P4B production webhook address checks reject private networks", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "::1",
    "fd00::1",
    "fe80::1"
  ]) {
    assert.equal(
      isPublicWebhookAddress(
        address
      ),
      false,
      address
    );
  }

  assert.equal(
    isPublicWebhookAddress(
      "8.8.8.8"
    ),
    true
  );
  assert.equal(
    isPublicWebhookAddress(
      "2606:4700:4700::1111"
    ),
    true
  );
});
