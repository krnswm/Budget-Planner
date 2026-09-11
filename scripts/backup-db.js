const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const rootDir = path.resolve(__dirname, "..");
const env = process.env.NODE_ENV || "development";
const envSpecificPath = path.join(rootDir, `.env.${env}`);

if (fs.existsSync(envSpecificPath)) {
  dotenv.config({ path: envSpecificPath });
}

dotenv.config({ path: path.join(rootDir, ".env") });

const dbFile = path.join(rootDir, "db", "budget.db");
const backupDirConfig = String(process.env.BACKUP_DIR || "backups").trim();
const backupDir = path.isAbsolute(backupDirConfig)
  ? backupDirConfig
  : path.join(rootDir, backupDirConfig);
const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS || 7);

function toTimestampKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function main() {
  if (!fs.existsSync(dbFile)) {
    console.error(`Database file not found: ${dbFile}`);
    process.exit(1);
  }

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const backupPath = path.join(backupDir, `budget-${toTimestampKey()}.sqlite`);
  fs.copyFileSync(dbFile, backupPath);

  const retentionCutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const backupFiles = fs
    .readdirSync(backupDir)
    .filter((fileName) => fileName.startsWith("budget-") && fileName.endsWith(".sqlite"));

  for (const fileName of backupFiles) {
    const filePath = path.join(backupDir, fileName);
    const stat = fs.statSync(filePath);
    if (stat.mtimeMs < retentionCutoff) {
      fs.unlinkSync(filePath);
    }
  }

  console.log(`Database backup created at: ${backupPath}`);
}

main();
