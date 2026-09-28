import { createPgPoolFromEnv } from "../server/src/database.mjs";
import { normalizeAdminEmail } from "../server/src/passwords.mjs";

const email = process.argv[2];
const role = String(process.argv[3] || "superadmin");

if (
  !email ||
  !["superadmin","billing","support","viewer"].includes(role)
) {
  console.error(
    'Usage: npm run platform:grant -- admin@example.com superadmin'
  );
  process.exit(1);
}

const pool = createPgPoolFromEnv();

try {
  const normalizedEmail = normalizeAdminEmail(email);
  const user = await pool.query(
    "SELECT id, email FROM admin_users WHERE lower(email) = lower($1) LIMIT 1",
    [normalizedEmail]
  );
  if (!user.rows.length) {
    throw new Error("admin_user_not_found");
  }

  await pool.query(
    `INSERT INTO platform_roles (
      admin_user_id,
      role,
      updated_at
    ) VALUES ($1,$2,now())
    ON CONFLICT (admin_user_id)
    DO UPDATE SET
      role = EXCLUDED.role,
      updated_at = now()`,
    [user.rows[0].id, role]
  );

  await pool.query(
    `INSERT INTO audit_log (
      admin_user_id,
      action,
      details
    ) VALUES (
      $1,'platform.role_bootstrap',$2::jsonb
    )`,
    [
      user.rows[0].id,
      JSON.stringify({
        targetUserId: user.rows[0].id,
        email: user.rows[0].email,
        role,
        via: "platform-grant-cli"
      })
    ]
  );

  console.log(JSON.stringify({
    updated: true,
    userId: user.rows[0].id,
    email: user.rows[0].email,
    role
  }, null, 2));
} finally {
  await pool.end();
}
