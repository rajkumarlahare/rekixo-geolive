import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPgPoolFromEnv } from "../server/src/database.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(root, "database", "migrations");

function checksum(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

const pool = createPgPoolFromEnv();

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS geolive_schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await pool.query("SELECT pg_advisory_lock(hashtext('rekixo-geolive-schema-migrations'))");

  const names = (await fs.readdir(migrationsDir))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort();

  for (const name of names) {
    const sql = await fs.readFile(path.join(migrationsDir, name), "utf8");
    const hash = checksum(sql);
    const existing = await pool.query(
      "SELECT checksum FROM geolive_schema_migrations WHERE name = $1",
      [name]
    );

    if (existing.rows.length) {
      if (existing.rows[0].checksum !== hash) {
        throw new Error(
          `Migration checksum mismatch for ${name}. Applied migrations are immutable.`
        );
      }
      console.log(`skip ${name}`);
      continue;
    }

    const nonTransactional =
      /^-- geolive:nontransactional\b/m.test(
        sql
      );

    if (nonTransactional) {
      const statements = sql
        .split(
          /\n-- geolive:split\s*\n/
        )
        .map((value) => value.trim())
        .filter(Boolean);

      for (const statement of statements) {
        await pool.query(statement);
      }
      await pool.query(
        "INSERT INTO geolive_schema_migrations (name, checksum) VALUES ($1, $2)",
        [name, hash]
      );
      console.log(
        `applied ${name} (nontransactional)`
      );
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO geolive_schema_migrations (name, checksum) VALUES ($1, $2)",
        [name, hash]
      );
      await client.query("COMMIT");
      console.log(`applied ${name}`);
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  try {
    await pool.query("SELECT pg_advisory_unlock(hashtext('rekixo-geolive-schema-migrations'))");
  } catch {}
  await pool.end();
}
