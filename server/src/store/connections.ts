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

const rowToPublic = (row: ConnectionRow): ConnectionPublic => ({
  ...rowToConnection(row),
  uriRedacted: redactUri(decryptString(row.uri_encrypted)),
});

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
  return rows.map(rowToPublic);
};

export const getConnection = (id: string): ConnectionWithUri | null => {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM connections WHERE id = ?")
    .get(id) as ConnectionRow | undefined;
  return row ? rowToWithUri(row) : null;
};

export const getConnectionPublic = (id: string): ConnectionPublic | null => {
  const c = getConnection(id);
  if (!c) return null;
  return { ...c, uriRedacted: redactUri(c.uri), uri: undefined as unknown as string } as unknown as ConnectionPublic;
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
