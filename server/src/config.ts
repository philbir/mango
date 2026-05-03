import { MongoClient } from "mongodb";
import { resolveAspireConnectionUri } from "./aspire.js";
import { sanitizeMongoUri } from "./security.js";
import { getConnection, touchConnection } from "./store/connections.js";

export const config = {
  port: Number(process.env.PORT ?? 5180),
  host: process.env.HOST ?? process.env.MANGO_HOST ?? "127.0.0.1",
  staticDir: process.env.STATIC_DIR ?? "./public",
  mongoMaxTimeMS: Number(process.env.MANGO_MONGO_MAX_TIME_MS ?? 10_000),
  consoleTimeoutMS: Number(process.env.MANGO_CONSOLE_TIMEOUT_MS ?? 1_000),
  jsConsoleEnabled: process.env.MANGO_DISABLE_JS_CONSOLE !== "true",
};

interface CachedClient {
  client: MongoClient;
  defaultDatabase: string | null;
  uri: string;
}

const clients = new Map<string, CachedClient>();
const ASPIRE_CACHE_MS = 30_000;
const aspireUriCache = new Map<string, { uri: string; ts: number }>();

const resolveUriForConnection = async (connectionId: string): Promise<{
  uri: string;
  defaultDatabase: string | null;
} | null> => {
  const conn = getConnection(connectionId);
  if (!conn) return null;
  if (!conn.aspire) {
    return { uri: conn.uri, defaultDatabase: conn.defaultDatabase };
  }
  const cached = aspireUriCache.get(connectionId);
  if (cached && Date.now() - cached.ts < ASPIRE_CACHE_MS) {
    return { uri: cached.uri, defaultDatabase: conn.defaultDatabase };
  }
  const fresh = await resolveAspireConnectionUri(
    conn.aspire.appHostPath,
    conn.aspire.resourceName,
  );
  aspireUriCache.set(connectionId, { uri: fresh, ts: Date.now() });
  return { uri: fresh, defaultDatabase: conn.defaultDatabase };
};

/**
 * Resolve a Mongo client for a connection ID. Connection details are loaded
 * from the JSON store; the MongoClient itself is cached per connection. For
 * aspire-backed connections the URI is re-resolved on a TTL — when it
 * changes (port rotation between `aspire run`s), the cached client is
 * dropped and a fresh one is opened.
 */
export const getMongoClientFor = async (
  connectionId: string,
): Promise<{ client: MongoClient; defaultDatabase: string | null }> => {
  const resolved = await resolveUriForConnection(connectionId);
  if (!resolved) throw new Error(`Connection not found: ${connectionId}`);

  const cached = clients.get(connectionId);
  if (cached && cached.uri === resolved.uri) {
    touchConnection(connectionId);
    return cached;
  }
  if (cached && cached.uri !== resolved.uri) {
    clients.delete(connectionId);
    cached.client.close().catch(() => {});
  }

  const client = new MongoClient(sanitizeMongoUri(resolved.uri), {
    serverSelectionTimeoutMS: 5_000,
  });
  await client.connect();
  const entry: CachedClient = {
    client,
    defaultDatabase: resolved.defaultDatabase,
    uri: resolved.uri,
  };
  clients.set(connectionId, entry);
  touchConnection(connectionId);
  return entry;
};

export const databaseNameFor = (
  connectionId: string,
  override?: string | null,
): string => {
  if (override) return override;
  const cached = clients.get(connectionId);
  if (cached?.defaultDatabase) return cached.defaultDatabase;
  const conn = getConnection(connectionId);
  if (conn?.defaultDatabase) return conn.defaultDatabase;
  if (conn) {
    try {
      const url = new URL(conn.uri.replace(/^mongodb(\+srv)?:\/\//, "http://"));
      const path = url.pathname.replace(/^\//, "").split("?")[0];
      if (path) return path;
    } catch {
      /* fall through */
    }
  }
  return "test";
};

export const closeMongoClient = async (connectionId: string): Promise<void> => {
  aspireUriCache.delete(connectionId);
  const cached = clients.get(connectionId);
  if (!cached) return;
  clients.delete(connectionId);
  await cached.client.close().catch(() => {
    /* ignore */
  });
};

export const closeAllClients = async (): Promise<void> => {
  const all = Array.from(clients.entries());
  clients.clear();
  await Promise.all(all.map(([, c]) => c.client.close().catch(() => {})));
};
