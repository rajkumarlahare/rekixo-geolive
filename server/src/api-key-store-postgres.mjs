import crypto from "node:crypto";
import {
  generateIntegrationKey,
  hashIntegrationKey,
  parseIntegrationKeyPrefix
} from "./integration-keys.mjs";

function iso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function mapKey(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    prefix: row.key_prefix,
    scopes: row.scopes || [],
    allowedOrigins: row.allowed_origins || [],
    allowedPackages: row.allowed_packages || [],
    expiresAt: iso(row.expires_at),
    revokedAt: iso(row.revoked_at),
    lastUsedAt: iso(row.last_used_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    status: row.revoked_at
      ? "revoked"
      : row.expires_at && new Date(row.expires_at).getTime() <= Date.now()
        ? "expired"
        : "active"
  };
}

function timingSafeHashEqual(a, b) {
  if (!/^[a-f0-9]{64}$/i.test(String(a)) || !/^[a-f0-9]{64}$/i.test(String(b))) {
    return false;
  }
  return crypto.timingSafeEqual(
    Buffer.from(String(a), "hex"),
    Buffer.from(String(b), "hex")
  );
}

export class PostgresApiKeyStore {
  constructor({ pool }) {
    if (!pool) throw new Error("PostgresApiKeyStore requires a pool.");
    this.pool = pool;
  }

  async ready() {
    try {
      const result = await this.pool.query(`
        SELECT
          to_regclass('public.api_keys') IS NOT NULL AS api_keys,
          EXISTS (
            SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'api_keys'
               AND column_name = 'allowed_packages'
          ) AS p1c_columns
      `);
      const row = result.rows[0] || {};
      return Boolean(row.api_keys && row.p1c_columns);
    } catch {
      return false;
    }
  }

  async assertReady() {
    if (!(await this.ready())) {
      throw new Error("GeoLive API key schema is not ready. Run npm run migrate first.");
    }
  }

  async authenticateSecret(secret, requiredScope) {
    const prefix = parseIntegrationKeyPrefix(secret);
    if (!prefix) {
      return { ok: false, status: 401, error: "invalid_credential" };
    }

    const result = await this.pool.query(
      `SELECT
          k.id, k.project_id, k.name, k.key_prefix, k.secret_hash,
          k.scopes, k.allowed_origins, k.allowed_packages,
          k.expires_at, k.revoked_at, k.last_used_at,
          p.status AS project_status
         FROM api_keys k
         JOIN projects p ON p.id = k.project_id
        WHERE k.key_prefix = $1
        LIMIT 1`,
      [prefix]
    );

    const row = result.rows[0];
    if (!row || !timingSafeHashEqual(hashIntegrationKey(secret), row.secret_hash)) {
      return { ok: false, status: 401, error: "invalid_credential" };
    }
    if (row.revoked_at) {
      return { ok: false, status: 401, error: "credential_revoked" };
    }
    if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
      return { ok: false, status: 401, error: "credential_expired" };
    }
    if (row.project_status !== "active") {
      return { ok: false, status: 403, error: "project_not_active" };
    }
    if (requiredScope && !(row.scopes || []).includes(requiredScope)) {
      return { ok: false, status: 403, error: "insufficient_scope" };
    }

    this.pool.query(
      `UPDATE api_keys
          SET last_used_at = now()
        WHERE id = $1
          AND (last_used_at IS NULL OR last_used_at < now() - interval '5 minutes')`,
      [row.id]
    ).catch(() => {});

