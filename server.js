const path = require("path");
const { execSync } = require("child_process");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const dotenv = require("dotenv");
const express = require("express");
const morgan = require("morgan");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const { RedisStore } = require("connect-redis");
const { createClient } = require("redis");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const rateLimit = require("express-rate-limit");
const csrf = require("csurf");
const sqlite3 = require("sqlite3").verbose();
const registerSpaApiRoutes = require("./routes/register-spa-api-routes");
const registerAuthRoutes = require("./routes/register-auth-routes");
const registerReportRoutes = require("./routes/register-report-routes");

const app = express();
const NODE_ENV = process.env.NODE_ENV || "development";
const envSpecificPath = path.join(__dirname, `.env.${NODE_ENV}`);

if (fs.existsSync(envSpecificPath)) {
  dotenv.config({ path: envSpecificPath });
}

dotenv.config();

const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = NODE_ENV === "production";
const SESSION_COOKIE_SAMESITE = process.env.SESSION_COOKIE_SAMESITE || "lax";
const SESSION_SECRET = String(process.env.SESSION_SECRET || "").trim();
const APP_DOMAIN = String(process.env.APP_DOMAIN || "").trim().toLowerCase();
const FORCE_HTTPS = process.env.FORCE_HTTPS === "true" || IS_PRODUCTION;
const TRUST_PROXY = Number(process.env.TRUST_PROXY || 1);
const BACKUP_INTERVAL_HOURS = Number(process.env.BACKUP_INTERVAL_HOURS || (IS_PRODUCTION ? 24 : 0));
const BACKUP_RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS || 7);
const backupDirConfig = String(process.env.BACKUP_DIR || "backups").trim();
const EXPENSE_CATEGORIES = ["Food", "Travel", "Bills", "Shopping", "Health", "Education", "Other"];
const logsDir = path.join(__dirname, "logs");
const reactDistDir = path.join(__dirname, "client", "dist");
const reactIndexFile = path.join(reactDistDir, "index.html");
const backupsDir = path.isAbsolute(backupDirConfig)
  ? backupDirConfig
  : path.join(__dirname, backupDirConfig);

if (IS_PRODUCTION && SESSION_SECRET.length < 32) {
  throw new Error("SESSION_SECRET must be set to a strong value (at least 32 characters) in production.");
}

if (IS_PRODUCTION && !process.env.APP_BASE_URL) {
  throw new Error("APP_BASE_URL must be set in production.");
}

if (IS_PRODUCTION && GOOGLE_AUTH_ENABLED) {
  const hasAllGoogleVars = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_CALLBACK_URL;
  if (!hasAllGoogleVars) {
    throw new Error("GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_CALLBACK_URL must all be set if Google Auth is enabled.");
  }
}

if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const accessLogStream = fs.createWriteStream(path.join(logsDir, "access.log"), { flags: "a" });
const errorLogStream = fs.createWriteStream(path.join(logsDir, "error.log"), { flags: "a" });

function resolveRedisUrl() {
  const rawRedisUrl = String(process.env.REDIS_URL || "").trim();

  if (!rawRedisUrl) {
    return "";
  }

  const shouldAutoDetectWsl = process.env.REDIS_AUTO_WSL === "true";

  if (!shouldAutoDetectWsl || process.platform !== "win32") {
    return rawRedisUrl;
  }

  try {
    const parsedUrl = new URL(rawRedisUrl);
    const isLocalRedis = parsedUrl.hostname === "127.0.0.1" || parsedUrl.hostname === "localhost";

    if (!isLocalRedis) {
      return rawRedisUrl;
    }

    const wslOutput = execSync("wsl -d Ubuntu -- hostname -I", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();

    const wslIp = wslOutput.split(/\s+/).find((value) => /^\d+\.\d+\.\d+\.\d+$/.test(value));

    if (!wslIp) {
      return rawRedisUrl;
    }

    parsedUrl.hostname = wslIp;
    return parsedUrl.toString();
  } catch (error) {
    return rawRedisUrl;
  }
}

const RESOLVED_REDIS_URL = resolveRedisUrl();
const USE_REDIS_SESSIONS = Boolean(RESOLVED_REDIS_URL);
const GOOGLE_AUTH_ENABLED = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_CALLBACK_URL
);

const dbPath = path.join(__dirname, "db", "budget.db");
const db = new sqlite3.Database(dbPath);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows);
    });
  });
}

