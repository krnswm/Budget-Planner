// Logs in through the real auth flow, then screenshots each page so the
// design can be judged on what it actually renders rather than on intent.
const { chromium } = require("playwright");
const path = require("node:path");

const OUT = process.argv[2] || ".";
const BASE = "http://localhost:3000";

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  // Public page first.
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(OUT, "01-login.png") });

  // Register a throwaway account to reach the authenticated UI.
  const email = `shot-${Date.now()}@example.com`;
  await page.goto(`${BASE}/register`, { waitUntil: "networkidle" });
  await page.fill("#fullName", "Karan Swami");
  await page.fill("#email", email);
  await page.fill("#password", "pass1234");
  await page.screenshot({ path: path.join(OUT, "02-register.png") });
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/app/, { timeout: 20000 });
  await page.waitForLoadState("networkidle");

  // Seed enough data that the layout is judged with content in it.
  const token = await page.evaluate(async () => {
    const r = await fetch("/api/session", { credentials: "same-origin" });
    return (await r.json()).csrfToken;
  });
  await page.evaluate(async (t) => {
    const post = (url, body) => fetch(url, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", "x-csrf-token": t },
      body: JSON.stringify(body)
    });
    await post("/api/budget", { totalBudget: 45000 });
    const items = [
      ["Monthly groceries", 11163, "Food", "2026-09-02"],
      ["Electricity bill", 6240.54, "Bills", "2026-09-04"],
      ["Metro card top-up", 1200, "Travel", "2026-09-05"],
      ["Pharmacy", 860, "Health", "2026-09-07"],
      ["Vegetables", 780, "Food", "2026-09-09"],
      ["Online course", 3499, "Education", "2026-09-10"],
      ["Housemaid", 1800, "Other", "2026-09-11"]
    ];
    for (const [label, amount, category, spentOn] of items) {
      await post("/api/expenses", { amount, label, category, spentOn, note: "" });
    }
    await post("/api/category-limits", { category: "Food", limitAmount: 12000 });
    await post("/api/recurring-expenses", { label: "Rent", amount: 18000, category: "Bills", dayOfMonth: 1, note: "" });
  }, token);

  const routes = [
    ["dashboard", "03-dashboard"],
    ["expenses", "04-expenses"],
    ["planning", "05-planning"],
    ["insights", "06-insights"],
    ["reports", "07-reports"],
    ["profile", "08-profile"]
  ];

  for (const [route, name] of routes) {
    await page.goto(`${BASE}/app/${route}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  }

  // Dark mode, same viewport.
  const dark = await browser.newContext({
    viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2,
    colorScheme: "dark", storageState: await ctx.storageState()
  });
  const dp = await dark.newPage();
  await dp.goto(`${BASE}/app/dashboard`, { waitUntil: "networkidle" });
  await dp.waitForTimeout(700);
  await dp.screenshot({ path: path.join(OUT, "10-dark-dashboard.png"), fullPage: true });

  // Mobile, plus an automated check for sideways scroll at each width.
  const state = await ctx.storageState();
  const overflow = [];
  for (const width of [390, 768, 1280]) {
    const c = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2, storageState: state });
    const p2 = await c.newPage();
    for (const route of ["dashboard", "expenses", "planning", "insights", "reports", "profile"]) {
      await p2.goto(`${BASE}/app/${route}`, { waitUntil: "networkidle" });
      await p2.waitForTimeout(400);
      const over = await p2.evaluate(() =>
        Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth
      );
      if (over > 1) overflow.push(`${width}px ${route}: +${over}px`);
    }
    if (width === 390) {
      await p2.goto(`${BASE}/app/dashboard`, { waitUntil: "networkidle" });
      await p2.waitForTimeout(500);
      await p2.screenshot({ path: path.join(OUT, "09-mobile-dashboard.png"), fullPage: true });
    }
    await c.close();
  }

  await browser.close();
  console.log("captured:", email);
  if (overflow.length) {
    console.log("\nHORIZONTAL OVERFLOW:");
    overflow.forEach((o) => console.log("  " + o));
    process.exitCode = 1;
  } else {
    console.log("no horizontal overflow at 390 / 768 / 1280");
  }
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
