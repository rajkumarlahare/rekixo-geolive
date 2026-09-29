import { createHmac } from "node:crypto";
import { recordUsage } from "./d1-store.mjs";

function isPrivateHostname(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return true;
  }
  if (host === "::1" || host === "0.0.0.0") return true;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const parts = ipv4.slice(1).map(Number);
    if (parts.some((x) => x > 255)) return true;
    const [a,b] = parts;
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  return false;
}

export function validateWebhookUrl(value) {
  let url;
  try { url = new URL(String(value || "")); }
  catch {
    throw Object.assign(new Error("invalid_webhook_url"), { code: "invalid_webhook_url", status: 400 });
  }
  if (url.protocol !== "https:" || url.username || url.password || isPrivateHostname(url.hostname)) {
    throw Object.assign(new Error("invalid_webhook_url"), { code: "invalid_webhook_url", status: 400 });
  }
  if (url.port && url.port !== "443") {
    throw Object.assign(new Error("invalid_webhook_url"), { code: "invalid_webhook_url", status: 400 });
  }
  return url.toString();
}

function signingSecret(env, projectId, endpointId, generation) {
  const master = String(env.GEOLIVE_WEBHOOK_SIGNING_SECRET || "");
  if (!master) throw new Error("webhook_signing_secret_unavailable");
  return createHmac("sha256", master)
    .update(`rgl-webhook-v1:${projectId}:${endpointId}:${generation}`)
    .digest();
}

export function deriveWebhookSecret(env, projectId, endpointId, generation = 1) {
  return signingSecret(env, projectId, endpointId, generation).toString("base64url");
}

function signature(env, delivery, timestamp, body) {
  const secret = signingSecret(
    env,
    delivery.project_id,
    delivery.webhook_endpoint_id,
    Number(delivery.secret_generation || 1)
  );
  return createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
}

export async function processWebhookMessage(message, env) {
  const deliveryId = String(message.body?.deliveryId || "");
  if (!deliveryId) {
    message.ack();
    return;
  }

  const delivery = await env.DB.prepare(
    `SELECT d.*,e.url,e.status AS endpoint_status,e.secret_generation,
      g.event_id,g.event_type,g.occurred_at,g.payload_json
     FROM webhook_deliveries d
     JOIN webhook_endpoints e ON e.id=d.webhook_endpoint_id
     JOIN geofence_events g ON g.id=d.geofence_event_id
     WHERE d.delivery_id=?
     LIMIT 1`
  ).bind(deliveryId).first();

  if (!delivery || delivery.status === "delivered" || delivery.status === "dead") {
    message.ack();
    return;
  }
  if (delivery.endpoint_status !== "active") {
    await env.DB.prepare(
      "UPDATE webhook_deliveries SET status='dead',last_error='endpoint_inactive',updated_at=? WHERE id=?"
    ).bind(new Date().toISOString(), delivery.id).run();
    message.ack();
    return;
  }

  let url;
  try { url = validateWebhookUrl(delivery.url); }
  catch (error) {
    await env.DB.prepare(
      "UPDATE webhook_deliveries SET status='dead',last_error=?,updated_at=? WHERE id=?"
    ).bind(error.code || "invalid_webhook_url",new Date().toISOString(),delivery.id).run();
    message.ack();
    return;
  }

  const payload = {
    id: delivery.event_id,
    type: `geofence.${delivery.event_type}`,
    createdAt: delivery.occurred_at,
    data: JSON.parse(delivery.payload_json || "{}")
  };
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const started = Date.now();
  let responseStatus = null;
  let excerpt = null;
  let errorText = null;
  let delivered = false;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort("timeout"),
      Math.min(Math.max(Number(env.GEOLIVE_WEBHOOK_TIMEOUT_MS || 10000),1000),30000)
    );
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "Rekixo-GeoLive-Webhook/1",
          "x-geolive-event-id": delivery.event_id,
          "x-geolive-event-type": `geofence.${delivery.event_type}`,
          "x-geolive-timestamp": timestamp,
          "x-geolive-signature": `v1=${signature(env,delivery,timestamp,body)}`
        },
        body,
        redirect: "manual",
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
    responseStatus = response.status;
    excerpt = (await response.text()).slice(0, 1000);
    delivered = response.status >= 200 && response.status < 300;
    if (!delivered) errorText = `http_${response.status}`;
  } catch (error) {
    errorText = String(error?.name === "AbortError" ? "timeout" : error?.message || "fetch_failed").slice(0,500);
  }

  const now = new Date().toISOString();
  const attempt = Number(delivery.attempt_count || 0) + 1;
  const maxAttempts = Math.min(Math.max(Number(env.GEOLIVE_WEBHOOK_MAX_ATTEMPTS || 8),1),20);
  const exhausted = !delivered && attempt >= maxAttempts;
  const nextStatus = delivered ? "delivered" : exhausted ? "dead" : "retry";
  const delaySeconds = Math.min(3600, 30 * (2 ** Math.max(0,attempt - 1)));
  const nextAttemptAt = delivered || exhausted
    ? now
    : new Date(Date.now() + delaySeconds*1000).toISOString();
  const latencyMs = Math.max(0, Date.now() - started);

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE webhook_deliveries
       SET status=?,attempt_count=?,next_attempt_at=?,response_status=?,
         response_body_excerpt=?,last_error=?,delivered_at=?,updated_at=?
       WHERE id=?`
    ).bind(
      nextStatus,attempt,nextAttemptAt,responseStatus,excerpt,errorText,
      delivered?now:null,now,delivery.id
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO webhook_delivery_attempts(
        webhook_delivery_id,attempt_number,started_at,completed_at,
        response_status,latency_ms,error_text
      ) VALUES(?,?,?,?,?,?,?)`
    ).bind(
      delivery.id,attempt,new Date(started).toISOString(),now,
      responseStatus,latencyMs,errorText
    )
  ]);
  await recordUsage(env,delivery.project_id,"webhook_attempts",1);

  if (delivered || exhausted) message.ack();
  else message.retry({ delaySeconds });
}
