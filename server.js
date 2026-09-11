require("./lib/load-env");

const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const express = require("express");
const morgan = require("morgan");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const { RedisStore } = require("connect-redis");
const { createClient } = require("redis");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const rateLimit = require("express-rate-limit");
const csrf = require("csurf");
// Data access. run/get/all keep the signatures the old sqlite3 helpers had,
// and lib/db.js rewrites `?` placeholders into `$1, $2, ...`, so the route
// modules did not need re-parameterising. Schema lives in migrations/ and is
// applied with `npm run migrate`, rather than being mutated at every boot.
const { run, get, all, transaction, closeDatabase, getPool } = require("./lib/db");
const registerSpaApiRoutes = require("./routes/register-spa-api-routes");
const registerAuthRoutes = require("./routes/register-auth-routes");
const registerReportRoutes = require("./routes/register-report-routes");

const app = express();
const NODE_ENV = process.env.NODE_ENV || "development";
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = NODE_ENV === "production";
const SESSION_COOKIE_SAMESITE = process.env.SESSION_COOKIE_SAMESITE || "lax";
const SESSION_SECRET = String(process.env.SESSION_SECRET || "").trim();
const APP_DOMAIN = String(process.env.APP_DOMAIN || "").trim().toLowerCase();
const FORCE_HTTPS = process.env.FORCE_HTTPS === "true" || IS_PRODUCTION;
const TRUST_PROXY = Number(process.env.TRUST_PROXY || 1);
const EXPENSE_CATEGORIES = ["Food", "Travel", "Bills", "Shopping", "Health", "Education", "Other"];
const GOOGLE_AUTH_VARS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_CALLBACK_URL"];
const GOOGLE_AUTH_SET = GOOGLE_AUTH_VARS.filter((name) => String(process.env[name] || "").trim());
const GOOGLE_AUTH_ENABLED = GOOGLE_AUTH_SET.length === GOOGLE_AUTH_VARS.length;
const reactDistDir = path.join(__dirname, "client", "dist");
const reactIndexFile = path.join(reactDistDir, "index.html");

if (IS_PRODUCTION && SESSION_SECRET.length < 32) {
  throw new Error("SESSION_SECRET must be set to a strong value (at least 32 characters) in production.");
}

if (IS_PRODUCTION && !process.env.APP_BASE_URL) {
  throw new Error("APP_BASE_URL must be set in production.");
}

// A partial Google config is almost always a mistake: sign-in silently
// disappears from the login page instead of failing. Catch it at boot.
if (GOOGLE_AUTH_SET.length > 0 && !GOOGLE_AUTH_ENABLED) {
  const missing = GOOGLE_AUTH_VARS.filter((name) => !GOOGLE_AUTH_SET.includes(name));
  throw new Error(
    `Google sign-in is partially configured. Set ${missing.join(", ")} as well, or unset ${GOOGLE_AUTH_SET.join(", ")} to disable it.`
  );
}

// Logs go to stdout/stderr, not files. The previous setup appended to
// logs/access.log and logs/error.log, which fails outright on a read-only
// serverless filesystem and grew without bound anywhere else. Vercel,
// systemd, Docker and a plain terminal all capture the standard streams.
const accessLogStream = { write: (line) => process.stdout.write(line) };

function logError(message) {
  process.stderr.write(message.endsWith("\n") ? message : `${message}\n`);
}

// Redis is optional; without REDIS_URL, sessions live in Postgres.
//
// The REDIS_AUTO_WSL branch that used to sit here shelled out to
// `wsl -d Ubuntu -- hostname -I` via execSync during module load, to guess a
// WSL IP on Windows. A synchronous subprocess at boot is the wrong thing
// anywhere, and impossible on serverless. Point REDIS_URL at the right host.
const RESOLVED_REDIS_URL = String(process.env.REDIS_URL || "").trim();
const USE_REDIS_SESSIONS = Boolean(RESOLVED_REDIS_URL);

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

// The file-copy backup system is gone. It copied a live SQLite file with
// fs.copyFileSync, which can capture a torn page, and drove itself from a
// setInterval that cannot run on serverless at all. Neon provides
// point-in-time restore; scripts/export-db.js takes a manual dump.

