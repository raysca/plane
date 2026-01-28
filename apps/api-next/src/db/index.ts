import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import * as schema from "./schema";

// Create database directory if it doesn't exist
const dbPath = process.env.DATABASE_URL?.replace("file:", "") || "./data/plane.db";
const dbDir = dbPath.substring(0, dbPath.lastIndexOf("/"));
if (dbDir) {
  await Bun.write(dbDir + "/.gitkeep", "");
}

// Initialize SQLite database
const sqlite = new Database(dbPath, { create: true });

// Enable WAL mode for better concurrent performance
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");
sqlite.exec("PRAGMA busy_timeout = 5000;");

// Create Drizzle instance
export const db = drizzle(sqlite, { schema });

// Export for type inference
export type Database = typeof db;
