import {
  normalizeProofPublicKey,
  requestProofCanonical,
  verifyProofSignature
} from "./request-proof.mjs";

function error(code, status = 400) {
  return Object.assign(new Error(code), {
    code,
    status
  });
}

function safeText(
  value,
  max,
  code,
  { optional = false } = {}
) {
  if (
    optional &&
    (value === undefined ||
      value === null ||
      value === "")
  ) {
    return "";
  }
  const text = String(value || "").trim();
  if (!text || text.length > max) {
    throw error(code);
  }
  return text;
}

export function validateClientExchangeBody(body) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    throw error("invalid_client_exchange_body");
  }

  const userId = safeText(
    body.userId,
    160,
    "invalid_client_user_id"
  );
  const platform = safeText(
    body.platform || "android",
    40,
    "invalid_client_platform"
  ).toLowerCase();

  if (
    ![
      "android",
      "flutter",
      "web",
      "ios",
      "server"
    ].includes(platform)
  ) {
    throw error("invalid_client_platform");
  }

  const packageId = safeText(
    body.packageId,
    200,
    "invalid_client_package",
    { optional: true }
  );
  if (
    packageId &&
    !/^[A-Za-z0-9_.-]+$/.test(packageId)
  ) {
    throw error("invalid_client_package");
  }

  const clientNonce = safeText(
    body.clientNonce,
    128,
    "invalid_client_nonce"
  );
  if (
    clientNonce.length < 16 ||
    !/^[A-Za-z0-9_-]+$/.test(clientNonce)
  ) {
    throw error("invalid_client_nonce");
  }

  const clientTimestampMs = Number(
    body.clientTimestampMs
  );
  if (
    !Number.isSafeInteger(clientTimestampMs) ||
    clientTimestampMs <= 0
  ) {
    throw error(
      "invalid_client_timestamp"
    );
  }

  let proofPublicKey = "";
  if (body.proofPublicKey) {
    proofPublicKey =
      normalizeProofPublicKey(
        body.proofPublicKey
      );
  }

  let attestation = null;
  if (body.attestation != null) {
    if (
      typeof body.attestation !== "object" ||
      Array.isArray(body.attestation)
    ) {
      throw error("invalid_attestation");
    }
    const provider = safeText(
      body.attestation.provider,
      80,
      "invalid_attestation_provider"
    );
    const token = safeText(
      body.attestation.token,
      25000,
      "invalid_integrity_token"
    );
    attestation = { provider, token };
  }

  return {
    userId,
    platform,
    packageId,
    clientNonce,
    clientTimestampMs,
    proofPublicKey,
    attestation
  };
}

export function validateClientSecurityPatch(
  body
) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    throw error(
      "invalid_client_security_policy"
    );
  }

  const out = {};
  const integerFields = {
    clientTokenTtlSeconds: [60, 3600],
    requestMaxAgeSeconds: [30, 600],
    tokenExchangeRequestsPerMinute:
      [1, 100000]
  };

  for (
    const [key, [min, max]]
    of Object.entries(integerFields)
  ) {
    if (body[key] === undefined) continue;
    const value = Number(body[key]);
    if (
      !Number.isSafeInteger(value) ||
      value < min ||
      value > max
    ) {
      throw error(
        "invalid_client_security_policy"
      );
    }
    out[key] = value;
  }

  if (
    body.requireRequestProof !== undefined
  ) {
    if (
      typeof body.requireRequestProof !==
      "boolean"
    ) {
      throw error(
        "invalid_client_security_policy"
      );
    }
    out.requireRequestProof =
      body.requireRequestProof;
  }

  if (
    body.androidAttestationMode !== undefined
  ) {
    const mode = String(
      body.androidAttestationMode
    );
    if (
      !["off", "optional", "required"].includes(
        mode
      )
    ) {
      throw error(
        "invalid_client_security_policy"
      );
    }
    out.androidAttestationMode = mode;
  }

  if (!Object.keys(out).length) {
    throw error(
      "empty_client_security_update"
    );
  }

  return out;
}


function requestHeader(req, name) {
  const value = req.headers[
    String(name).toLowerCase()
  ];
  return typeof value === "string"
    ? value.trim()
    : "";
}

export async function validateClientLocationRequest({
  req,
  rawBody,
  input,
  auth,
  policy,
  store,
  now = () => Date.now()
}) {
  if (!auth?.key?.clientToken) {
    return { ok: true };
  }

  const key = auth.key;
  if (input.userId !== key.subject) {
    return {
      ok: false,
      status: 403,
      error: "client_token_subject_mismatch"
    };
  }

  if (
    key.platform &&
    input.device?.platform &&
    String(input.device.platform).toLowerCase() !==
      String(key.platform).toLowerCase()
  ) {
    return {
      ok: false,
      status: 403,
      error: "client_token_platform_mismatch"
    };
  }

  const packageId = requestHeader(
    req,
    "x-geolive-package"
  );
  if (
    key.packageId &&
    packageId !== key.packageId
  ) {
    return {
      ok: false,
      status: 403,
      error: "client_token_package_mismatch"
    };
  }

  const timestamp = requestHeader(
    req,
    "x-geolive-request-timestamp"
  );
  const nonce = requestHeader(
    req,
    "x-geolive-request-nonce"
  );

  const timestampMs = Number(timestamp);
  const maxAgeSeconds = Math.min(
    Math.max(
      Number(policy?.requestMaxAgeSeconds) || 120,
      30
    ),
    600
  );

  if (
    !Number.isSafeInteger(timestampMs) ||
    Math.abs(now() - timestampMs) >
      maxAgeSeconds * 1000
  ) {
    return {
      ok: false,
      status: 401,
      error: "client_request_stale"
    };
  }

  if (
    nonce.length < 16 ||
    nonce.length > 128 ||
    !/^[A-Za-z0-9_-]+$/.test(nonce)
  ) {
    return {
      ok: false,
      status: 400,
      error: "invalid_client_request_nonce"
    };
  }

  const proofRequired = Boolean(
    policy?.requireRequestProof
  );
  if (
    proofRequired &&
    !key.proofPublicKey
  ) {
    return {
      ok: false,
      status: 401,
      error: "client_request_proof_required"
    };
  }

  if (key.proofPublicKey) {
    const signature = requestHeader(
      req,
      "x-geolive-request-signature"
    );
    if (!signature) {
      return {
        ok: false,
        status: 401,
        error:
          "client_request_signature_required"
      };
    }

    const canonical =
      requestProofCanonical({
        method: req.method,
        path: "/v1/locations",
        timestamp,
        nonce,
        body: rawBody
      });

    if (
      !verifyProofSignature({
        proofPublicKey:
          key.proofPublicKey,
        signature,
        canonical
      })
    ) {
      return {
        ok: false,
        status: 401,
        error:
          "client_request_signature_invalid"
      };
    }
  }

  if (!store) {
    return {
      ok: false,
      status: 503,
      error:
        "client_security_store_unavailable"
    };
  }

  const unused =
    await store.consumeRequestNonce(
      key.projectId,
      key.jti,
      nonce,
      key.expiresAt
    );
  if (!unused) {
    return {
      ok: false,
      status: 409,
      error: "client_request_replayed"
    };
  }

  return { ok: true };
}
