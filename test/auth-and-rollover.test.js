const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

require("../lib/load-env");

process.env.REDIS_URL = "";
process.env.REDIS_AUTO_WSL = "false";

// These tests write real rows, so they must never run against the database
// the app uses. Set TEST_DATABASE_URL to a separate Neon branch -- branches
// are free and instant, which is exactly what they are for.
//
// The suite previously ran against db/budget.db directly, which is how 123
// junk users accumulated alongside real financial records.
const testDatabaseUrl = String(process.env.TEST_DATABASE_URL || "").trim();
const skip = testDatabaseUrl
  ? false
  : "TEST_DATABASE_URL is not set - create a Neon branch and point it there";

if (testDatabaseUrl) {
  process.env.DATABASE_URL = testDatabaseUrl;
}

const {
  app,
  closeDatabase,
  getCurrentMonthKey,
  parseMonthFromDate,
  applyRecurringExpensesForMonth,
  run,
  get
} = require("../server");

test.after(async () => {
  await closeDatabase();
});

function extractCsrfToken(html) {
  const match = html.match(/name="_csrf"\s+value="([^"]+)"/);
  return match ? match[1] : "";
}

test("auth flow: register, logout, login, dashboard", { skip }, async () => {

  const agent = request.agent(app);
  const email = `test-user-${Date.now()}@example.com`;
  const password = "pass1234";

  const registerPage = await agent.get("/register");
  assert.equal(registerPage.status, 200);

  const registerCsrf = extractCsrfToken(registerPage.text);
  assert.ok(registerCsrf.length > 0);

  const registerResponse = await agent
    .post("/register")
    .type("form")
    .send({
      _csrf: registerCsrf,
      fullName: "Test User",
      email,
      password
    });

  assert.equal(registerResponse.status, 302);
  assert.equal(registerResponse.headers.location, "/app");

  const sessionResponse = await agent.get("/api/session");
  assert.equal(sessionResponse.status, 200);
  assert.ok(typeof sessionResponse.body.csrfToken === "string");

  const logoutResponse = await agent
    .post("/api/logout")
    .set("x-csrf-token", sessionResponse.body.csrfToken)
    .send({});
  assert.equal(logoutResponse.status, 200);

  const loginPage = await agent.get("/login");
  const loginCsrf = extractCsrfToken(loginPage.text);
  const loginResponse = await agent.post("/login").type("form").send({
    _csrf: loginCsrf,
    email,
    password
  });

  assert.equal(loginResponse.status, 302);
  assert.equal(loginResponse.headers.location, "/app");
});

test("month rollover helpers and recurring expense application", { skip }, async () => {

  const monthKey = getCurrentMonthKey();
  assert.match(monthKey, /^\d{4}-\d{2}$/);

  assert.equal(parseMonthFromDate("2026-04-03"), "2026-04");
  assert.equal(parseMonthFromDate("invalid"), "");

  const email = `test-rollover-${Date.now()}@example.com`;
  await run("INSERT INTO users (email, password_hash, full_name) VALUES (?, ?, ?)", [
    email,
    "hash",
    "Rollover User"
  ]);

  const user = await get("SELECT id FROM users WHERE email = ?", [email]);
  assert.ok(user && user.id);

  await run(
    "INSERT INTO recurring_expenses (user_id, label, amount, category, note, day_of_month, is_active, last_applied_month) VALUES (?, ?, ?, ?, ?, ?, TRUE, NULL)",
    [user.id, "Test Rent", 1000, "Bills", "Monthly recurring", 5]
  );

  await applyRecurringExpensesForMonth(user.id, monthKey);
  const countAfterFirst = await get(
    "SELECT COUNT(*) AS total FROM expenses WHERE user_id = ? AND month_key = ? AND label = ?",
    [user.id, monthKey, "Test Rent"]
  );
  assert.equal(Number(countAfterFirst.total), 1);

  await applyRecurringExpensesForMonth(user.id, monthKey);
  const countAfterSecond = await get(
    "SELECT COUNT(*) AS total FROM expenses WHERE user_id = ? AND month_key = ? AND label = ?",
    [user.id, monthKey, "Test Rent"]
  );
  assert.equal(Number(countAfterSecond.total), 1);
});

test("health endpoint responds with status payload", { skip }, async () => {

  const response = await request(app).get("/healthz");
  assert.equal(response.status, 200);
  assert.equal(response.body.status, "ok");
  assert.ok(typeof response.body.timestamp === "string");
});

test("login rejects invalid email format with clear message", { skip }, async () => {
  const agent = request.agent(app);
  const loginPage = await agent.get("/login");
  const csrfToken = extractCsrfToken(loginPage.text);

  const response = await agent
    .post("/login")
    .type("form")
    .send({
      _csrf: csrfToken,
      email: "bad-email-format",
      password: "abc12345"
    });

  assert.equal(response.status, 400);
  assert.match(response.text, /Please enter a valid email and password\./);
});
