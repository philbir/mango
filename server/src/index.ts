import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { closeAllClients, config } from "./config.js";
import { resolveServerConfig } from "./mode.js";
import { aiRoute } from "./routes/ai.js";
import { collectionsRoute } from "./routes/collections.js";
import { connectionsRoute } from "./routes/connections.js";
import { consoleRoute } from "./routes/console.js";
import { documentsRoute } from "./routes/documents.js";
import { schemaRoute } from "./routes/schema.js";
import { shellRoute } from "./routes/shell.js";
import {
  seedFromEnvIfEmpty,
  upsertStandaloneConnection,
} from "./store/connections.js";
import { getDb } from "./store/db.js";

// Bootstrap: open SQLite (runs migrations).
getDb();

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
app.use("/api/*", cors());

app.get("/api/health", (c) => {
  return c.json({ ok: true });
});

app.get("/api/config", (c) => {
  return c.json(serverConfig);
});

app.route("/api/connections", connectionsRoute);

// All collection-scoped routes are nested under /api/connections/:cid/...
const connectionScoped = new Hono();
connectionScoped.route("/collections", collectionsRoute);
connectionScoped.route("/collections", documentsRoute);
connectionScoped.route("/collections", schemaRoute);
connectionScoped.route("/shell", shellRoute);
connectionScoped.route("/console", consoleRoute);
app.route("/api/connections/:cid", connectionScoped);

app.route("/api/ai", aiRoute);

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

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[mango] listening on http://localhost:${info.port}`);
});

const shutdown = async (signal: string) => {
  console.log(`[mango] received ${signal}, shutting down…`);
  await closeAllClients();
  server.close();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
