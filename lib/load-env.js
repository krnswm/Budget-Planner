// Shared env loading, so the server and every script agree on precedence.
//
// .env.<NODE_ENV> wins over .env, because dotenv does not overwrite a
// variable that is already set.

const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");

const rootDir = path.join(__dirname, "..");
const nodeEnv = process.env.NODE_ENV || "development";
const envSpecificPath = path.join(rootDir, `.env.${nodeEnv}`);

if (fs.existsSync(envSpecificPath)) {
  dotenv.config({ path: envSpecificPath });
}

dotenv.config({ path: path.join(rootDir, ".env") });
