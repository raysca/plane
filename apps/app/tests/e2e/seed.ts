import { Database } from "bun:sqlite";

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("Usage: bun seed.ts <db-path>");
  process.exit(1);
}

const db = new Database(dbPath);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

const now = Math.floor(Date.now() / 1000);

db.run(
  `INSERT OR IGNORE INTO instances (id, instance_name, is_setup_done, is_signup_screen_visited, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?)`,
  ["test-instance-id", "Test Instance", 1, 1, now, now]
);

console.log("[seed] Instance seeded at", dbPath);
db.close();
