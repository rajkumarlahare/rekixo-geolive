function boundedNumber(value, min, max, field, optional = false) {
  if ((value === undefined || value === null || value === "") && optional) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new InputError(`invalid_${field}`);
  return n;
}

function safeText(value, max = 200, optional = true) {
  if ((value === undefined || value === null) && optional) return undefined;
  const text = String(value ?? "").trim();
  if (!text || text.length > max) throw new InputError("invalid_text");
  return text;
}

export class InputError extends Error {
  constructor(code) {
    super(code);
    this.name = "InputError";
    this.code = code;
  }
}

export function validateLocation(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new InputError("invalid_body");

  const userId = safeText(body.userId, 160, false);
  const latitude = boundedNumber(body.latitude, -90, 90, "latitude");
  const longitude = boundedNumber(body.longitude, -180, 180, "longitude");
  const capturedAt = body.capturedAt ? new Date(body.capturedAt) : undefined;
  if (capturedAt && Number.isNaN(capturedAt.getTime())) throw new InputError("invalid_capturedAt");

  const metadata = body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
    ? JSON.parse(JSON.stringify(body.metadata))
    : undefined;
  if (metadata && Buffer.byteLength(JSON.stringify(metadata), "utf8") > 4096) {
    throw new InputError("metadata_too_large");
  }

  return {
    userId,
    latitude,
    longitude,
    accuracyM: boundedNumber(body.accuracyM, 0, 100000, "accuracyM", true),
    altitudeM: boundedNumber(body.altitudeM, -12000, 100000, "altitudeM", true),
    headingDeg: boundedNumber(body.headingDeg, 0, 360, "headingDeg", true),
    speedMps: boundedNumber(body.speedMps, 0, 10000, "speedMps", true),
    capturedAt: capturedAt?.toISOString(),
    name: safeText(body.name, 160, true),
    email: safeText(body.email, 254, true),
    country: safeText(body.country, 120, true),
    state: safeText(body.state, 120, true),
    city: safeText(body.city, 120, true),
    device: body.device && typeof body.device === "object" && !Array.isArray(body.device)
      ? {
          platform: safeText(body.device.platform, 40, true),
          appVersion: safeText(body.device.appVersion, 80, true),
          osVersion: safeText(body.device.osVersion, 80, true),
          deviceModel: safeText(body.device.deviceModel, 120, true)
        }
      : undefined,
    metadata
  };
}
