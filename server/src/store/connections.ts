import { v4 as uuid } from "uuid";
import { decryptString, encryptString, redactUri } from "./crypto.js";
import { getDb } from "./db.js";

export interface Connection {
  id: string;
  name: string;
  defaultDatabase: string | null;
  color: string | null;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
}

export interface ConnectionWithUri extends Connection {
  uri: string;
}

export interface ConnectionPublic extends Connection {
  uriRedacted: string;
  effectiveDefaultDatabase: string | null;
}

interface ConnectionRow {
  id: string;
  name: string;
  uri_encrypted: string;
  default_database: string | null;
  color: string | null;
  created_at: number;
  updated_at: number;
  last_used_at: number | null;
}

const rowToConnection = (row: ConnectionRow): Connection => ({
  id: row.id,
  name: row.name,
  defaultDatabase: row.default_database,
  color: row.color,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lastUsedAt: row.last_used_at,
});

const rowToWithUri = (row: ConnectionRow): ConnectionWithUri => ({
  ...rowToConnection(row),
  uri: decryptString(row.uri_encrypted),
});

const rowToPublic = (row: ConnectionRow): ConnectionPublic | null => {
  let uri: string;
  try {
    uri = decryptString(row.uri_encrypted);
  } catch (e) {
    // The master key has changed since this row was written. The row is
    // unrecoverable — skip it from the list rather than crashing the whole
    // request. The undecryptable count is exposed via /api/system/key-health
    // so the UI can offer a reset action.
    console.warn(
      `[mango] could not decrypt connection ${row.id} (${row.name}) — ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return null;
  }
  return {
    ...rowToConnection(row),
    uriRedacted: redactUri(uri),
    effectiveDefaultDatabase: row.default_database ?? extractDbFromUri(uri),
  };
};

export interface CreateConnectionInput {
  name: string;
  uri: string;
  defaultDatabase?: string | null;
  color?: string | null;
}

export interface UpdateConnectionInput {
  name?: string;
  uri?: string;
  defaultDatabase?: string | null;
  color?: string | null;
}

export const listConnections = (): ConnectionPublic[] => {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT * FROM connections ORDER BY last_used_at DESC NULLS LAST, name ASC",
    )
    .all() as ConnectionRow[];
  return rows.map(rowToPublic).filter((c): c is ConnectionPublic => c !== null);
};

/**
 * Count rows whose `uri_encrypted` cannot be decrypted with the current master
 * key. Used by the key-health probe — a non-zero count means the user's saved
 * connections are stranded and they should reset.
 */
export const countUndecryptableConnections = (): number => {
  const db = getDb();
  const rows = db
    .prepare("SELECT uri_encrypted FROM connections")
    .all() as Array<{ uri_encrypted: string }>;
  let bad = 0;
  for (const row of rows) {
    try {
      decryptString(row.uri_encrypted);
    } catch {
      bad++;
    }
  }
  return bad;
};

/** Wipe every encrypted row. Called when the user opts to reset after a key mismatch. */
export const deleteAllConnections = (): number => {
  const db = getDb();
  const result = db.prepare("DELETE FROM connections").run();
  return result.changes;
};

export const getConnection = (id: string): ConnectionWithUri | null => {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM connections WHERE id = ?")
    .get(id) as ConnectionRow | undefined;
  return row ? rowToWithUri(row) : null;
};

export const getConnectionPublic = (id: string): ConnectionPublic | null => {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM connections WHERE id = ?")
    .get(id) as ConnectionRow | undefined;
  return row ? rowToPublic(row) : null;
};

export const createConnection = (input: CreateConnectionInput): ConnectionPublic => {
  const db = getDb();
  const now = Date.now();
  const id = uuid();
  db.prepare(
    `INSERT INTO connections
       (id, name, uri_encrypted, default_database, color, created_at, updated_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).run(
    id,
    input.name,
    encryptString(input.uri),
    input.defaultDatabase ?? null,
    input.color ?? null,
    now,
    now,
  );
  return getConnectionPublic(id)!;
};

export const updateConnection = (
  id: string,
  input: UpdateConnectionInput,
): ConnectionPublic | null => {
  const db = getDb();
  const existing = db
    .prepare("SELECT * FROM connections WHERE id = ?")
    .get(id) as ConnectionRow | undefined;
  if (!existing) return null;
  const now = Date.now();
  db.prepare(
    `UPDATE connections SET
       name = ?, uri_encrypted = ?, default_database = ?, color = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    input.name ?? existing.name,
    input.uri !== undefined ? encryptString(input.uri) : existing.uri_encrypted,
    input.defaultDatabase !== undefined
      ? input.defaultDatabase
      : existing.default_database,
    input.color !== undefined ? input.color : existing.color,
    now,
    id,
  );
  return getConnectionPublic(id);
};

export const deleteConnection = (id: string): boolean => {
  const db = getDb();
  const r = db.prepare("DELETE FROM connections WHERE id = ?").run(id);
  return r.changes > 0;
};

export const touchConnection = (id: string): void => {
  const db = getDb();
  db.prepare("UPDATE connections SET last_used_at = ? WHERE id = ?").run(
    Date.now(),
    id,
  );
};

/**
 * Upsert the standalone-mode connection (fixed ID) from env on every boot, so
 * MONGO_URL changes win without requiring a fresh data dir.
 */
export const upsertStandaloneConnection = (
  id: string,
  uri: string,
  defaultDatabase?: string | null,
): void => {
  const db = getDb();
  const now = Date.now();
  const resolvedDb = defaultDatabase ?? extractDbFromUri(uri) ?? null;
  db.prepare(
    `INSERT INTO connections
       (id, name, uri_encrypted, default_database, color, created_at, updated_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
       uri_encrypted = excluded.uri_encrypted,
       default_database = excluded.default_database,
       updated_at = excluded.updated_at`,
  ).run(id, "Default", encryptString(uri), resolvedDb, "#38bdf8", now, now);
};

/**
 * Bootstrap a "Default" connection from MONGO_URL env when the table is empty.
 * Lets existing Aspire / Docker users keep working with no migration step.
 */
export const seedFromEnvIfEmpty = (): void => {
  const db = getDb();
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM connections")
    .get() as { n: number };
  if (row.n > 0) return;
  const uri = process.env.MONGO_URL;
  if (!uri) return;
  const defaultDb = process.env.MONGO_DB || extractDbFromUri(uri) || null;
  createConnection({
    name: "Default",
    uri,
    defaultDatabase: defaultDb,
    color: "#38bdf8",
  });
  console.log("[mango] seeded Default connection from MONGO_URL");
};

const extractDbFromUri = (uri: string): string | null => {
  try {
    const url = new URL(uri.replace(/^mongodb(\+srv)?:\/\//, "http://"));
    const path = url.pathname.replace(/^\//, "").split("?")[0];
    return path || null;
  } catch {
    return null;
  }
};
