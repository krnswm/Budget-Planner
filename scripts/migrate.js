#!/usr/bin/env node
//
// Applies every unapplied file in migrations/ in filename order, each inside
// its own transaction, and records what ran in schema_migrations.
//
// This replaces the old approach of mutating the schema at boot with
// PRAGMA table_info checks and conditional ALTER TABLE statements. That code
// could not create a fresh database (it altered tables before creating them)
// and gave no way to tell which changes a given database had received.
//
//   npm run migrate          apply pending migrations
//   npm run migrate -- --dry show what would run, change nothing

const fs = require("node:fs");
const path = require("node:path");

require("../lib/load-env");

const { getPool, closeDatabase } = require("../lib/db");

const migrationsDir = path.join(__dirname, "..", "migrations");
const isDryRun = process.argv.includes("--dry");

async function main() {
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`No migrations directory at ${migrationsDir}`);
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("No migration files found.");
    return;
  }

  const pool = getPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const { rows } = await pool.query("SELECT filename FROM schema_migrations");
  const applied = new Set(rows.map((row) => row.filename));
  const pending = files.filter((name) => !applied.has(name));

  if (pending.length === 0) {
    console.log(`Up to date - ${files.length} migration(s) already applied.`);
    return;
  }

  console.log(`${pending.length} pending migration(s):`);
  for (const name of pending) {
    console.log(`  - ${name}`);
  }

  if (isDryRun) {
    console.log("\nDry run: nothing was applied.");
    return;
  }

  for (const name of pending) {
    const sql = fs.readFileSync(path.join(migrationsDir, name), "utf8");
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [name]);
      await client.query("COMMIT");
      console.log(`  applied ${name}`);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw new Error(`Migration ${name} failed and was rolled back: ${error.message}`);
    } finally {
      client.release();
    }
  }

  console.log(`\nDone. ${pending.length} migration(s) applied.`);
}

main()
  .then(() => closeDatabase())
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error(`\n${error.message}`);
    await closeDatabase().catch(() => {});
    process.exit(1);
  });
