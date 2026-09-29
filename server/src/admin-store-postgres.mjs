export class AdminStoreError extends Error {
  constructor(code, status = 400, message = code) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function mapProject(row) {
  return {
    id: row.id,
    accountId: row.account_id,
    accountName: row.account_name,
    slug: row.slug,
    name: row.name,
    status: row.status,
    role: row.role,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
  };
}

export class PostgresAdminStore {
  kind = "postgres-admin";

  constructor({ pool }) {
    if (!pool) throw new Error("PostgresAdminStore requires a pool.");
    this.pool = pool;
  }

  async ready() {
    try {
      const result = await this.pool.query(`
        SELECT
          to_regclass('public.admin_users') IS NOT NULL AS admin_users,
          to_regclass('public.account_memberships') IS NOT NULL AS memberships,
          to_regclass('public.admin_sessions') IS NOT NULL AS sessions,
          to_regclass('public.audit_log') IS NOT NULL AS audit_log
      `);
      const row = result.rows[0] || {};
      return Boolean(row.admin_users && row.memberships && row.sessions && row.audit_log);
    } catch {
      return false;
    }
  }

  async assertReady() {
    if (!(await this.ready())) {
      throw new Error("GeoLive Admin schema is not ready. Run npm run migrate first.");
    }
  }

  async createInitialOwner({
    email,
    displayName,
    passwordHash,
    accountName,
    accountId = null
  }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const existing = await client.query(
        "SELECT id FROM admin_users WHERE lower(email) = lower($1)",
        [email]
      );
      if (existing.rows.length) {
        throw new AdminStoreError("admin_email_exists", 409);
      }

      let resolvedAccountId = accountId;
      if (resolvedAccountId) {
        const account = await client.query(
          "SELECT id FROM accounts WHERE id = $1",
          [resolvedAccountId]
        );
        if (!account.rows.length) throw new AdminStoreError("account_not_found", 404);
      } else {
        const account = await client.query(
          "INSERT INTO accounts (name) VALUES ($1) RETURNING id",
          [accountName]
        );
        resolvedAccountId = account.rows[0].id;
      }

      const user = await client.query(
        `INSERT INTO admin_users (email, display_name, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id, email, display_name, status, created_at`,
        [email, displayName, passwordHash]
      );

      await client.query(
        `INSERT INTO account_memberships (account_id, admin_user_id, role)
         VALUES ($1, $2, 'owner')`,
        [resolvedAccountId, user.rows[0].id]
      );

      await client.query(
        `INSERT INTO audit_log (admin_user_id, account_id, action, details)
         VALUES ($1, $2, 'admin.bootstrap_owner', $3::jsonb)`,
        [
          user.rows[0].id,
          resolvedAccountId,
          JSON.stringify({ email })
        ]
      );

      await client.query("COMMIT");
      return {
        userId: user.rows[0].id,
        email: user.rows[0].email,
        displayName: user.rows[0].display_name,
        accountId: resolvedAccountId,
        role: "owner"
      };
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      if (error?.code === "23505") {
        throw new AdminStoreError("admin_email_exists", 409);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async findUserForLogin(email) {
    const result = await this.pool.query(
      `SELECT id, email, display_name, password_hash, status,
              failed_login_count, locked_until, last_login_at
         FROM admin_users
        WHERE lower(email) = lower($1)
        LIMIT 1`,
      [email]
    );
    return result.rows[0] || null;
  }

  async recordLoginFailure(userId, { maxFailures = 5, lockMinutes = 15 } = {}) {
    await this.pool.query(
      `UPDATE admin_users
          SET failed_login_count =
                CASE
                  WHEN locked_until IS NOT NULL AND locked_until <= now() THEN 1
                  ELSE failed_login_count + 1
                END,
              locked_until =
                CASE
                  WHEN (
                    CASE
                      WHEN locked_until IS NOT NULL AND locked_until <= now() THEN 1
                      ELSE failed_login_count + 1
                    END
                  ) >= $2
                  THEN now() + ($3::double precision * interval '1 minute')
                  ELSE NULL
                END,
              updated_at = now()
        WHERE id = $1`,
      [userId, maxFailures, lockMinutes]
    );
  }

  async createSession({
    userId,
    tokenHash,
    csrfHash,
    expiresAt
  }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `DELETE FROM admin_sessions
          WHERE (expires_at <= now() OR revoked_at IS NOT NULL)
            AND created_at < now() - interval '1 day'`
      );

      const session = await client.query(
        `INSERT INTO admin_sessions (
          admin_user_id, token_hash, csrf_hash, expires_at
        ) VALUES ($1, $2, $3, $4)
        RETURNING id, expires_at`,
        [userId, tokenHash, csrfHash, expiresAt]
      );

      await client.query(
        `UPDATE admin_users
            SET failed_login_count = 0,
                locked_until = NULL,
                last_login_at = now(),
                updated_at = now()
          WHERE id = $1`,
        [userId]
      );

      await client.query(
        `INSERT INTO audit_log (admin_user_id, action, details)
         VALUES ($1, 'admin.login', '{}'::jsonb)`,
        [userId]
      );

      await client.query("COMMIT");
      return {
        id: session.rows[0].id,
        expiresAt: session.rows[0].expires_at
      };
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async getSession(tokenHash) {
    const result = await this.pool.query(
      `SELECT
          s.id AS session_id,
          s.csrf_hash,
          s.expires_at,
          s.last_seen_at,
          u.id AS user_id,
          u.email,
          u.display_name,
          u.status
        FROM admin_sessions s
        JOIN admin_users u ON u.id = s.admin_user_id
       WHERE s.token_hash = $1
         AND s.revoked_at IS NULL
         AND s.expires_at > now()
         AND u.status = 'active'
       LIMIT 1`,
      [tokenHash]
    );

    const row = result.rows[0];
    if (!row) return null;

    if (!row.last_seen_at || Date.now() - new Date(row.last_seen_at).getTime() > 5 * 60 * 1000) {
      this.pool.query(
        "UPDATE admin_sessions SET last_seen_at = now() WHERE id = $1",
        [row.session_id]
      ).catch(() => {});
    }

    return {
      sessionId: row.session_id,
      csrfHash: row.csrf_hash,
      expiresAt: row.expires_at,
      user: {
        id: row.user_id,
        email: row.email,
        displayName: row.display_name
      }
    };
  }

  async rotateCsrf(sessionId, csrfHash) {
    const result = await this.pool.query(
      `UPDATE admin_sessions
          SET csrf_hash = $2,
              last_seen_at = now()
        WHERE id = $1
          AND revoked_at IS NULL
          AND expires_at > now()
        RETURNING id`,
      [sessionId, csrfHash]
    );
    if (!result.rows.length) throw new AdminStoreError("session_expired", 401);
  }

  async revokeSession(sessionId, userId) {
    await this.pool.query(
      "UPDATE admin_sessions SET revoked_at = now() WHERE id = $1 AND admin_user_id = $2",
      [sessionId, userId]
    );
    await this.pool.query(
      `INSERT INTO audit_log (admin_user_id, action, details)
       VALUES ($1, 'admin.logout', '{}'::jsonb)`,
      [userId]
    );
  }

  async listAccounts(userId) {
    const result = await this.pool.query(
      `SELECT a.id, a.name, m.role, a.created_at
         FROM account_memberships m
         JOIN accounts a ON a.id = m.account_id
        WHERE m.admin_user_id = $1
        ORDER BY a.name ASC`,
      [userId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
    }));
  }

  async authorizeAccount(
    userId,
    accountId,
    { write = false, ownerOnly = false } = {}
  ) {
    const result = await this.pool.query(
      `SELECT
        a.id,
        a.name,
        a.created_at,
        m.role
      FROM accounts a
      JOIN account_memberships m
        ON m.account_id = a.id
       AND m.admin_user_id = $1
      WHERE a.id = $2
      LIMIT 1`,
      [userId, accountId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new AdminStoreError(
        "account_not_found",
        404
      );
    }
    if (
      ownerOnly &&
      row.role !== "owner"
    ) {
      throw new AdminStoreError(
        "account_owner_required",
        403
      );
    }
    if (
      write &&
      !["owner","admin"].includes(
        row.role
      )
    ) {
      throw new AdminStoreError(
        "account_write_forbidden",
        403
      );
    }
    return {
      id: row.id,
      name: row.name,
      role: row.role,
      createdAt:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : row.created_at
    };
  }

  async listProjects(userId) {
    const result = await this.pool.query(
      `SELECT p.id, p.account_id, a.name AS account_name,
              p.slug, p.name, p.status, p.created_at, p.updated_at, m.role
         FROM account_memberships m
         JOIN accounts a ON a.id = m.account_id
         JOIN projects p ON p.account_id = a.id
        WHERE m.admin_user_id = $1
          AND p.status <> 'deleted'
        ORDER BY a.name ASC, p.name ASC`,
      [userId]
    );
    return result.rows.map(mapProject);
  }

  async authorizeProject(userId, projectId, { write = false } = {}) {
    const result = await this.pool.query(
      `SELECT p.id, p.account_id, a.name AS account_name,
              p.slug, p.name, p.status, p.created_at, p.updated_at, m.role
         FROM projects p
         JOIN accounts a ON a.id = p.account_id
         JOIN account_memberships m
           ON m.account_id = p.account_id
          AND m.admin_user_id = $1
        WHERE p.id = $2
          AND p.status <> 'deleted'
        LIMIT 1`,
      [userId, projectId]
    );
    const row = result.rows[0];
    if (!row) throw new AdminStoreError("project_not_found", 404);
    if (write && !["owner", "admin"].includes(row.role)) {
      throw new AdminStoreError("project_write_forbidden", 403);
    }
    return mapProject(row);
  }

  async createProject(
    userId,
    {
      accountId,
      slug,
      name,
      maxProjects = null
    }
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const membership = await client.query(
        `SELECT role
           FROM account_memberships
          WHERE account_id = $1 AND admin_user_id = $2
          FOR SHARE`,
        [accountId, userId]
      );
      if (!membership.rows.length) {
        throw new AdminStoreError(
          "account_not_found",
          404
        );
      }
      if (
        !["owner", "admin"].includes(
          membership.rows[0].role
        )
      ) {
        throw new AdminStoreError(
          "project_write_forbidden",
          403
        );
      }

      if (
        maxProjects !== null &&
        maxProjects !== undefined
      ) {
        const limit = Number(maxProjects);
        if (
          !Number.isSafeInteger(limit) ||
          limit < 1
        ) {
          throw new AdminStoreError(
            "invalid_project_entitlement",
            500
          );
        }

        // Serialize project-count enforcement per account so
        // concurrent creates cannot both consume the last slot.
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
          [accountId]
        );
        const count = await client.query(
          `SELECT count(*)::int AS count
             FROM projects
            WHERE account_id = $1
              AND status <> 'deleted'`,
          [accountId]
        );
        if (
          Number(count.rows[0]?.count || 0) >=
          limit
        ) {
          throw new AdminStoreError(
            "project_entitlement_exceeded",
            402
          );
        }
      }

      const inserted = await client.query(
        `INSERT INTO projects (account_id, slug, name)
         VALUES ($1, $2, $3)
         RETURNING id, account_id, slug, name, status, created_at, updated_at`,
        [accountId, slug, name]
      );

      await client.query(
        `INSERT INTO audit_log (
          admin_user_id, account_id, project_id, action, details
        ) VALUES ($1, $2, $3, 'project.create', $4::jsonb)`,
        [
          userId,
          accountId,
          inserted.rows[0].id,
          JSON.stringify({ slug, name })
        ]
      );

      await client.query("COMMIT");

      return {
        ...mapProject({
          ...inserted.rows[0],
          account_name: null,
          role: membership.rows[0].role
        })
      };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      if (error?.code === "23505") {
        throw new AdminStoreError(
          "project_slug_exists",
          409
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async updateProject(
    userId,
    projectId,
    { slug, name, status }
  ) {
    const current =
      await this.authorizeProject(
        userId,
        projectId,
        { write: true }
      );
    if (current.status === "deleted") {
      throw new AdminStoreError(
        "project_not_found",
        404
      );
    }

    const nextSlug = slug ?? current.slug;
    const nextName = name ?? current.name;
    const nextStatus = status ?? current.status;

    if (
      !["active", "suspended"].includes(
        nextStatus
      )
    ) {
      throw new AdminStoreError(
        "invalid_project_status",
        400
      );
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE projects
            SET slug = $2,
                name = $3,
                status = $4,
                updated_at = now()
          WHERE id = $1
          RETURNING id, account_id, slug, name, status, created_at, updated_at`,
        [
          projectId,
          nextSlug,
          nextName,
          nextStatus
        ]
      );

      await client.query(
        `INSERT INTO audit_log (
          admin_user_id, account_id, project_id, action, details
        ) VALUES ($1, $2, $3, 'project.update', $4::jsonb)`,
        [
          userId,
          current.accountId,
          projectId,
          JSON.stringify({
            before: {
              slug: current.slug,
              name: current.name,
              status: current.status
            },
            after: {
              slug: nextSlug,
              name: nextName,
              status: nextStatus
            }
          })
        ]
      );

      await client.query("COMMIT");
      return mapProject({
        ...result.rows[0],
        account_name: current.accountName,
        role: current.role
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      if (error?.code === "23505") {
        throw new AdminStoreError(
          "project_slug_exists",
          409
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteProject(userId, projectId) {
    const current =
      await this.authorizeProject(
        userId,
        projectId,
        { write: true }
      );

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE projects
            SET status = 'deleted',
                updated_at = now()
          WHERE id = $1`,
        [projectId]
      );

      await client.query(
        `INSERT INTO audit_log (
          admin_user_id, account_id, project_id, action, details
        ) VALUES ($1, $2, $3, 'project.delete', $4::jsonb)`,
        [
          userId,
          current.accountId,
          projectId,
          JSON.stringify({
            slug: current.slug,
            name: current.name
          })
        ]
      );
      await client.query("COMMIT");
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

}
