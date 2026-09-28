import crypto from "node:crypto";

const DEFAULT_POLICY = Object.freeze({
  clientTokenTtlSeconds: 300,
  requestMaxAgeSeconds: 120,
  tokenExchangeRequestsPerMinute: 120,
  requireRequestProof: true,
  androidAttestationMode: "off"
});

function mapPolicy(row = {}) {
  return {
    clientTokenTtlSeconds: Number(
      row.client_token_ttl_seconds ??
      DEFAULT_POLICY.clientTokenTtlSeconds
    ),
    requestMaxAgeSeconds: Number(
      row.request_max_age_seconds ??
      DEFAULT_POLICY.requestMaxAgeSeconds
    ),
    tokenExchangeRequestsPerMinute: Number(
      row.token_exchange_requests_per_minute ??
      DEFAULT_POLICY.tokenExchangeRequestsPerMinute
    ),
    requireRequestProof:
      row.require_request_proof ??
      DEFAULT_POLICY.requireRequestProof,
    androidAttestationMode:
      row.android_attestation_mode ??
      DEFAULT_POLICY.androidAttestationMode,
    updatedAt: row.updated_at
      ? new Date(row.updated_at).toISOString()
      : null
  };
}

function hashNonce(value) {
  return crypto
    .createHash("sha256")
    .update(String(value))
    .digest("hex");
}

export class PostgresClientSecurityStore {
  constructor({ pool }) {
    if (!pool) {
      throw new Error(
        "PostgresClientSecurityStore requires a pool."
      );
    }
    this.pool = pool;
  }

  async ready() {
    try {
      const result = await this.pool.query(`
        SELECT
          to_regclass('public.project_client_security') IS NOT NULL AS policy,
          to_regclass('public.client_exchange_nonces') IS NOT NULL AS exchange_nonces,
          to_regclass('public.client_request_nonces') IS NOT NULL AS request_nonces
      `);
      const row = result.rows[0] || {};
      return Boolean(
        row.policy &&
        row.exchange_nonces &&
        row.request_nonces
      );
    } catch {
      return false;
    }
  }

  async assertReady() {
    if (!(await this.ready())) {
      throw new Error(
        "GeoLive client-security schema is not ready. Run npm run migrate first."
      );
    }
  }

  async getPolicy(projectId) {
    const result = await this.pool.query(
      `SELECT
          s.client_token_ttl_seconds,
          s.request_max_age_seconds,
          s.token_exchange_requests_per_minute,
          s.require_request_proof,
          s.android_attestation_mode,
          s.updated_at
       FROM projects p
       LEFT JOIN project_client_security s
         ON s.project_id = p.id
       WHERE p.id = $1
         AND p.status <> 'deleted'
       LIMIT 1`,
      [projectId]
    );
    if (!result.rows.length) {
      const error = new Error("project_not_found");
      error.code = "project_not_found";
      error.status = 404;
      throw error;
    }
    return mapPolicy(result.rows[0]);
  }

  async updatePolicy({
    project,
    actorUserId,
    patch
  }) {
    const before = await this.getPolicy(project.id);
    const next = { ...before, ...patch };

    const result = await this.pool.query(
      `INSERT INTO project_client_security (
        project_id,
        client_token_ttl_seconds,
        request_max_age_seconds,
        token_exchange_requests_per_minute,
        require_request_proof,
        android_attestation_mode,
        updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,now())
      ON CONFLICT (project_id)
      DO UPDATE SET
        client_token_ttl_seconds =
          EXCLUDED.client_token_ttl_seconds,
        request_max_age_seconds =
          EXCLUDED.request_max_age_seconds,
        token_exchange_requests_per_minute =
          EXCLUDED.token_exchange_requests_per_minute,
        require_request_proof =
          EXCLUDED.require_request_proof,
        android_attestation_mode =
          EXCLUDED.android_attestation_mode,
        updated_at = now()
      RETURNING *`,
      [
        project.id,
        next.clientTokenTtlSeconds,
        next.requestMaxAgeSeconds,
        next.tokenExchangeRequestsPerMinute,
        next.requireRequestProof,
        next.androidAttestationMode
      ]
    );

    const after = mapPolicy(result.rows[0]);
    await this.pool.query(
      `INSERT INTO audit_log (
        admin_user_id,
        account_id,
        project_id,
        action,
        details
      ) VALUES (
        $1,$2,$3,'project.client_security_update',$4::jsonb
      )`,
      [
        actorUserId,
        project.accountId,
        project.id,
        JSON.stringify({ before, after })
      ]
    );

    return after;
  }

  async consumeExchangeNonce(
    projectId,
    nonce,
    expiresAt
  ) {
    const result = await this.pool.query(
      `INSERT INTO client_exchange_nonces (
        project_id,
        nonce_hash,
        expires_at
      ) VALUES ($1,$2,$3)
      ON CONFLICT DO NOTHING
      RETURNING nonce_hash`,
      [projectId, hashNonce(nonce), expiresAt]
    );
    return result.rows.length === 1;
  }

  async consumeRequestNonce(
    projectId,
    tokenJti,
    nonce,
    expiresAt
  ) {
    const result = await this.pool.query(
      `INSERT INTO client_request_nonces (
        project_id,
        token_jti,
        nonce_hash,
        expires_at
      ) VALUES ($1,$2,$3,$4)
      ON CONFLICT DO NOTHING
      RETURNING nonce_hash`,
      [
        projectId,
        tokenJti,
        hashNonce(nonce),
        expiresAt
      ]
    );
    return result.rows.length === 1;
  }
}

export { DEFAULT_POLICY };
