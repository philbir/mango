import { Hono } from "hono";
import { MongoClient } from "mongodb";
import { z } from "zod";
import { closeMongoClient, getMongoClientFor } from "../config.js";
import { resolveServerConfig, STANDALONE_CONNECTION_ID } from "../mode.js";
import {
  redactErrorMessage,
  sanitizeMongoUri,
  validateMongoUri,
} from "../security.js";
import {
  createConnection,
  deleteConnection,
  getConnection,
  getConnectionPublic,
  listConnections,
  updateConnection,
} from "../store/connections.js";

export const connectionsRoute = new Hono();

const standaloneError = () => ({
  error: "Connection management is disabled in standalone mode",
});

const isStandalone = () => resolveServerConfig().mode === "standalone";

const aspireRefSchema = z
  .object({
    appHostPath: z.string().min(1),
    resourceName: z.string().min(1),
  })
  .nullable();

const sourceSchema = z.enum(["docker"]).nullable().optional();

const createBody = z.object({
  name: z.string().min(1).max(100),
  uri: z.string().min(1),
  defaultDatabase: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  aspire: aspireRefSchema.optional(),
  source: sourceSchema,
});

const updateBody = createBody.partial();

connectionsRoute.get("/", (c) => {
  const all = listConnections();
  if (isStandalone()) {
    return c.json({
      connections: all.filter((conn) => conn.id === STANDALONE_CONNECTION_ID),
    });
  }
  return c.json({ connections: all });
});

connectionsRoute.post("/", async (c) => {
  if (isStandalone()) return c.json(standaloneError(), 403);
  const parsed = createBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Bad input" }, 400);
  }
  const uri = sanitizeMongoUri(parsed.data.uri);
  const uriError = validateMongoUri(uri);
  if (uriError) return c.json({ error: uriError }, 400);
  const created = createConnection({ ...parsed.data, uri });
  return c.json(created, 201);
});

connectionsRoute.get("/:id", (c) => {
  const id = c.req.param("id");
  const conn = getConnectionPublic(id);
  if (!conn) return c.json({ error: "Connection not found" }, 404);
  return c.json(conn);
});

/**
 * Reveal the decrypted URI for the edit form. Mango binds to localhost by
 * default and there's no auth layer, so this is no more sensitive than what
 * `/test` already exposes — but we keep it on a dedicated path for clarity.
 */
connectionsRoute.get("/:id/secret", (c) => {
  if (isStandalone()) return c.json(standaloneError(), 403);
  const id = c.req.param("id");
  const conn = getConnection(id);
  if (!conn) return c.json({ error: "Connection not found" }, 404);
  return c.json({ uri: conn.uri });
});

connectionsRoute.patch("/:id", async (c) => {
  if (isStandalone()) return c.json(standaloneError(), 403);
  const id = c.req.param("id");
  const parsed = updateBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Bad input" }, 400);
  }
  const cleaned = { ...parsed.data };
  if (cleaned.uri !== undefined) {
    cleaned.uri = sanitizeMongoUri(cleaned.uri);
    const uriError = validateMongoUri(cleaned.uri);
    if (uriError) return c.json({ error: uriError }, 400);
  }
  const updated = updateConnection(id, cleaned);
  if (!updated) return c.json({ error: "Connection not found" }, 404);
  if (cleaned.uri !== undefined) {
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
    return c.json({ ok: false, error: redactErrorMessage(e) }, 400);
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
  const cleaned = sanitizeMongoUri(body.data.uri);
  const uriError = validateMongoUri(cleaned);
  if (uriError) return c.json({ error: uriError }, 400);
  const client = new MongoClient(cleaned, {
    serverSelectionTimeoutMS: 5_000,
  });
  try {
    await client.connect();
    const result = await client.db("admin").command({ ping: 1 });
    return c.json({ ok: true, ping: result });
  } catch (e) {
    return c.json({ ok: false, error: redactErrorMessage(e) }, 400);
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