// Declared ahead of getHealthSnapshot() so that function does not reference
// a binding defined later in the file.
let redisClient = null;
let sessionStore = null;

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
  const daysInMonth = getDaysInMonthFromKey(monthKey);

  return transaction(async (tx) => {
    // Claim every rule still owed for this month in one statement, then
    // insert only what was actually claimed. This runs from GET handlers, so
    // two concurrent page loads used to read the same unapplied rules and
    // insert the expense twice; whichever request claims a row now wins, and
    // the other sees nothing to do.
    const claimed = await tx.all(
      `
        UPDATE recurring_expenses
        SET last_applied_month = ?
        WHERE user_id = ?
          AND is_active = TRUE
          AND last_applied_month IS DISTINCT FROM ?
        RETURNING id, label, amount, category, note, day_of_month
      `,
      [monthKey, userId, monthKey]
    );

    for (const item of claimed) {
      // A rule set for the 31st must still fire in a 30-day month, and in
      // February. Clamp to the last real day rather than building an
      // impossible date like 2026-02-31.
      const effectiveDay = Math.min(item.day_of_month, daysInMonth);
      const spentOn = `${monthKey}-${String(effectiveDay).padStart(2, "0")}`;

      await tx.run(
        "INSERT INTO expenses (user_id, month_key, amount, label, category, note, spent_on) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [userId, monthKey, item.amount, item.label, item.category || "Other", item.note || null, spentOn]
      );
    }

    return claimed.length;
  });
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

if (USE_REDIS_SESSIONS) {
  redisClient = createClient({
    url: RESOLVED_REDIS_URL
  });

  redisClient.on("error", (error) => {
    console.error("Redis session client error:", error.message);
  });

  sessionStore = new RedisStore({
    client: redisClient,
    prefix: "budget:sess:"
  });
} else {
  // Sessions live in Postgres rather than a file. connect-sqlite3 wrote to
  // db/sessions.db, which cannot work on a read-only serverless filesystem:
  // logins would appear to succeed and then evaporate.
  sessionStore = new PgSession({
    pool: getPool(),
    tableName: "session",
    createTableIfMissing: false, // migrations/002 owns this table
    pruneSessionInterval: 60 * 60 // sweep expired rows hourly
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
            "INSERT INTO users (email, password_hash, google_id, full_name) VALUES (?, ?, ?, ?) RETURNING id",
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
  logError(message);

  res.status(403).send("Your session form is invalid or expired. Please refresh and try again.");
});

app.use((error, req, res, next) => {
  const message = [
    `${new Date().toISOString()} [${req.requestId || "n/a"}] ${req.method} ${req.originalUrl}`,
    `Message: ${error && error.message ? error.message : "Unknown error"}`,
    error && error.stack ? error.stack : "No stack",
    "---"
  ].join("\n");
  logError(message);

  if (res.headersSent) {
    next(error);
    return;
  }

  res.status(500).send("Something went wrong. Please try again.");
});

async function startServer() {
  // Schema is applied by `npm run migrate`, not at boot. Fail early with a
  // message that names the actual problem, since "cannot reach the database"
  // and "reached it but it has no schema" need different fixes.
  if (!String(process.env.DATABASE_URL || "").trim()) {
    throw new Error("DATABASE_URL is not set. Copy the pooled connection string from your Neon dashboard into .env.");
  }

  try {
    await get("SELECT 1 FROM schema_migrations LIMIT 1");
  } catch (error) {
    if (/relation .*schema_migrations.* does not exist/i.test(error.message)) {
      throw new Error("Database has no schema yet. Run: npm run migrate");
    }
    throw new Error(`Cannot reach the database: ${error.message}`);
  }

  if (redisClient && !redisClient.isOpen) {
    try {
      await redisClient.connect();
      console.log("Redis session store connected.");
    } catch (error) {
      const message = `Redis connection failed: ${error.message}`;
      console.error(message);
      if (IS_PRODUCTION) {
        throw new Error(message);
      }
      console.warn("Continuing without Redis. Sessions will use SQLite instead.");
    }
  }

  return app.listen(PORT, () => {
    console.log(`Budget Planner running at http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error("Startup failed:", error.message);
    process.exit(1);
  });
}

module.exports = {
  app,
  startServer,
  closeDatabase,
  getCurrentMonthKey,
  parseMonthFromDate,
  isIsoDate,
  applyRecurringExpensesForMonth,
  getHealthSnapshot,
  run,
  get,
  all
};

