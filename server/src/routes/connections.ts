import { Hono } from "hono";
import { MongoClient } from "mongodb";
import { z } from "zod";
import { closeMongoClient, getMongoClientFor } from "../config.js";
import { resolveServerConfig } from "../mode.js";
import {
  createConnection,
  deleteConnection,
  getConnectionPublic,
  listConnections,
  updateConnection,
} from "../store/connections.js";

export const connectionsRoute = new Hono();

const standaloneError = () => ({
  error: "Connection management is disabled in standalone mode",
});

const isStandalone = () => resolveServerConfig().mode === "standalone";

const createBody = z.object({
  name: z.string().min(1).max(100),
  uri: z.string().min(1),
  defaultDatabase: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
});

const updateBody = createBody.partial();

connectionsRoute.get("/", (c) => {
  return c.json({ connections: listConnections() });
});

connectionsRoute.post("/", async (c) => {
  if (isStandalone()) return c.json(standaloneError(), 403);
  const parsed = createBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Bad input" }, 400);
  }
  const created = createConnection(parsed.data);
  return c.json(created, 201);
});

connectionsRoute.get("/:id", (c) => {
  const id = c.req.param("id");
  const conn = getConnectionPublic(id);
  if (!conn) return c.json({ error: "Connection not found" }, 404);
  return c.json(conn);
});

connectionsRoute.patch("/:id", async (c) => {
  if (isStandalone()) return c.json(standaloneError(), 403);
  const id = c.req.param("id");
  const parsed = updateBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Bad input" }, 400);
  }
  const updated = updateConnection(id, parsed.data);
  if (!updated) return c.json({ error: "Connection not found" }, 404);
  if (parsed.data.uri !== undefined) {
    // Force reconnect with new URI on next request
    await closeMongoClient(id);
  }
  return c.json(updated);
});

connectionsRoute.delete("/:id", async (c) => {
  if (isStandalone()) return c.json(standaloneError(), 403);
  const id = c.req.param("id");
  await closeMongoClient(id);
  const removed = deleteConnection(id);
  if (!removed) return c.json({ error: "Connection not found" }, 404);
  return c.body(null, 204);
});

connectionsRoute.post("/:id/test", async (c) => {
  const id = c.req.param("id");
  try {
    const { client, defaultDatabase } = await getMongoClientFor(id);
    const dbName = defaultDatabase ?? "admin";
    const result = await client.db(dbName).command({ ping: 1 });
    return c.json({ ok: true, ping: result });
  } catch (e) {
    return c.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      400,
    );
  }
});

/**
 * Quick-test a URI without saving it (used by the "New connection" form).
 */
connectionsRoute.post("/test-uri", async (c) => {
  const body = z
    .object({ uri: z.string().min(1) })
    .safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) {
    return c.json({ error: body.error.issues[0]?.message ?? "Bad input" }, 400);
  }
  const client = new MongoClient(body.data.uri, {
    serverSelectionTimeoutMS: 5_000,
  });
  try {
    await client.connect();
    const result = await client.db("admin").command({ ping: 1 });
    return c.json({ ok: true, ping: result });
  } catch (e) {
    return c.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      400,
    );
  } finally {
    await client.close().catch(() => {});
  }
});

connectionsRoute.get("/:id/databases", async (c) => {
  const id = c.req.param("id");
  const { client } = await getMongoClientFor(id);
  const result = (await client.db("admin").command({ listDatabases: 1 })) as {
    databases: Array<{ name: string; sizeOnDisk?: number; empty?: boolean }>;
  };
  return c.json({
    databases: result.databases.map((d) => ({
      name: d.name,
      sizeOnDisk: d.sizeOnDisk ?? null,
      empty: !!d.empty,
    })),
  });
});
