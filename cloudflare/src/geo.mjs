import { Buffer } from "node:buffer";

export function boundedNumber(value, min, max, fallback = null) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    if (fallback !== null) return fallback;
    throw Object.assign(new Error("invalid_number"), { code: "invalid_number", status: 400 });
  }
  if (n < min || n > max) {
    throw Object.assign(new Error("number_out_of_range"), { code: "number_out_of_range", status: 400 });
  }
  return n;
}

export function safeText(value, max, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (!required) return null;
    throw Object.assign(new Error("invalid_text"), { code: "invalid_text", status: 400 });
  }
  const text = String(value).trim();
  if (!text || text.length > max) {
    throw Object.assign(new Error("invalid_text"), { code: "invalid_text", status: 400 });
  }
  return text;
}

export function validateIdempotencyKey(value) {
  const key = String(value || "").trim();
  if (!key) return "";
  if (
    key.length < 8 ||
    key.length > 200 ||
    !/^[A-Za-z0-9._:-]+$/.test(key)
  ) {
    throw Object.assign(new Error("invalid_idempotency_key"), {
      code: "invalid_idempotency_key",
      status: 400
    });
  }
  return key;
}

export function validateLocationInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw Object.assign(new Error("invalid_body"), { code: "invalid_body", status: 400 });
  }
  const captured = body.capturedAt ? new Date(body.capturedAt) : null;
  if (captured && Number.isNaN(captured.getTime())) {
    throw Object.assign(new Error("invalid_capturedAt"), { code: "invalid_capturedAt", status: 400 });
  }
  if (captured && captured.getTime() > Date.now() + 5 * 60 * 1000) {
    throw Object.assign(new Error("capturedAt_in_future"), {
      code: "capturedAt_in_future",
      status: 400
    });
  }
  const metadata =
    body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
      ? body.metadata
      : null;
  if (metadata && new TextEncoder().encode(JSON.stringify(metadata)).byteLength > 4096) {
    throw Object.assign(new Error("metadata_too_large"), { code: "metadata_too_large", status: 400 });
  }
  const device =
    body.device && typeof body.device === "object" && !Array.isArray(body.device)
      ? {
          platform: safeText(body.device.platform, 40),
          appVersion: safeText(body.device.appVersion, 80),
          osVersion: safeText(body.device.osVersion, 80),
          deviceModel: safeText(body.device.deviceModel, 120)
        }
      : null;

  return {
    userId: safeText(body.userId, 160, { required: true }),
    latitude: boundedNumber(body.latitude, -90, 90),
    longitude: boundedNumber(body.longitude, -180, 180),
    accuracyM: body.accuracyM == null ? null : boundedNumber(body.accuracyM, 0, 100000),
    altitudeM: body.altitudeM == null ? null : boundedNumber(body.altitudeM, -12000, 100000),
    headingDeg: body.headingDeg == null ? null : boundedNumber(body.headingDeg, 0, 360),
    speedMps: body.speedMps == null ? null : boundedNumber(body.speedMps, 0, 10000),
    capturedAt: captured?.toISOString() || null,
    name: safeText(body.name, 160),
    email: safeText(body.email, 254),
    country: safeText(body.country, 120),
    state: safeText(body.state, 120),
    city: safeText(body.city, 120),
    device,
    metadata
  };
}

export function presenceStatus(receivedAt, now = Date.now(), thresholds = {}) {
  const time = new Date(receivedAt).getTime();
  if (!Number.isFinite(time)) return "inactive";
  const age = Math.max(0, now - time) / 1000;
  const online = Number(thresholds.onlineSeconds || 120);
  const recent = Number(thresholds.recentSeconds || 900);
  const inactive = Number(thresholds.inactiveSeconds || 86400);
  if (age <= online) return "online";
  if (age <= recent) return "recent";
  if (age <= inactive) return "offline";
  return "inactive";
}

export function thresholdCutoffs(now = new Date(), thresholds = {}) {
  const base = now.getTime();
  return {
    online: new Date(base - Number(thresholds.onlineSeconds || 120) * 1000).toISOString(),
    recent: new Date(base - Number(thresholds.recentSeconds || 900) * 1000).toISOString(),
    inactive: new Date(base - Number(thresholds.inactiveSeconds || 86400) * 1000).toISOString(),
    today: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
  };
}

export function normalizeGridDegrees(value, fallback = 8) {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n) || n < 0.0025 || n > 45) {
    throw Object.assign(new Error("invalid_grid"), { code: "invalid_grid", status: 400 });
  }
  return n;
}

export function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = (v) => Number(v) * Math.PI / 180;
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dPhi = toRad(Number(lat2) - Number(lat1));
  const dLambda = toRad(Number(lng2) - Number(lng1));
  const a = Math.sin(dPhi / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dLambda / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function pointInPolygon(latitude, longitude, points) {
  if (!Array.isArray(points) || points.length < 3) return false;
  let inside = false;
  const x = Number(longitude);
  const y = Number(latitude);
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    const xi = Number(a.longitude ?? a.lng ?? a[0]);
    const yi = Number(a.latitude ?? a.lat ?? a[1]);
    const xj = Number(b.longitude ?? b.lng ?? b[0]);
    const yj = Number(b.latitude ?? b.lat ?? b[1]);
    const intersects = ((yi > y) !== (yj > y)) &&
      x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function geofenceContains(geofence, latitude, longitude) {
  if (geofence.shape_type === "circle") {
    return haversineMeters(
      geofence.center_lat,
      geofence.center_lng,
      latitude,
      longitude
    ) <= Number(geofence.radius_m);
  }
  try {
    return pointInPolygon(latitude, longitude, JSON.parse(geofence.polygon_json || "[]"));
  } catch {
    return false;
  }
}

export function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    throw Object.assign(new Error("invalid_cursor"), { code: "invalid_cursor", status: 400 });
  }
}

export function parseWindow(searchParams, { defaultHours = 24, maxDays = 31 } = {}) {
  const now = new Date();
  const to = searchParams.get("to") ? new Date(searchParams.get("to")) : now;
  const from = searchParams.get("from")
    ? new Date(searchParams.get("from"))
    : new Date(to.getTime() - defaultHours * 3600000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    throw Object.assign(new Error("invalid_history_window"), { code: "invalid_history_window", status: 400 });
  }
  if (to.getTime() - from.getTime() > maxDays * 86400000) {
    throw Object.assign(new Error("history_window_too_large"), { code: "history_window_too_large", status: 400 });
  }
  return { from: from.toISOString(), to: to.toISOString() };
}
