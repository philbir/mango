import { v4 as uuid } from "uuid";
import { decryptString, encryptString, redactUri } from "./crypto.js";
import { JsonFileStore } from "./jsonFile.js";

export interface AspireRef {
  appHostPath: string;
  resourceName: string;
}

/**
 * Origin marker — set when a connection is created from a discovery flow.
 * `null` means the user typed/built the URI by hand. Aspire uses its own
 * dedicated `aspire` ref instead of this field.
 */
export type ConnectionSource = "docker" | null;

export interface Connection {
  id: string;
  name: string;
  defaultDatabase: string | null;
  color: string | null;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
  aspire: AspireRef | null;
  source: ConnectionSource;
}

export interface ConnectionWithUri extends Connection {
  uri: string;
}

export interface ConnectionPublic extends Connection {
  uriRedacted: string;
  effectiveDefaultDatabase: string | null;
}

interface StoredConnection {
  id: string;
  name: string;
  uriEncrypted: string;
  defaultDatabase: string | null;
  color: string | null;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
  aspire: AspireRef | null;
  source: ConnectionSource;
}

interface ConnectionsFile {
  version: number;
  connections: StoredConnection[];
}

const store = new JsonFileStore<ConnectionsFile>("connections.json", () => ({
  version: 1,
  connections: [],
}));

const normalizeSource = (s: unknown): ConnectionSource =>
  s === "docker" ? "docker" : null;

const fromStored = (s: StoredConnection): Connection => ({
  id: s.id,
  name: s.name,
  defaultDatabase: s.defaultDatabase ?? null,
  color: s.color ?? null,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
  lastUsedAt: s.lastUsedAt ?? null,
  aspire: s.aspire ?? null,
  source: normalizeSource(s.source),
});

const toWithUri = (s: StoredConnection): ConnectionWithUri => ({
  ...fromStored(s),
  uri: decryptString(s.uriEncrypted),
});