async function initializeDatabase() {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await ensureUsersSchema();
  await ensureExpensesSchema();
  await ensureCategoryLimitsSchema();
  await ensureRecurringExpensesSchema();

  await run(`
    CREATE TABLE IF NOT EXISTS monthly_budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      month_key TEXT NOT NULL,
      total_budget REAL NOT NULL CHECK(total_budget > 0),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, month_key),
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      month_key TEXT NOT NULL,
      amount REAL NOT NULL CHECK(amount > 0),
      label TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  await run(
    "CREATE INDEX IF NOT EXISTS idx_reset_tokens_user_id ON password_reset_tokens(user_id)"
  );

  await run(
    "CREATE INDEX IF NOT EXISTS idx_reset_tokens_expires_at ON password_reset_tokens(expires_at)"
  );

  await run(`
    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      new_email TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      verified_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  await run(
    "CREATE INDEX IF NOT EXISTS idx_email_verification_user_id ON email_verification_tokens(user_id)"
  );

  await run(
    "CREATE INDEX IF NOT EXISTS idx_email_verification_expires_at ON email_verification_tokens(expires_at)"
  );
}

async function ensureUsersSchema() {
  const columns = await all("PRAGMA table_info(users)");
  const hasGoogleId = columns.some((column) => column.name === "google_id");
  const hasFullName = columns.some((column) => column.name === "full_name");
  const hasAvatarUrl = columns.some((column) => column.name === "avatar_url");

  if (!hasGoogleId) {
    await run("ALTER TABLE users ADD COLUMN google_id TEXT");
  }

  if (!hasFullName) {
    await run("ALTER TABLE users ADD COLUMN full_name TEXT");
  }

  if (!hasAvatarUrl) {
    await run("ALTER TABLE users ADD COLUMN avatar_url TEXT");
  }

  await run(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL"
  );
}

async function ensureExpensesSchema() {
  const columns = await all("PRAGMA table_info(expenses)");
  const hasCategory = columns.some((column) => column.name === "category");
  const hasNote = columns.some((column) => column.name === "note");
  const hasSpentOn = columns.some((column) => column.name === "spent_on");

  if (!hasCategory) {
    await run("ALTER TABLE expenses ADD COLUMN category TEXT NOT NULL DEFAULT 'Other'");
  }

  if (!hasNote) {
    await run("ALTER TABLE expenses ADD COLUMN note TEXT");
  }

  if (!hasSpentOn) {
    await run("ALTER TABLE expenses ADD COLUMN spent_on TEXT");
  }
}

async function ensureCategoryLimitsSchema() {
  await run(`
    CREATE TABLE IF NOT EXISTS category_limits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      month_key TEXT NOT NULL,
      category TEXT NOT NULL,
      limit_amount REAL NOT NULL CHECK(limit_amount > 0),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, month_key, category),
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);
}

async function ensureRecurringExpensesSchema() {
  await run(`
    CREATE TABLE IF NOT EXISTS recurring_expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      label TEXT NOT NULL,
      amount REAL NOT NULL CHECK(amount > 0),
      category TEXT NOT NULL DEFAULT 'Other',
      note TEXT,
      day_of_month INTEGER NOT NULL CHECK(day_of_month >= 1 AND day_of_month <= 28),
      is_active INTEGER NOT NULL DEFAULT 1,
      last_applied_month TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);
}

function getCurrentMonthKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function monthLabel(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(year, month - 1, 1);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(date);
}

function isoDateToday() {
  return new Date().toISOString().slice(0, 10);
}

function parseMonthFromDate(dateValue) {
  const match = String(dateValue || "").match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!match) {
    return "";
  }
  return `${match[1]}-${match[2]}`;
}

function isIsoDate(dateValue) {
  return /^(\d{4})-(\d{2})-(\d{2})$/.test(String(dateValue || ""));
}

function getDaysInMonthFromKey(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month, 0).getDate();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
}

function toTimestampKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function createDatabaseBackup() {
  try {
    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true });
    }

    const backupFilePath = path.join(backupsDir, `budget-${toTimestampKey()}.sqlite`);
    fs.copyFileSync(dbPath, backupFilePath);

    const retentionCutoff = Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const backupFiles = fs
      .readdirSync(backupsDir)
      .filter((fileName) => fileName.startsWith("budget-") && fileName.endsWith(".sqlite"));

    for (const fileName of backupFiles) {
      const fullPath = path.join(backupsDir, fileName);
      const stat = fs.statSync(fullPath);
      if (stat.mtimeMs < retentionCutoff) {
        fs.unlinkSync(fullPath);
      }
    }

    return { ok: true, file: backupFilePath };
  } catch (error) {
    const message = `${new Date().toISOString()} BACKUP_ERROR ${error.message}\n`;
    errorLogStream.write(message);
    return { ok: false, error: error.message };
  }
}

