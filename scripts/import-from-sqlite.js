#!/usr/bin/env node
//
// One-off import of the legacy SQLite database into Postgres.
//
// Test users are deliberately NOT carried across. The old test suite ran
// against db/budget.db, so 123 of its 125 users are `test-user-*` /
// `test-rollover-*` artifacts with one junk expense and one junk recurring
// rule each. Filtering them here is the cleanup.
//
//   npm run import:sqlite -- --dry   report what would move, write nothing
//   npm run import:sqlite            perform the import
//
// Safe to re-run: it refuses to touch a Postgres database that already has
// users unless --force is given.

const path = require("node:path");
const fs = require("node:fs");

require("../lib/load-env");

const sqlite3 = require("sqlite3");
const { transaction, get: pgGet, closeDatabase } = require("../lib/db");

const isDryRun = process.argv.includes("--dry");
const isForced = process.argv.includes("--force");

const sqlitePath = path.join(__dirname, "..", "db", "budget.db");

const TEST_USER_PATTERN = /^test-(user|rollover)-\d+@example\.com$/;

function openSqlite() {
  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite database not found at ${sqlitePath}`);
  }
  return new sqlite3.Database(sqlitePath, sqlite3.OPEN_READONLY);
}

function sqliteAll(db, sql) {
  return new Promise((resolve, reject) => {
    db.all(sql, [], (error, rows) => (error ? reject(error) : resolve(rows)));
  });
}

// SQLite stored timestamps as 'YYYY-MM-DD HH:MM:SS' in UTC with no zone
// marker. Tag them so Postgres does not reinterpret them as local time.
function asTimestamp(value) {
  if (!value) {
    return null;
  }
  const text = String(value).trim();
  return /(Z|[+-]\d{2}:?\d{2})$/.test(text) ? text : `${text}Z`;
}

function asDate(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

async function main() {
  const existing = await pgGet("SELECT COUNT(*)::int AS total FROM users");

  if (existing.total > 0 && !isForced && !isDryRun) {
    throw new Error(
      `Postgres already holds ${existing.total} user(s). Re-running would duplicate data. Pass --force only if you are sure.`
    );
  }

  const db = openSqlite();

  const allUsers = await sqliteAll(db, "SELECT * FROM users ORDER BY id");
  const keptUsers = allUsers.filter((user) => !TEST_USER_PATTERN.test(String(user.email || "")));
  const keptIds = new Set(keptUsers.map((user) => user.id));

  const [budgets, expenses, limits, recurring] = await Promise.all([
    sqliteAll(db, "SELECT * FROM monthly_budgets ORDER BY id"),
    sqliteAll(db, "SELECT * FROM expenses ORDER BY id"),
    sqliteAll(db, "SELECT * FROM category_limits ORDER BY id"),
    sqliteAll(db, "SELECT * FROM recurring_expenses ORDER BY id")
  ]);

  db.close();

  const keep = (rows) => rows.filter((row) => keptIds.has(row.user_id));
  const keptBudgets = keep(budgets);
  const keptExpenses = keep(expenses);
  const keptLimits = keep(limits);
  const keptRecurring = keep(recurring);

  const totalAmount = keptExpenses.reduce((sum, row) => sum + Number(row.amount || 0), 0);

  console.log("Source (SQLite)");
  console.log(`  users              ${allUsers.length}`);
  console.log(`  expenses           ${expenses.length}`);
  console.log(`  recurring rules    ${recurring.length}`);
  console.log("");
  console.log("To import (test artifacts excluded)");
  console.log(`  users              ${keptUsers.length}   (dropping ${allUsers.length - keptUsers.length})`);
  console.log(`  monthly budgets    ${keptBudgets.length}`);
  console.log(`  expenses           ${keptExpenses.length}   (dropping ${expenses.length - keptExpenses.length})`);
  console.log(`  category limits    ${keptLimits.length}`);
  console.log(`  recurring rules    ${keptRecurring.length}   (dropping ${recurring.length - keptRecurring.length})`);
  console.log(`  total expense sum  ${totalAmount.toFixed(2)}`);

  for (const user of keptUsers) {
    console.log(`    keeping user ${user.id}: ${user.email}`);
  }

  if (isDryRun) {
    console.log("\nDry run: nothing was written.");
    return;
  }

  // Original ids are preserved so foreign keys line up without remapping.
  // The identity sequences are resynchronised at the end.
  await transaction(async (tx) => {
    for (const user of keptUsers) {
      await tx.run(
        `INSERT INTO users (id, email, password_hash, google_id, full_name, avatar_url, created_at)
         OVERRIDING SYSTEM VALUE
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          user.id,
          user.email,
          user.password_hash,
          user.google_id || null,
          user.full_name || null,
          user.avatar_url || null,
          asTimestamp(user.created_at)
        ]
      );
    }

    for (const row of keptBudgets) {
      await tx.run(
        `INSERT INTO monthly_budgets (id, user_id, month_key, total_budget, created_at)
         OVERRIDING SYSTEM VALUE VALUES (?, ?, ?, ?, ?)`,
        [row.id, row.user_id, row.month_key, row.total_budget, asTimestamp(row.created_at)]
      );
    }

    for (const row of keptExpenses) {
      await tx.run(
        `INSERT INTO expenses (id, user_id, month_key, amount, label, category, note, spent_on, created_at)
         OVERRIDING SYSTEM VALUE VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.user_id,
          row.month_key,
          row.amount,
          row.label,
          row.category || "Other",
          row.note || null,
          asDate(row.spent_on),
          asTimestamp(row.created_at)
        ]
      );
    }

    for (const row of keptLimits) {
      await tx.run(
        `INSERT INTO category_limits (id, user_id, month_key, category, limit_amount, created_at)
         OVERRIDING SYSTEM VALUE VALUES (?, ?, ?, ?, ?, ?)`,
        [row.id, row.user_id, row.month_key, row.category, row.limit_amount, asTimestamp(row.created_at)]
      );
    }

    for (const row of keptRecurring) {
      await tx.run(
        `INSERT INTO recurring_expenses
           (id, user_id, label, amount, category, note, day_of_month, is_active, last_applied_month, created_at)
         OVERRIDING SYSTEM VALUE VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.user_id,
          row.label,
          row.amount,
          row.category || "Other",
          row.note || null,
          row.day_of_month,
          Boolean(row.is_active),
          row.last_applied_month || null,
          asTimestamp(row.created_at)
        ]
      );
    }

    // Explicit ids bypass the identity sequences, which would otherwise hand
    // out 1 to the next signup and collide immediately.
    for (const table of ["users", "monthly_budgets", "expenses", "category_limits", "recurring_expenses"]) {
      await tx.run(
        `SELECT setval(
           pg_get_serial_sequence('${table}', 'id'),
           COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1,
           false
         )`
      );
    }
  });

  const finalUsers = await pgGet("SELECT COUNT(*)::int AS total FROM users");
  const finalExpenses = await pgGet("SELECT COUNT(*)::int AS total, COALESCE(SUM(amount), 0) AS sum FROM expenses");

  console.log("\nImported into Postgres");
  console.log(`  users     ${finalUsers.total}`);
  console.log(`  expenses  ${finalExpenses.total}, sum = ${finalExpenses.sum}`);

  if (Math.abs(Number(finalExpenses.sum) - totalAmount) > 0.005) {
    throw new Error(`Expense total mismatch: expected ${totalAmount.toFixed(2)}, got ${finalExpenses.sum}`);
  }

  console.log("\nTotals match the source. Import complete.");
}

main()
  .then(() => closeDatabase())
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error(`\nImport failed: ${error.message}`);
    await closeDatabase().catch(() => {});
    process.exit(1);
  });
