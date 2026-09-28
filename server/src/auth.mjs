import crypto from "node:crypto";
import { sha256 } from "./config.mjs";

function constantTimeHexEqual(a, b) {
  if (!/^[a-f0-9]{64}$/i.test(String(a)) || !/^[a-f0-9]{64}$/i.test(String(b))) return false;
  return crypto.timingSafeEqual(Buffer.from(String(a), "hex"), Buffer.from(String(b), "hex"));
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

export async function authenticateRequest(req, {
  keyStore = null,
  environmentKeys = [],
  clientTokenService = null
} = {}, requiredScope) {
  const presented = extractCredential(req);
  if (!presented) {
    return {
      ok: false,
      status: 401,
      error: "missing_credential"
    };
  }

  if (
    clientTokenService &&
    presented.startsWith("rgl_client_")
  ) {
    const result = clientTokenService.verify(
      presented,
      requiredScope
    );
    if (!result.ok) return result;

    if (
      keyStore &&
      result.key?.issuerKeyId
    ) {
      const issuerActive =
        await keyStore.isKeyActive(
          result.key.issuerKeyId,
          result.key.projectId,
          "tokens:issue"
        );
      if (!issuerActive) {
        return {
          ok: false,
          status: 401,
          error:
            "client_token_issuer_inactive"
        };
      }
    }

    return result;
  }

  if (
    keyStore &&
    presented.startsWith("rgl_live_")
  ) {
    const result =
      await keyStore.authenticateSecret(
        presented,
        requiredScope
      );
    if (
      result.ok ||
      result.error !== "invalid_credential"
    ) {
      return result;
    }
  }

  return authenticate(
    req,
    environmentKeys,
    requiredScope
  );
}

export function originAllowed(origin, key, globalAllowed = []) {
  if (!origin) return true;

  const keyAllowed = key?.allowedOrigins || [];
  if (keyAllowed.length > 0) return keyAllowed.includes(origin);

  const global = globalAllowed || [];
  if (global.length > 0) return global.includes(origin);

  return false;
}

export function packageAllowed(packageId, key) {
  const allowed = key?.allowedPackages || [];
  if (allowed.length === 0) return true;
  if (!packageId) return false;
  return allowed.includes(String(packageId));
}