    return {
      ok: true,
      key: {
        id: row.id,
        projectId: row.project_id,
        name: row.name,
        prefix: row.key_prefix,
        scopes: row.scopes || [],
        allowedOrigins: row.allowed_origins || [],
        allowedPackages: row.allowed_packages || []
      }
    };
  }

  async isKeyActive(
    keyId,
    projectId,
    requiredScope = ""
  ) {
    const result = await this.pool.query(
      `SELECT
          k.scopes,
          k.expires_at,
          k.revoked_at,
          p.status AS project_status
       FROM api_keys k
       JOIN projects p ON p.id = k.project_id
       WHERE k.id = $1
         AND k.project_id = $2
       LIMIT 1`,
      [keyId, projectId]
    );

    const row = result.rows[0];
    if (!row) return false;
    if (row.revoked_at) return false;
    if (
      row.expires_at &&
      new Date(row.expires_at).getTime() <=
        Date.now()
    ) {
      return false;
    }
    if (row.project_status !== "active") {
      return false;
    }
    if (
      requiredScope &&
      !(row.scopes || []).includes(requiredScope)
    ) {
      return false;
    }
    return true;
  }

  async listKeys(projectId) {
    const result = await this.pool.query(
      `SELECT id, project_id, name, key_prefix, scopes,
              allowed_origins, allowed_packages, expires_at,
              revoked_at, last_used_at, created_at, updated_at
         FROM api_keys
        WHERE project_id = $1
        ORDER BY created_at DESC`,
      [projectId]
    );
    return result.rows.map(mapKey);
  }

  async createKey({
    project,
    actorUserId,
    name,
    scopes,
    allowedOrigins,
    allowedPackages,
    expiresAt
  }) {
    const generated = generateIntegrationKey();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `INSERT INTO api_keys (
          project_id, name, key_prefix, secret_hash, scopes,
          allowed_origins, allowed_packages, expires_at,
          created_by_admin_user_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING id, project_id, name, key_prefix, scopes,
                  allowed_origins, allowed_packages, expires_at,
                  revoked_at, last_used_at, created_at, updated_at`,
        [
          project.id,
          name,
          generated.prefix,
          hashIntegrationKey(generated.secret),
          scopes,
          allowedOrigins,
          allowedPackages,
          expiresAt,
          actorUserId
        ]
      );

      await client.query(
        `INSERT INTO audit_log (
          admin_user_id, account_id, project_id, action, details
        ) VALUES ($1,$2,$3,'api_key.create',$4::jsonb)`,
        [
          actorUserId,
          project.accountId,
          project.id,
          JSON.stringify({
            keyId: result.rows[0].id,
            prefix: generated.prefix,
            name,
            scopes,
            expiresAt
          })
        ]
      );
      await client.query("COMMIT");
      return {
        key: mapKey(result.rows[0]),
        secret: generated.secret
      };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async updateKey({
    project,
    actorUserId,
    keyId,
    name,
    allowedOrigins,
    allowedPackages,
    expiresAt
  }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query(
        `SELECT *
           FROM api_keys
          WHERE id = $1 AND project_id = $2
          FOR UPDATE`,
        [keyId, project.id]
      );
      if (!current.rows.length) {
        throw Object.assign(
          new Error("API key not found."),
          {
            code: "api_key_not_found",
            status: 404
          }
        );
      }
      if (current.rows[0].revoked_at) {
        throw Object.assign(
          new Error(
            "Revoked API keys cannot be edited."
          ),
          {
            code: "api_key_revoked",
            status: 409
          }
        );
      }

      const result = await client.query(
        `UPDATE api_keys
            SET name = COALESCE($3, name),
                allowed_origins = COALESCE($4, allowed_origins),
                allowed_packages = COALESCE($5, allowed_packages),
                expires_at = CASE WHEN $6::boolean THEN $7 ELSE expires_at END,
                updated_at = now()
          WHERE id = $1 AND project_id = $2
          RETURNING id, project_id, name, key_prefix, scopes,
                    allowed_origins, allowed_packages, expires_at,
                    revoked_at, last_used_at, created_at, updated_at`,
        [
          keyId,
          project.id,
          name ?? null,
          allowedOrigins ?? null,
          allowedPackages ?? null,
          expiresAt !== undefined,
          expiresAt ?? null
        ]
      );

      await client.query(
        `INSERT INTO audit_log (
          admin_user_id, account_id, project_id, action, details
        ) VALUES ($1,$2,$3,'api_key.update',$4::jsonb)`,
        [
          actorUserId,
          project.accountId,
          project.id,
          JSON.stringify({
            keyId,
            prefix:
              current.rows[0].key_prefix
          })
        ]
      );
      await client.query("COMMIT");
      return mapKey(result.rows[0]);
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeKey({
    project,
    actorUserId,
    keyId
  }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE api_keys
            SET revoked_at = COALESCE(revoked_at, now()),
                revoked_by_admin_user_id = COALESCE(revoked_by_admin_user_id, $3),
                updated_at = now()
          WHERE id = $1 AND project_id = $2
          RETURNING id, project_id, name, key_prefix, scopes,
                    allowed_origins, allowed_packages, expires_at,
                    revoked_at, last_used_at, created_at, updated_at`,
        [
          keyId,
          project.id,
          actorUserId
        ]
      );
      if (!result.rows.length) {
        throw Object.assign(
          new Error("API key not found."),
          {
            code: "api_key_not_found",
            status: 404
          }
        );
      }

      await client.query(
        `INSERT INTO audit_log (
          admin_user_id, account_id, project_id, action, details
        ) VALUES ($1,$2,$3,'api_key.revoke',$4::jsonb)`,
        [
          actorUserId,
          project.accountId,
          project.id,
          JSON.stringify({
            keyId,
            prefix:
              result.rows[0].key_prefix
          })
        ]
      );
      await client.query("COMMIT");
      return mapKey(result.rows[0]);
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async rotateKey({ project, actorUserId, keyId }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const current = await client.query(
        `SELECT *
           FROM api_keys
          WHERE id = $1 AND project_id = $2
          FOR UPDATE`,
        [keyId, project.id]
      );
      const old = current.rows[0];
      if (!old) {
        throw Object.assign(new Error("API key not found."), {
          code: "api_key_not_found",
          status: 404
        });
      }
      if (old.revoked_at) {
        throw Object.assign(new Error("API key is already revoked."), {
          code: "api_key_revoked",
          status: 409
        });
      }

      const generated = generateIntegrationKey();
      const inserted = await client.query(
        `INSERT INTO api_keys (
          project_id, name, key_prefix, secret_hash, scopes,
          allowed_origins, allowed_packages, expires_at,
          created_by_admin_user_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING id, project_id, name, key_prefix, scopes,
                  allowed_origins, allowed_packages, expires_at,
                  revoked_at, last_used_at, created_at, updated_at`,
        [
          project.id,
          old.name,
          generated.prefix,
          hashIntegrationKey(generated.secret),
          old.scopes,
          old.allowed_origins,
          old.allowed_packages,
          old.expires_at,
          actorUserId
        ]
      );

      await client.query(
        `UPDATE api_keys
            SET revoked_at = now(),
                revoked_by_admin_user_id = $3,
                updated_at = now()
          WHERE id = $1 AND project_id = $2`,
        [keyId, project.id, actorUserId]
      );

      await client.query(
        `INSERT INTO audit_log (
          admin_user_id, account_id, project_id, action, details
        ) VALUES ($1,$2,$3,'api_key.rotate',$4::jsonb)`,
        [
          actorUserId,
          project.accountId,
          project.id,
          JSON.stringify({
            oldKeyId: keyId,
            oldPrefix: old.key_prefix,
            newKeyId: inserted.rows[0].id,
            newPrefix: generated.prefix
          })
        ]
      );

      await client.query("COMMIT");
      return {
        key: mapKey(inserted.rows[0]),
        secret: generated.secret
      };
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }
}