function getHealthSnapshot() {
  return {
    status: "ok",
    env: NODE_ENV,
    uptimeSeconds: Number(process.uptime().toFixed(0)),
    timestamp: new Date().toISOString(),
    redisEnabled: USE_REDIS_SESSIONS,
    redisConnected: Boolean(redisClient && redisClient.isOpen),
    pid: process.pid
  };
}

async function applyRecurringExpensesForMonth(userId, monthKey) {
  const recurringItems = await all(
    `
      SELECT id, label, amount, category, note, day_of_month, last_applied_month
      FROM recurring_expenses
      WHERE user_id = ? AND is_active = 1
      ORDER BY id DESC
    `,
    [userId]
  );

  for (const item of recurringItems) {
    if (item.last_applied_month === monthKey) {
      continue;
    }

    const spentOn = `${monthKey}-${String(item.day_of_month).padStart(2, "0")}`;

    await run(
      "INSERT INTO expenses (user_id, month_key, amount, label, category, note, spent_on) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [userId, monthKey, Number(item.amount), item.label, item.category || "Other", item.note || null, spentOn]
    );

    await run("UPDATE recurring_expenses SET last_applied_month = ? WHERE id = ?", [monthKey, item.id]);
  }
}

function currency(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(value || 0);
}

function ensureAuth(req, res, next) {
  if (!req.session.userId) {
    res.redirect("/login");
    return;
  }
  next();
}

function getAuthErrorMessage(errorCode) {
  if (errorCode === "google_not_configured") {
    return "Google sign-in is not configured yet.";
  }

  if (errorCode === "google_auth_failed") {
    return "Google sign-in failed. Please try again.";
  }

  return "";
}

function createPasswordResetToken() {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  return { rawToken, tokenHash };
}

function getBaseUrl(req) {
  if (process.env.APP_BASE_URL) {
    return process.env.APP_BASE_URL.replace(/\/$/, "");
  }

  return `${req.protocol}://${req.get("host")}`;
}

let redisClient = null;
let sessionStore = null;

if (USE_REDIS_SESSIONS) {
  redisClient = createClient({
    url: RESOLVED_REDIS_URL
  });

  redisClient.on("error", (error) => {
    // eslint-disable-next-line no-console
    console.error("Redis session client error:", error.message);
  });

  sessionStore = new RedisStore({
    client: redisClient,
    prefix: "budget:sess:"
  });
} else {
  sessionStore = new SQLiteStore({
    db: "sessions.db",
    dir: path.join(__dirname, "db")
  });
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many auth attempts. Please try again in 15 minutes."
});

const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many password reset attempts. Please try again in 1 hour."
});

if (GOOGLE_AUTH_ENABLED) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const googleId = profile.id;
          const email = (profile.emails && profile.emails[0] && profile.emails[0].value || "")
            .trim()
            .toLowerCase();
          const fullName = (profile.displayName || "").trim() || null;

          if (!email) {
            done(new Error("Google account does not have a public email."));
            return;
          }

          let user = await get("SELECT * FROM users WHERE google_id = ?", [googleId]);

          if (user) {
            if (!user.full_name && fullName) {
              await run("UPDATE users SET full_name = ? WHERE id = ?", [fullName, user.id]);
              user.full_name = fullName;
            }
            done(null, user);
            return;
          }

          user = await get("SELECT * FROM users WHERE email = ?", [email]);

          if (user) {
            await run("UPDATE users SET google_id = ? WHERE id = ?", [googleId, user.id]);
            user.google_id = googleId;
            if (!user.full_name && fullName) {
              await run("UPDATE users SET full_name = ? WHERE id = ?", [fullName, user.id]);
              user.full_name = fullName;
            }
            done(null, user);
            return;
          }

          const randomPassword = crypto.randomUUID();
          const passwordHash = await bcrypt.hash(randomPassword, 10);
          const result = await run(
            "INSERT INTO users (email, password_hash, google_id, full_name) VALUES (?, ?, ?, ?)",
            [email, passwordHash, googleId, fullName]
          );

          const createdUser = await get("SELECT * FROM users WHERE id = ?", [result.lastID]);
          done(null, createdUser);
        } catch (error) {
          done(error);
        }
      }
    )
  );
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));
app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));
if (fs.existsSync(path.join(reactDistDir, "assets"))) {
  app.use("/app/assets", express.static(path.join(reactDistDir, "assets")));
}
app.set("trust proxy", TRUST_PROXY);

