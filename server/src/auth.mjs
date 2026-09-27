import crypto from "node:crypto";
import { sha256 } from "./config.mjs";

function constantTimeHexEqual(a, b) {
  if (!/^[a-f0-9]{64}$/i.test(a) || !/^[a-f0-9]{64}$/i.test(b)) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export function extractCredential(req) {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) return auth.slice(7).trim();
  const header = req.headers["x-geolive-key"];
  return typeof header === "string" ? header.trim() : "";
}

export function authenticate(req, keys, requiredScope) {
  const presented = extractCredential(req);
  if (!presented) return { ok: false, status: 401, error: "missing_credential" };

  const hash = sha256(presented);
  const record = keys.find((key) => constantTimeHexEqual(hash, key.hash));
  if (!record) return { ok: false, status: 401, error: "invalid_credential" };
  if (requiredScope && !record.scopes.includes(requiredScope)) {
    return { ok: false, status: 403, error: "insufficient_scope" };
  }
  return { ok: true, key: record };
}

export function originAllowed(origin, key, globalAllowed = []) {
  if (!origin) return true;
  const allowed = new Set([...(globalAllowed || []), ...(key?.allowedOrigins || [])]);
  return allowed.has(origin);
}
