import crypto from "node:crypto";

function b64url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

export function sha256Base64Url(value) {
  return crypto
    .createHash("sha256")
    .update(value)
    .digest("base64url");
}

export function requestProofCanonical({
  method,
  path,
  timestamp,
  nonce,
  body
}) {
  const bodyBytes = Buffer.isBuffer(body)
    ? body
    : Buffer.from(String(body || ""), "utf8");
  return [
    "RGL-PROOF-V1",
    String(method || "").toUpperCase(),
    String(path || ""),
    String(timestamp || ""),
    String(nonce || ""),
    sha256Base64Url(bodyBytes)
  ].join("\n");
}

export function normalizeProofPublicKey(value) {
  const encoded = String(value || "").trim();
  if (
    encoded.length < 80 ||
    encoded.length > 512 ||
    !/^[A-Za-z0-9_-]+$/.test(encoded)
  ) {
    throw Object.assign(
      new Error("invalid_proof_public_key"),
      {
        code: "invalid_proof_public_key",
        status: 400
      }
    );
  }

  let key;
  let der;
  try {
    der = Buffer.from(encoded, "base64url");
    key = crypto.createPublicKey({
      key: der,
      format: "der",
      type: "spki"
    });
  } catch {
    throw Object.assign(
      new Error("invalid_proof_public_key"),
      {
        code: "invalid_proof_public_key",
        status: 400
      }
    );
  }

  if (
    key.asymmetricKeyType !== "ec" ||
    key.asymmetricKeyDetails?.namedCurve !==
      "prime256v1"
  ) {
    throw Object.assign(
      new Error("unsupported_proof_public_key"),
      {
        code: "unsupported_proof_public_key",
        status: 400
      }
    );
  }

  const normalizedDer = key.export({
    type: "spki",
    format: "der"
  });

  return b64url(normalizedDer);
}

export function verifyProofSignature({
  proofPublicKey,
  signature,
  canonical
}) {
  try {
    const der = Buffer.from(
      normalizeProofPublicKey(proofPublicKey),
      "base64url"
    );
    const key = crypto.createPublicKey({
      key: der,
      format: "der",
      type: "spki"
    });
    const signatureBytes = Buffer.from(
      String(signature || ""),
      "base64url"
    );
    if (
      signatureBytes.length < 64 ||
      signatureBytes.length > 80
    ) {
      return false;
    }
    return crypto.verify(
      "sha256",
      Buffer.from(canonical, "utf8"),
      key,
      signatureBytes
    );
  } catch {
    return false;
  }
}

export function attestationExchangeHash({
  projectId,
  userId,
  packageId,
  clientNonce,
  clientTimestampMs,
  proofPublicKey
}) {
  const canonical = [
    "RGL-TOKEN-EXCHANGE-V1",
    String(projectId || ""),
    String(userId || ""),
    String(packageId || ""),
    String(clientNonce || ""),
    String(clientTimestampMs || ""),
    String(proofPublicKey || "")
  ].join("\n");

  return sha256Base64Url(
    Buffer.from(canonical, "utf8")
  );
}