const toPublic = (s: StoredConnection): ConnectionPublic | null => {
  let uri: string;
  try {
    uri = decryptString(s.uriEncrypted);
  } catch (e) {
    // The master key has changed since this row was written. The row is
    // unrecoverable — skip it from the list rather than crashing the whole
    // request. The undecryptable count is exposed via /api/system/key-health
    // so the UI can offer a reset action.
    console.warn(
      `[mango] could not decrypt connection ${s.id} (${s.name}) — ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return null;
  }
  return {
    ...fromStored(s),
    uriRedacted: redactUri(uri),
    effectiveDefaultDatabase: s.defaultDatabase ?? extractDbFromUri(uri),
  };
};

export interface CreateConnectionInput {
  name: string;
  uri: string;
  defaultDatabase?: string | null;
  color?: string | null;
  aspire?: AspireRef | null;
  source?: ConnectionSource;
}

export interface UpdateConnectionInput {
  name?: string;
  uri?: string;
  defaultDatabase?: string | null;
  color?: string | null;
  aspire?: AspireRef | null;
  source?: ConnectionSource;
}

const sortForList = (a: StoredConnection, b: StoredConnection): number => {
  // last_used_at DESC NULLS LAST, then name ASC
  if (a.lastUsedAt && b.lastUsedAt) return b.lastUsedAt - a.lastUsedAt;
  if (a.lastUsedAt) return -1;
  if (b.lastUsedAt) return 1;
  return a.name.localeCompare(b.name);
};

export const listConnections = (): ConnectionPublic[] => {
  const { connections } = store.read();
  return [...connections]
    .sort(sortForList)
    .map(toPublic)
    .filter((c): c is ConnectionPublic => c !== null);
};

/**
 * Count rows whose `uriEncrypted` cannot be decrypted with the current master
 * key. Used by the key-health probe — a non-zero count means the user's saved
 * connections are stranded and they should reset.
 */
export const countUndecryptableConnections = (): number => {
  const { connections } = store.read();
  let bad = 0;
  for (const c of connections) {
    try {
      decryptString(c.uriEncrypted);
    } catch {
      bad++;
    }
  }
  return bad;
};

/** Wipe every encrypted row. Called when the user opts to reset after a key mismatch. */
export const deleteAllConnections = (): number => {
  const before = store.read().connections.length;
  store.mutate((file) => ({ ...file, connections: [] }));
  return before;
};

export const getConnection = (id: string): ConnectionWithUri | null => {
  const found = store.read().connections.find((c) => c.id === id);
  return found ? toWithUri(found) : null;
};

export const getConnectionPublic = (id: string): ConnectionPublic | null => {
  const found = store.read().connections.find((c) => c.id === id);
  return found ? toPublic(found) : null;
};

export const createConnection = (input: CreateConnectionInput): ConnectionPublic => {
  const now = Date.now();
  const id = uuid();
  const stored: StoredConnection = {
    id,
    name: input.name,
    uriEncrypted: encryptString(input.uri),
    defaultDatabase: input.defaultDatabase ?? null,
    color: input.color ?? null,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
    aspire: input.aspire ?? null,
    source: input.source ?? null,
  };
  store.mutate((file) => ({
    ...file,
    connections: [...file.connections, stored],
  }));
  return getConnectionPublic(id)!;
};

export const updateConnection = (
  id: string,
  input: UpdateConnectionInput,
): ConnectionPublic | null => {
  const existing = store.read().connections.find((c) => c.id === id);
  if (!existing) return null;
  const now = Date.now();
  const next: StoredConnection = {
    ...existing,
    name: input.name ?? existing.name,
    uriEncrypted:
      input.uri !== undefined ? encryptString(input.uri) : existing.uriEncrypted,
    defaultDatabase:
      input.defaultDatabase !== undefined
        ? input.defaultDatabase
        : existing.defaultDatabase,
    color: input.color !== undefined ? input.color : existing.color,
    aspire: input.aspire !== undefined ? input.aspire ?? null : existing.aspire,
    source: input.source !== undefined ? input.source ?? null : existing.source,
    updatedAt: now,
  };
  store.mutate((file) => ({
    ...file,
    connections: file.connections.map((c) => (c.id === id ? next : c)),
  }));
  return getConnectionPublic(id);
};

export const deleteConnection = (id: string): boolean => {
  let removed = false;
  store.mutate((file) => {
    const next = file.connections.filter((c) => c.id !== id);
    removed = next.length !== file.connections.length;
    return { ...file, connections: next };
  });
  return removed;
};

export const touchConnection = (id: string): void => {
  const now = Date.now();
  store.mutate((file) => ({
    ...file,
    connections: file.connections.map((c) =>
      c.id === id ? { ...c, lastUsedAt: now } : c,
    ),
  }));
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
  const now = Date.now();
  const resolvedDb = defaultDatabase ?? extractDbFromUri(uri) ?? null;
  const uriEncrypted = encryptString(uri);
  store.mutate((file) => {
    const existing = file.connections.find((c) => c.id === id);
    const next: StoredConnection = existing
      ? {
          ...existing,
          uriEncrypted,
          defaultDatabase: resolvedDb,
          updatedAt: now,
        }
      : {
          id,
          name: "Default",
          uriEncrypted,
          defaultDatabase: resolvedDb,
          color: "#38bdf8",
          createdAt: now,
          updatedAt: now,
          lastUsedAt: null,
          aspire: null,
          source: null,
        };
    return {
      ...file,
      connections: existing
        ? file.connections.map((c) => (c.id === id ? next : c))
        : [...file.connections, next],
    };
  });
};

/**
 * Bootstrap a "Default" connection from MONGO_URL env when the table is empty.
 * Lets existing Aspire / Docker users keep working with no migration step.
 */
export const seedFromEnvIfEmpty = (): void => {
  if (store.read().connections.length > 0) return;
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
