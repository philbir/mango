import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const dataDir = (): string => {
  const explicit = process.env.MANGO_DATA_DIR;
  if (explicit) return explicit;
  // Default to a hidden folder next to the cwd. Tauri overrides this to
  // the OS app-data directory; Docker users mount a volume here.
  return path.resolve(process.cwd(), ".mango");
};

let cached: Database.Database | null = null;

export const getDb = (): Database.Database => {
  if (cached) return cached;
  const dir = dataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "mango.db");
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  cached = db;
  return db;
};

const runMigrations = (db: Database.Database) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER NOT NULL PRIMARY KEY
    );
  `);
  const current = db
    .prepare("SELECT MAX(version) AS v FROM schema_version")
    .get() as { v: number | null };
  const start = current.v ?? 0;

  const migrations: Array<{ version: number; up: string }> = [
    {
      version: 1,
      up: `
        CREATE TABLE connections (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          uri_encrypted TEXT NOT NULL,
          default_database TEXT,
          color TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          last_used_at INTEGER
        );
        CREATE INDEX idx_connections_name ON connections(name);
      `,
    },
  ];

  for (const m of migrations) {
    if (m.version <= start) continue;
    db.exec("BEGIN");
    try {
      db.exec(m.up);
      db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(m.version);
      db.exec("COMMIT");
      console.log(`[mango] applied migration v${m.version}`);
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
};
