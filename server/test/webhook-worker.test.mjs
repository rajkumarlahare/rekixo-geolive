import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  WebhookDeliveryWorker
} from "../src/webhook-worker.mjs";
import {
  signWebhookPayload
} from "../src/webhook-secrets.mjs";

test("P4B webhook worker signs and completes a delivery", async () => {
  let received = null;
  const server = http.createServer(
    async (req, res) => {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      received = {
        body: Buffer.concat(
          chunks
        ).toString("utf8"),
        headers: req.headers
      };
      res.writeHead(204);
      res.end();
    }
  );

  await new Promise((resolve) => {
    server.listen(
      0,
      "127.0.0.1",
      resolve
    );
  });

  const address = server.address();
  const endpointUrl =
    `http://127.0.0.1:${address.port}/hook`;
  const secret =
    "rgl_whsec_test_secret";
  let finished = null;

  const delivery = {
    id: "1",
    deliveryId:
      "11111111-1111-4111-8111-111111111111",
    projectId:
      "22222222-2222-4222-8222-222222222222",
    webhookEndpointId:
      "33333333-3333-4333-8333-333333333333",
    endpointUrl,
    attemptCount: 0,
    eventId:
      "44444444-4444-4444-8444-444444444444",
    eventType: "enter",
    occurredAt:
      "2026-09-29T00:00:00.000Z",
    eventPayload: {
      type: "geofence.enter",
      userId: "user-1"
    }
  };

  const store = {
    async claimWebhookDeliveries() {
      return [delivery];
    },
    webhookSecretForDelivery() {
      return secret;
    },
    async finishWebhookAttempt(
      value
    ) {
      finished = value;
    }
  };

  const worker =
    new WebhookDeliveryWorker({
      automationStore: store,
      config: {
        isProduction: false,
        webhooks: {
          signingKeys: [
            {
              kid: "test",
              secret: Buffer.alloc(
                32,
                1
              )
            }
          ],
          batchSize: 10,
          timeoutMs: 5000,
          maxAttempts: 3,
          deliveryPollMs: 5000
        }
      }
    });

  try {
    const count =
      await worker.runOnce();
    assert.equal(count, 1);
    assert.ok(received);
    assert.equal(
      received.headers[
        "x-rekixo-event-id"
      ],
      delivery.eventId
    );
    assert.equal(
      received.headers[
        "x-rekixo-delivery-id"
      ],
      delivery.deliveryId
    );

    const timestamp =
      received.headers[
        "x-rekixo-timestamp"
      ];
    const expected =
      signWebhookPayload({
        secret,
        timestamp,
        body: received.body
      });
    assert.equal(
      received.headers[
        "x-rekixo-signature"
      ],
      `v1=${expected}`
    );

    assert.equal(
      finished.delivered,
      true
    );
    assert.equal(
      finished.responseStatus,
      204
    );
  } finally {
    worker.close();
    await new Promise(
      (resolve) =>
        server.close(resolve)
    );
  }
});