app.use((req, res, next) => {
  if (!IS_PRODUCTION) {
    next();
    return;
  }

  if (APP_DOMAIN && req.hostname && req.hostname.toLowerCase() !== APP_DOMAIN) {
    const targetUrl = `https://${APP_DOMAIN}${req.originalUrl}`;
    res.redirect(301, targetUrl);
    return;
  }

  if (FORCE_HTTPS && !req.secure) {
    const host = APP_DOMAIN || req.get("host");
    res.redirect(301, `https://${host}${req.originalUrl}`);
    return;
  }

  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  next();
});

app.use((req, res, next) => {
  req.requestId = crypto.randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  next();
});

morgan.token("request-id", (req) => req.requestId);
app.use(
  morgan(":date[iso] :request-id :method :url :status :res[content-length] - :response-time ms", {
    stream: accessLogStream
  })
);

app.use(
  session({
    store: sessionStore,
    secret: SESSION_SECRET || "budget-planner-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7,
      httpOnly: true,
      sameSite: SESSION_COOKIE_SAMESITE,
      secure: IS_PRODUCTION
    }
  })
);
app.use(passport.initialize());

const csrfProtection = csrf();
app.use(csrfProtection);

app.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken();
  next();
});

registerSpaApiRoutes(app, {
  ensureAuth,
  fs,
  reactIndexFile,
  get,
  run,
  all,
  getHealthSnapshot,
  NODE_ENV,
  getCurrentMonthKey,
  getDaysInMonthFromKey,
  monthLabel,
  currency,
  EXPENSE_CATEGORIES,
  parseMonthFromDate,
  isIsoDate,
  isoDateToday,
  applyRecurringExpensesForMonth,
  bcrypt,
  crypto
});

registerAuthRoutes(app, {
  authLimiter,
  passwordResetLimiter,
  isValidEmail,
  GOOGLE_AUTH_ENABLED,
  run,
  get,
  bcrypt,
  getAuthErrorMessage,
  createPasswordResetToken,
  getBaseUrl,
  crypto,
  passport,
  ensureAuth
});

registerReportRoutes(app, {
  ensureAuth,
  getCurrentMonthKey,
  isIsoDate,
  all,
  get,
  PDFDocument,
  monthLabel,
  currency
});

app.use((error, req, res, next) => {
  if (error.code !== "EBADCSRFTOKEN") {
    next(error);
    return;
  }

  const message = `${new Date().toISOString()} [${req.requestId || "n/a"}] CSRF ${req.method} ${req.originalUrl}\n`;
  errorLogStream.write(message);

  res.status(403).send("Your session form is invalid or expired. Please refresh and try again.");
});

app.use((error, req, res, next) => {
  const message = [
    `${new Date().toISOString()} [${req.requestId || "n/a"}] ${req.method} ${req.originalUrl}`,
    `Message: ${error && error.message ? error.message : "Unknown error"}`,
    error && error.stack ? error.stack : "No stack",
    "---"
  ].join("\n");
  errorLogStream.write(`${message}\n`);

  if (res.headersSent) {
    next(error);
    return;
  }

  res.status(500).send("Something went wrong. Please try again.");
});

async function startServer() {
  await initializeDatabase();

    if (BACKUP_INTERVAL_HOURS > 0) {
      const backupResult = createDatabaseBackup();
      if (backupResult.ok) {
        // eslint-disable-next-line no-console
        console.log(`Database backup created: ${backupResult.file}`);
      }

      const intervalMs = BACKUP_INTERVAL_HOURS * 60 * 60 * 1000;
      setInterval(createDatabaseBackup, intervalMs);
    }

    if (redisClient && !redisClient.isOpen) {
      try {
        await redisClient.connect();
        // eslint-disable-next-line no-console
        console.log("Redis session store connected.");
      } catch (error) {
        const message = `Redis connection failed: ${error.message}`;
        // eslint-disable-next-line no-console
        console.error(message);
        if (IS_PRODUCTION) {
          throw new Error(message);
        }
        // eslint-disable-next-line no-console
        console.warn("Continuing without Redis. Sessions will use SQLite instead.");
      }
    }

    return app.listen(PORT, () => {
      // eslint-disable-next-line no-console
      console.log(`Budget Planner running at http://localhost:${PORT}`);
    });
}

if (require.main === module) {
  startServer().catch((error) => {
    // eslint-disable-next-line no-console
    console.error("Database initialization failed:", error);
    process.exit(1);
  });
}

module.exports = {
  app,
  startServer,
  initializeDatabase,
  getCurrentMonthKey,
  parseMonthFromDate,
  isIsoDate,
  applyRecurringExpensesForMonth,
  createDatabaseBackup,
  getHealthSnapshot,
  run,
  get,
  all
};

