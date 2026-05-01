import { MongoClient } from "mongodb";
import { getConnection, touchConnection } from "./store/connections.js";

export const config = {
  port: Number(process.env.PORT ?? 5180),
  staticDir: process.env.STATIC_DIR ?? "./public",
};

interface CachedClient {
  client: MongoClient;
  defaultDatabase: string | null;
}

const clients = new Map<string, CachedClient>();

/**
 * Resolve a Mongo client for a connection ID. Connection details are loaded
 * from SQLite; the MongoClient itself is cached per connection.
 */
export const getMongoClientFor = async (
  connectionId: string,
): Promise<{ client: MongoClient; defaultDatabase: string | null }> => {
  const cached = clients.get(connectionId);
  if (cached) {
    touchConnection(connectionId);
    return cached;
  }

  const conn = getConnection(connectionId);
  if (!conn) {
    throw new Error(`Connection not found: ${connectionId}`);
  }
  const client = new MongoClient(conn.uri, {
    serverSelectionTimeoutMS: 5_000,
  });
  await client.connect();
  const entry: CachedClient = { client, defaultDatabase: conn.defaultDatabase };
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
