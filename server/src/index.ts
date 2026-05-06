// Early-boot heartbeat — if this never appears, the bun-compiled binary is
// broken before our top-level code runs (look for missing stdout in
// desktop/src-tauri tauri logs).
process.stderr.write("[mango] boot start\n");

// MUST be the first import: the OTel SDK has to install loader hooks before
// any instrumented module (http, hono, mongodb…) is required.
import "./instrumentation.js";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { closeAllClients, config } from "./config.js";
import { resolveServerConfig } from "./mode.js";
import { redactErrorMessage } from "./security.js";
import { getConnection } from "./store/connections.js";
import { aiRoute } from "./routes/ai.js";
import { collectionsRoute } from "./routes/collections.js";
import { connectionsRoute } from "./routes/connections.js";
import { consoleRoute } from "./routes/console.js";
import { discoveryRoute } from "./routes/discovery.js";
import { documentsRoute } from "./routes/documents.js";
import { infoRoute } from "./routes/info.js";
import { otlpRoute } from "./routes/otlp.js";
import { schemaRoute } from "./routes/schema.js";
import { shellRoute } from "./routes/shell.js";
import { systemRoute } from "./routes/system.js";
import { workspacesRoute } from "./routes/workspaces.js";
import { isAllowedOrigin } from "./security.js";
import {
  seedFromEnvIfEmpty,
  upsertStandaloneConnection,
} from "./store/connections.js";

const serverConfig = resolveServerConfig();
if (serverConfig.mode === "standalone" && serverConfig.standaloneConnectionId) {
  upsertStandaloneConnection(
    serverConfig.standaloneConnectionId,
    process.env.MONGO_URL!,
    process.env.MONGO_DB ?? null,
  );
  console.log("[mango] standalone mode — connection pinned from MONGO_URL");
} else {
  // Multi mode — keep the legacy "seed from MONGO_URL when empty" behavior.
  seedFromEnvIfEmpty();
}

const app = new Hono();

app.use("*", logger());
app.use("/api/*", async (c, next) => {
  const origin = c.req.header("origin");
  const fetchSite = c.req.header("sec-fetch-site");

  if (fetchSite === "cross-site") {
    return c.json({ error: "Cross-site API requests are not allowed." }, 403);
  }

  if (origin) {
    if (!isAllowedOrigin(origin, c.req.url)) {
      return c.json({ error: "Origin is not allowed." }, 403);
    }
    c.header("access-control-allow-origin", origin);
    c.header("vary", "Origin");
    c.header("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    c.header("access-control-allow-headers", "content-type");
  }

  if (c.req.method === "OPTIONS") return c.body(null, 204);
  await next();
});

// Default: any uncaught exception in a route returns a usable JSON detail
// instead of Hono's plain-text "Internal Server Error". Routes that want a
// different status (400, 404, etc.) should still catch and return their own
// response — this is the safety net.
app.onError((err, c) => {
  const message = redactErrorMessage(err);
  console.error(`[mango] unhandled error on ${c.req.method} ${c.req.path}: ${message}`);
  if (err instanceof Error && err.stack) console.error(err.stack);
  return c.json({ error: message }, 500);
});

app.get("/api/health", (c) => {
  return c.json({ ok: true });
});

app.get("/api/config", (c) => {
  return c.json(serverConfig);
});

app.route("/api/connections", connectionsRoute);

// All collection-scoped routes are nested under /api/connections/:cid/...
const connectionScoped = new Hono();
connectionScoped.use("*", async (c, next) => {
  const cid = c.req.param("cid");
  if (!cid || !getConnection(cid)) {
    return c.json({ error: "Connection not found" }, 404);
  }
  await next();
});
connectionScoped.route("/collections", collectionsRoute);
connectionScoped.route("/collections", documentsRoute);
connectionScoped.route("/collections", schemaRoute);
connectionScoped.route("/collections", infoRoute);
connectionScoped.route("/shell", shellRoute);
connectionScoped.route("/console", consoleRoute);
app.route("/api/connections/:cid", connectionScoped);

app.route("/api/ai", aiRoute);
app.route("/api/system", systemRoute);
app.route("/api/discovery", discoveryRoute);
app.route("/api/workspaces", workspacesRoute);
app.route("/api/otlp", otlpRoute);

const staticDirAbs = path.resolve(config.staticDir);
if (existsSync(staticDirAbs)) {
  console.log(`[mango] serving UI from ${staticDirAbs}`);
  app.use(
    "/*",
    serveStatic({
      root: path.relative(process.cwd(), staticDirAbs) || ".",
    }),
  );
  app.get("*", async (c) => {
    const indexPath = path.join(staticDirAbs, "index.html");
    if (!existsSync(indexPath)) return c.notFound();
    const html = await readFile(indexPath, "utf8");
    return c.html(html);
  });
} else {
  console.log(`[mango] no UI assets at ${staticDirAbs}; running API-only`);
  app.get("/", (c) =>
    c.text(
      "Mango API. UI assets not bundled — run the Vite dev server separately, or provide STATIC_DIR.",
    ),
  );
}

const server = serve(
  { fetch: app.fetch, port: config.port, hostname: config.host },
  (info) => {
    const address =
      typeof info === "object" && "address" in info && info.address
        ? String(info.address)
        : config.host;
    console.log(`[mango] listening on http://${address}:${config.port}`);
  },
);

const shutdown = async (signal: string) => {
  console.log(`[mango] received ${signal}, shutting down…`);
  await closeAllClients();
  server.close();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
