import { createPgPoolFromEnv } from "../server/src/database.mjs";

const slug = process.argv[2];
const name = process.argv[3] || slug;
const accountName = process.argv[4] || "Rekixo GeoLive";

if (!slug || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) {
  console.error("Usage: npm run db:bootstrap -- <project-slug> [project-name] [account-name]");
  process.exit(1);
}

const pool = createPgPoolFromEnv();
const client = await pool.connect();

try {
  await client.query("BEGIN");
  const account = await client.query(
    "INSERT INTO accounts (name) VALUES ($1) RETURNING id",
    [accountName]
  );
  const project = await client.query(
    `INSERT INTO projects (account_id, slug, name)
     VALUES ($1, $2, $3)
     RETURNING id, slug, name`,
    [account.rows[0].id, slug, name]
  );
  await client.query("COMMIT");

  console.log(JSON.stringify({
    accountId: account.rows[0].id,
    projectId: project.rows[0].id,
    slug: project.rows[0].slug,
    name: project.rows[0].name
  }, null, 2));
} catch (error) {
  try { await client.query("ROLLBACK"); } catch {}
  throw error;
} finally {
  client.release();
  await pool.end();
}
