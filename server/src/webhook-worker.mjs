import crypto from "node:crypto";
import {
  signWebhookPayload
} from "./webhook-secrets.mjs";
import {
  postWebhook
} from "./webhook-http.mjs";

export class WebhookDeliveryWorker {
  constructor({
    automationStore,
    config
  }) {
    this.store = automationStore;
    this.config = config;
    this.workerId =
      crypto.randomUUID();
    this.timer = null;
    this.running = false;
    this.closed = false;
  }

  start() {
    if (
      this.closed ||
      this.timer ||
      !this.store ||
      !this.config?.webhooks
        ?.signingKeys?.length
    ) {
      return;
    }

    const pollMs =
      Math.min(
        Math.max(
          Number(
            this.config.webhooks
              .deliveryPollMs
          ) || 5000,
          1000
        ),
        60000
      );

    const tick = async () => {
      if (
        this.closed ||
        this.running
      ) {
        return;
      }
      this.running = true;
      try {
        await this.runOnce();
      } catch (error) {
        console.error(
          "GeoLive webhook worker tick failed",
          error
        );
      } finally {
        this.running = false;
      }
    };

    void tick();
    this.timer = setInterval(
      () => void tick(),
      pollMs
    );
    this.timer.unref?.();
  }

  async runOnce() {
    const deliveries =
      await this.store
        .claimWebhookDeliveries({
          workerId:
            this.workerId,
          limit:
            this.config.webhooks
              .batchSize
        });

    for (const delivery of deliveries) {
      await this.deliver(
        delivery
      );
    }

    return deliveries.length;
  }

  async deliver(delivery) {
    const startedAt =
      new Date().toISOString();
    const startedMs =
      Date.now();

    const body =
      JSON.stringify({
        id:
          delivery.eventId,
        type:
          `geofence.${delivery.eventType}`,
        createdAt:
          delivery.occurredAt,
        data:
          delivery.eventPayload
      });
    const timestamp =
      Math.floor(
        Date.now() / 1000
      ).toString();

    let statusCode = null;
    let bodyExcerpt = null;
    let errorText = null;
    let delivered = false;

    try {
      const secret =
        this.store
          .webhookSecretForDelivery(
            delivery
          );
      const signature =
        signWebhookPayload({
          secret,
          timestamp,
          body
        });

      const response =
        await postWebhook({
          url:
            delivery.endpointUrl,
          body,
          timeoutMs:
            this.config.webhooks
              .timeoutMs,
          isProduction:
            this.config.isProduction,
          headers: {
            "x-rekixo-signature":
              `v1=${signature}`,
            "x-rekixo-timestamp":
              timestamp,
            "x-rekixo-event-id":
              delivery.eventId,
            "x-rekixo-delivery-id":
              delivery.deliveryId,
            "idempotency-key":
              delivery.deliveryId
          }
        });

      statusCode =
        response.statusCode;
      bodyExcerpt =
        response.bodyExcerpt ||
        null;
      delivered =
        statusCode >= 200 &&
        statusCode < 300;

      if (!delivered) {
        errorText =
          `http_${statusCode}`;
      }
    } catch (error) {
      errorText =
        String(
          error?.code ||
          error?.message ||
          "webhook_delivery_error"
        ).slice(0, 500);
    }

    await this.store
      .finishWebhookAttempt({
        delivery,
        startedAt,
        responseStatus:
          statusCode,
        responseBodyExcerpt:
          bodyExcerpt,
        errorText,
        latencyMs:
          Date.now() -
          startedMs,
        delivered,
        maxAttempts:
          this.config.webhooks
            .maxAttempts
      });
  }

  close() {
    this.closed = true;
    if (this.timer) {
      clearInterval(
        this.timer
      );
      this.timer = null;
    }
  }
}
