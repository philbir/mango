import { Hono } from "hono";
import { MongoClient } from "mongodb";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import {
  buildMongoClientOptions,
  cancelOidcBrowserAuth,
  closeMongoClient,
  getMongoClientFor,
  getOidcBrowserAuthUrl,
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
  openBrowser: z.boolean().optional(),
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
      openBrowser: parsed.data.openBrowser,
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

connectionsRoute.post("/:id/oidc/browser-auth/cancel", (c) => {
  cancelOidcBrowserAuth(c.req.param("id"));
  return c.json({ ok: true });
});

connectionsRoute.get("/:id/oidc/browser-auth/url", (c) => {
  c.header("Cache-Control", "no-store");
  return c.json({ url: getOidcBrowserAuthUrl(c.req.param("id")) });
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
      openBrowser: z.boolean().optional(),
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
      openBrowser: body.data.openBrowser,
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

const SERVER_INFO_TIMEOUT_MS = 5000;

const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;

const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "bigint") return Number(v);
  if (v && typeof v === "object" && "toNumber" in v) {
    const n = (v as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

/**
 * Server / connection details for the database view's "Connection" tab:
 * `buildInfo` + `hello` (both allowed without auth privileges), a
 * best-effort `serverStatus` (needs clusterMonitor — silently omitted when
 * denied), and the driver's parsed client options. Never returns the
 * password; the UI reveals the full URI via `/:id/secret`.
 */
connectionsRoute.get("/:id/server-info", async (c) => {
  const id = c.req.param("id");
  const conn = getConnectionPublic(id);
  if (!conn) return c.json({ error: "Connection not found" }, 404);
  try {
    const { client } = await getMongoClientFor(id);
    const admin = client.db("admin");
    const opts = { timeoutMS: SERVER_INFO_TIMEOUT_MS };

    const pingStart = performance.now();
    await admin.command({ ping: 1 }, opts);
    const pingMs = performance.now() - pingStart;

    const [build, hello, status] = await Promise.allSettled([
      admin.command({ buildInfo: 1 }, opts),
      admin.command({ hello: 1 }, opts),
      admin.command(
        { serverStatus: 1, repl: 0, metrics: 0, locks: 0, wiredTiger: 0 },
        opts,
      ),
    ]);
    const b = build.status === "fulfilled" ? build.value : {};
    const h = hello.status === "fulfilled" ? hello.value : {};
    const s = status.status === "fulfilled" ? status.value : null;

    const o = client.options;
    const topology = o.loadBalanced
      ? "Load balanced"
      : h.msg === "isdbgrid"
        ? "Sharded (mongos)"
        : str(h.setName)
          ? "Replica set"
          : "Standalone";

    const modules = Array.isArray(b.modules) ? (b.modules as string[]) : [];
    const sConnections = s?.connections as Record<string, unknown> | undefined;
    const sStorage = s?.storageEngine as Record<string, unknown> | undefined;

    return c.json({
      connection: {
        name: conn.name,
        uriRedacted: conn.uriRedacted,
        defaultDatabase: conn.effectiveDefaultDatabase,
        source: conn.source,
        aspire: conn.aspire,
        oidcProvider: conn.oidcProvider,
        revealable: !isStandalone(),
      },
      client: {
        hosts: o.hosts.map((x) => x.toString()),
        srvHost: o.srvHost ?? null,
        username: o.credentials?.username || null,
        authSource: o.credentials?.source ?? null,
        authMechanism: o.credentials?.mechanism ?? null,
        tls: !!o.tls,
        replicaSet: o.replicaSet ?? null,
        directConnection: o.directConnection,
        appName: o.appName ?? null,
        readPreference: o.readPreference.mode,
        compressors: o.compressors.filter((x) => x !== "none"),
      },
      server: {
        version: str(b.version),
        gitVersion: str(b.gitVersion),
        edition: modules.includes("enterprise") ? "Enterprise" : "Community",
        topology,
        setName: str(h.setName),
        primary: str(h.primary),
        me: str(h.me),
        hosts: Array.isArray(h.hosts) ? (h.hosts as string[]) : [],
        isWritablePrimary: h.isWritablePrimary === true,
        maxWireVersion: num(h.maxWireVersion),
        openssl: str((b.openssl as Record<string, unknown> | undefined)?.running),
        host: str(s?.host),
        process: str(s?.process),
        uptimeSeconds: num(s?.uptime),
        storageEngine: str(sStorage?.name),
        connectionsCurrent: num(sConnections?.current),
        connectionsAvailable: num(sConnections?.available),
        serverStatusAvailable: s !== null,
      },
      pingMs,
    });
  } catch (e) {
    return c.json({ error: redactErrorMessage(e) }, 400);
  }
});
