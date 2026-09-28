import { createPgPoolFromEnv } from "../server/src/database.mjs";
import { PostgresAdminStore } from "../server/src/admin-store-postgres.mjs";
import {
  hashPassword,
  normalizeAdminEmail
} from "../server/src/passwords.mjs";

const email = process.argv[2];
const displayName = String(process.argv[3] || "").trim();
const accountName = String(process.argv[4] || "Rekixo").trim();
const accountId = process.env.GEOLIVE_BOOTSTRAP_ACCOUNT_ID || null;
const password = process.env.GEOLIVE_BOOTSTRAP_PASSWORD;

if (!email || displayName.length < 2) {
  console.error(
    'Usage: GEOLIVE_BOOTSTRAP_PASSWORD="..." npm run admin:bootstrap -- admin@example.com "Admin Name" "Account Name"'
  );
  process.exit(1);
}

if (!password) {
  console.error("GEOLIVE_BOOTSTRAP_PASSWORD is required and must not be placed in command history.");
  process.exit(1);
}

const normalizedEmail = normalizeAdminEmail(email);
const passwordHash = await hashPassword(password);
const pool = createPgPoolFromEnv();
const store = new PostgresAdminStore({ pool });

try {
  await store.assertReady();
  const result = await store.createInitialOwner({
    email: normalizedEmail,
    displayName,
    passwordHash,
    accountName,
    accountId
  });

  console.log(JSON.stringify({
    created: true,
    userId: result.userId,
    email: result.email,
    displayName: result.displayName,
    accountId: result.accountId,
    role: result.role
  }, null, 2));
} finally {
  await pool.end();
}
