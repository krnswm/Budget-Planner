const { Pool, types } = require("@neondatabase/serverless");

// DATE columns must keep reaching the client as 'YYYY-MM-DD' strings. The
// default parser returns a JS Date, which JSON.stringify would render as a
// full UTC timestamp and shift the day for anyone east of UTC. spent_on is a
// calendar date, not an instant, so the raw string is the correct value.
types.setTypeParser(1082, (value) => value);

// NUMERIC is intentionally left as a string. node-postgres refuses to parse it
// into a float precisely because that would lose precision, and every call
// site already wraps amounts in Number() at the JSON boundary.

let pool = null;

function getPool() {
  if (pool) {
    return pool;
  }

  const connectionString = String(process.env.DATABASE_URL || "").trim();

  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy the pooled connection string from your Neon dashboard into .env.");
  }

  if (!connectionString.includes("-pooler")) {
    // Not fatal, but the direct endpoint runs out of connections quickly once
    // several serverless invocations are warm at the same time.
    console.warn("DATABASE_URL does not look like a pooled Neon endpoint (no '-pooler' in the host). Enable Connection pooling in the Neon dashboard.");
  }

  pool = new Pool({ connectionString });

  pool.on("error", (error) => {
    console.error("Postgres pool error:", error.message);
  });

  return pool;
}

/**
 * Rewrites SQLite-style `?` placeholders into Postgres `$1, $2, ...`.
 *
 * Doing this in the driver keeps roughly forty existing queries untouched:
 * only genuinely dialect-specific SQL had to be rewritten by hand. The scanner
 * skips anything where a `?` is not a placeholder -- string literals, quoted
 * identifiers, dollar-quoted blocks and both comment styles.
 */
function toPositionalParams(sql) {
  let output = "";
  let index = 0;
  let position = 0;

  while (position < sql.length) {
    const char = sql[position];
    const next = sql[position + 1];

    // -- line comment
    if (char === "-" && next === "-") {
      const end = sql.indexOf("\n", position);
      const stop = end === -1 ? sql.length : end;
      output += sql.slice(position, stop);
      position = stop;
      continue;
    }

    // /* block comment */ (Postgres allows nesting)
    if (char === "/" && next === "*") {
      let depth = 1;
      let scan = position + 2;
      while (scan < sql.length && depth > 0) {
        if (sql[scan] === "/" && sql[scan + 1] === "*") {
          depth += 1;
          scan += 2;
        } else if (sql[scan] === "*" && sql[scan + 1] === "/") {
          depth -= 1;
          scan += 2;
        } else {
          scan += 1;
        }
      }
      output += sql.slice(position, scan);
      position = scan;
      continue;
    }

    // 'string literal', where '' is an escaped quote
    if (char === "'") {
      let scan = position + 1;
      while (scan < sql.length) {
        if (sql[scan] === "'" && sql[scan + 1] === "'") {
          scan += 2;
          continue;
        }
        if (sql[scan] === "'") {
          scan += 1;
          break;
        }
        scan += 1;
      }
      output += sql.slice(position, scan);
      position = scan;
      continue;
    }

    // "quoted identifier"
    if (char === '"') {
      let scan = position + 1;
      while (scan < sql.length && sql[scan] !== '"') {
        scan += 1;
      }
      output += sql.slice(position, scan + 1);
      position = scan + 1;
      continue;
    }

    // $tag$ dollar-quoted string $tag$
    if (char === "$") {
      const opener = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(position));
      if (opener) {
        const tag = opener[0];
        const end = sql.indexOf(tag, position + tag.length);
        const stop = end === -1 ? sql.length : end + tag.length;
        output += sql.slice(position, stop);
        position = stop;
        continue;
      }
    }

    if (char === "?") {
      index += 1;
      output += `$${index}`;
      position += 1;
      continue;
    }

    output += char;
    position += 1;
  }

  return output;
}

async function query(sql, params = [], client = null) {
  const executor = client || getPool();
  return executor.query(toPositionalParams(sql), params);
}

/**
 * Mirrors the old sqlite3 helper. `changes` replaces this.changes; `lastID`
 * is populated only when the statement carries a RETURNING id clause.
 */
async function run(sql, params = [], client = null) {
  const result = await query(sql, params, client);
  const returned = result.rows && result.rows[0];

  return {
    changes: result.rowCount,
    lastID: returned && returned.id !== undefined ? returned.id : undefined,
    rows: result.rows
  };
}

async function get(sql, params = [], client = null) {
  const result = await query(sql, params, client);
  return result.rows[0];
}

async function all(sql, params = [], client = null) {
  const result = await query(sql, params, client);
  return result.rows;
}

/**
 * Runs `callback` inside a single transaction on one dedicated connection.
 * The callback receives scoped run/get/all helpers -- using the module-level
 * ones inside a transaction would silently take a different pooled
 * connection and execute outside it.
 */
async function transaction(callback) {
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    const result = await callback({
      run: (sql, params) => run(sql, params, client),
      get: (sql, params) => get(sql, params, client),
      all: (sql, params) => all(sql, params, client)
    });
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The connection is already broken; the original error is what matters.
    }
    throw error;
  } finally {
    client.release();
  }
}

async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  run,
  get,
  all,
  query,
  transaction,
  closeDatabase,
  getPool,
  toPositionalParams
};
