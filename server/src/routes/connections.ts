import { Hono } from "hono";
import { MongoClient } from "mongodb";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import {
  buildMongoClientOptions,
  closeMongoClient,
  getMongoClientFor,
  prepareOidcBrowserAuth,
  reopenOidcBrowserAuth,
} from "../config.js";
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

const oidcProviderSchema = z.enum(["azure-cli", "azure-browser"]).nullable().optional();
const oidcBrowserSchema = z
  .enum(["chrome", "edge", "firefox", "safari"])
  .nullable()
  .optional();

const createBody = z.object({
  name: z.string().min(1).max(100),
  uri: z.string().min(1),
  defaultDatabase: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  aspire: aspireRefSchema.optional(),
  source: sourceSchema,
  oidcProvider: oidcProviderSchema,
  oidcTokenAudience: z.string().optional().nullable(),
  azureClientId: z.string().optional().nullable(),
  azureTenantId: z.string().optional().nullable(),
  oidcBrowser: oidcBrowserSchema,
  oidcBrowserProfile: z.string().optional().nullable(),
});

const updateBody = createBody.partial();
const prepareOidcAuthBody = z.object({
  oidcBrowser: oidcBrowserSchema,
  oidcBrowserProfile: z.string().optional().nullable(),
  forceRestart: z.boolean().optional(),
});

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

connectionsRoute.post("/:id/oidc/browser-auth", async (c) => {
  const id = c.req.param("id");
  const conn = getConnection(id);
  if (!conn) return c.json({ error: "Connection not found" }, 404);
  const parsed = prepareOidcAuthBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Bad input" }, 400);
  }
  prepareOidcBrowserAuth(
    id,
    {
      browser: parsed.data.oidcBrowser ?? null,
      profile: parsed.data.oidcBrowserProfile ?? null,
    },
    { forceRestart: parsed.data.forceRestart },
  );
  return c.json({ ok: true });
});

connectionsRoute.post("/:id/oidc/browser-auth/reopen", async (c) => {
  const id = c.req.param("id");
  const parsed = prepareOidcAuthBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Bad input" }, 400);
  }
  try {
    await reopenOidcBrowserAuth(id, {
      browser: parsed.data.oidcBrowser ?? null,
      profile: parsed.data.oidcBrowserProfile ?? null,
    });
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: redactErrorMessage(e) }, 400);
  }
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

// 3s end-to-end cap: includes connect (driver's serverSelectionTimeoutMS is
// 5s by default — too long for a UI health badge that polls every 60s) plus
// the ping itself. The UI calls this from useConnectionHealth on every row
// in the picker dropdown, so a long timeout would freeze the UI when the
// network is flaky.
const HEALTH_CHECK_TIMEOUT_MS = 3000;

connectionsRoute.post("/:id/test", async (c) => {
  const id = c.req.param("id");
  try {
    const conn = getConnection(id);
    const connect = getMongoClientFor(id);
    // Interactive browser authentication can legitimately take minutes. Once
    // the user has confirmed it, wait for that flow to finish rather than
    // returning a false health timeout after three seconds. The actual Mongo
    // ping remains capped below.
    const { client, defaultDatabase } =
      conn?.oidcProvider === "azure-browser"
        ? await connect
        : await Promise.race([
            connect,
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error(`Health check timed out after ${HEALTH_CHECK_TIMEOUT_MS}ms`)),
                HEALTH_CHECK_TIMEOUT_MS,
              ),
            ),
          ]);
    const dbName = defaultDatabase ?? "admin";
    const work = client
      .db(dbName)
      .command({ ping: 1, maxTimeMS: HEALTH_CHECK_TIMEOUT_MS });
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Health check timed out after ${HEALTH_CHECK_TIMEOUT_MS}ms`)),
        HEALTH_CHECK_TIMEOUT_MS,
      ),
    );
    await Promise.race([work, timeout]);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ ok: false, error: redactErrorMessage(e) }, 400);
  }
});

/**
 * Quick-test a URI without saving it (used by the "New connection" form).
 */
connectionsRoute.post("/test-uri", async (c) => {
  const body = z
    .object({
      uri: z.string().min(1),
      name: z.string().optional(),
      oidcProvider: oidcProviderSchema,
      oidcTokenAudience: z.string().optional().nullable(),
      azureClientId: z.string().optional().nullable(),
      azureTenantId: z.string().optional().nullable(),
      oidcBrowser: oidcBrowserSchema,
      oidcBrowserProfile: z.string().optional().nullable(),
      authAttemptId: z.string().uuid().optional(),
    })
    .safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) {
    return c.json({ error: body.error.issues[0]?.message ?? "Bad input" }, 400);
  }
  const cleaned = sanitizeMongoUri(body.data.uri);
  const uriError = validateMongoUri(cleaned);
  if (uriError) return c.json({ error: uriError }, 400);
  const connectionId = `test-uri:${body.data.authAttemptId ?? uuid()}`;
  if (body.data.oidcProvider === "azure-browser") {
    // This endpoint is only ever called right after the UI's OIDC auth
    // dialog has been confirmed for this exact test run, so pre-approve the
    // one-shot browser launch for the ephemeral connection ID used below.
    prepareOidcBrowserAuth(connectionId, {
      browser: body.data.oidcBrowser ?? null,
      profile: body.data.oidcBrowserProfile ?? null,
    });
  }
  const client = new MongoClient(
    cleaned,
    buildMongoClientOptions({
      connectionId,
      connectionName: body.data.name?.trim() || "Unsaved connection",
      oidcProvider: body.data.oidcProvider ?? null,
      oidcTokenAudience: body.data.oidcTokenAudience ?? null,
      azureClientId: body.data.azureClientId ?? null,
      azureTenantId: body.data.azureTenantId ?? null,
      oidcBrowser: body.data.oidcBrowser ?? null,
      oidcBrowserProfile: body.data.oidcBrowserProfile ?? null,
    }),
  );
  try {
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    return c.json({ ok: true });
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
