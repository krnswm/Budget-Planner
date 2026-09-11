const test = require("node:test");
const assert = require("node:assert/strict");

const { toPositionalParams } = require("../lib/db");

test("numbers placeholders in order", () => {
  assert.equal(
    toPositionalParams("SELECT * FROM expenses WHERE user_id = ? AND month_key = ?"),
    "SELECT * FROM expenses WHERE user_id = $1 AND month_key = $2"
  );
});

test("leaves SQL without placeholders untouched", () => {
  const sql = "SELECT COUNT(*) AS total FROM users";
  assert.equal(toPositionalParams(sql), sql);
});

test("ignores a ? inside a string literal", () => {
  assert.equal(
    toPositionalParams("SELECT 'why?' AS q WHERE id = ?"),
    "SELECT 'why?' AS q WHERE id = $1"
  );
});

test("handles doubled single quotes inside a literal", () => {
  assert.equal(
    toPositionalParams("SELECT 'it''s a ?' AS q WHERE id = ?"),
    "SELECT 'it''s a ?' AS q WHERE id = $1"
  );
});

test("ignores a ? inside a quoted identifier", () => {
  assert.equal(
    toPositionalParams('SELECT "odd?column" FROM t WHERE id = ?'),
    'SELECT "odd?column" FROM t WHERE id = $1'
  );
});

test("ignores a ? inside a line comment", () => {
  assert.equal(
    toPositionalParams("SELECT 1 -- what about ?\nWHERE id = ?"),
    "SELECT 1 -- what about ?\nWHERE id = $1"
  );
});

test("ignores a ? inside a block comment", () => {
  assert.equal(
    toPositionalParams("SELECT 1 /* ? not a param */ WHERE id = ?"),
    "SELECT 1 /* ? not a param */ WHERE id = $1"
  );
});

test("ignores a ? inside a dollar-quoted block", () => {
  assert.equal(
    toPositionalParams("SELECT $tag$ a ? b $tag$ WHERE id = ?"),
    "SELECT $tag$ a ? b $tag$ WHERE id = $1"
  );
});

test("rewrites the real upsert used for budgets", () => {
  const sql = `
          INSERT INTO monthly_budgets (user_id, month_key, total_budget)
          VALUES (?, ?, ?)
          ON CONFLICT(user_id, month_key)
          DO UPDATE SET total_budget = excluded.total_budget
        `;
  const out = toPositionalParams(sql);
  assert.match(out, /VALUES \(\$1, \$2, \$3\)/);
  assert.ok(!out.includes("?"), "no placeholders should remain");
});

test("rewrites the multi-line expense filter query", () => {
  const sql = `
            SELECT id, amount, label, category, note, spent_on
            FROM expenses
            WHERE user_id = ? AND month_key = ? AND label LIKE ?
              AND COALESCE(spent_on, created_at::date) >= ?
            ORDER BY COALESCE(spent_on, created_at) DESC, id DESC
          `;
  const out = toPositionalParams(sql);
  assert.match(out, /user_id = \$1 AND month_key = \$2 AND label LIKE \$3/);
  assert.match(out, />= \$4/);
});

test("counts placeholders exactly once each", () => {
  const sql = "INSERT INTO expenses (user_id, month_key, amount, label, category, note, spent_on) VALUES (?, ?, ?, ?, ?, ?, ?)";
  const out = toPositionalParams(sql);
  assert.equal(out.match(/\$\d+/g).join(","), "$1,$2,$3,$4,$5,$6,$7");
});
