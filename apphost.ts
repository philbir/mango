// Aspire TypeScript AppHost — orchestrates Mango's server + UI for local dev.
// Run with: aspire run
// See: https://aspire.dev/get-started/first-app/?aspire-lang=typescript

import { createBuilder } from "./.modules/aspire.js";

const builder = await createBuilder();

// MongoDB for local testing. Bound to a fixed host port so external tools
// (Compass, mongosh) can connect at mongodb://localhost:27017. The named
// volume keeps test data across `aspire run` invocations — delete it via
// `docker volume rm mango-mongo-data` to start fresh.
const mongo = await builder
  .addContainer("mongo", "mongo:8")
  .withEndpoint({ port: 27017, targetPort: 27017, name: "tcp" })
  .withVolume("/data/db", { name: "mango-mongo-data" });

// One-shot sample-data seeder. Runs `server/scripts/seed-mongo.ts`, which
// drops + recreates two sample databases (`acme`, `bloggy`) so the workbench
// has something interesting to click through. Idempotent — safe to re-run.
// Runs in parallel with the server (no waitForCompletion) so a flaky seed
// doesn't block the dev loop; the UI just sees the databases appear as soon
// as the seed finishes.
const seed = await builder
  .addJavaScriptApp("mango-seed", "./server", { runScriptName: "seed:mongo" })
  .withYarn({ install: false })
  .withEnvironment("MONGO_URL", "mongodb://localhost:27017")
  .waitFor(mongo);
void seed; // referenced for the compose graph; nothing else depends on it.

// Hono API server. The "dev" script (./server/package.json) runs
// `tsx watch src/index.ts`, so we get hot-reload during development. Aspire
// allocates a port and exposes it via PORT, which server/src/config.ts reads.
// MONGO_URL points at the mongo container above — in multi mode the server's
// seedFromEnvIfEmpty() creates a "Default" connection from it on first boot.
// withOtlpExporter() injects OTEL_EXPORTER_OTLP_ENDPOINT pointing at the
// Aspire dashboard — server/src/instrumentation.ts picks that up automatically.
// withYarn({ install: false }): we manage dependencies via Yarn 4 Berry
// workspaces at the repo root (`yarn install` covers every workspace in one
// pass). Aspire's per-resource installer would shell out a separate install
// here that gets the lockfile format wrong and leaves node_modules out of sync
// with what Berry produced, so we disable it.
const server = await builder
  .addJavaScriptApp("mango-server", "./server", { runScriptName: "dev" })
  .withYarn({ install: false })
  .withHttpEndpoint({ env: "PORT" })
  .withEnvironment("MONGO_URL", "mongodb://localhost:27017")
  // Local AppHost runs are for development — surface the destructive
  // database operations ("Clear all collections", "Delete database") in the
  // UI. Override by unsetting MANGO_DEV_MODE.
  .withEnvironment("MANGO_DEV_MODE", "true")
  .withOtlpExporter()
  .withExternalHttpEndpoints()
  .waitFor(mongo);

// Vite UI. addViteApp auto-creates an http endpoint and exposes the port via
// PORT — vite.config.ts reads PORT/VITE_PORT and binds Vite there. VITE_MANGO_API
// points the Vite dev proxy at the server's allocated port (the proxy forwards
// /api/* to mango-server).
const ui = await builder
  .addViteApp("mango-ui", "./ui")
  .withYarn({ install: false })
  .withReference(server)
  .withEnvironment("VITE_MANGO_API", await server.getEndpoint("http"))
  .withExternalHttpEndpoints()
  .waitFor(server);

// Marketing / docs site (docs-site/). Standalone Vite app — no server
// reference, no env wiring. Surfaced through the Aspire dashboard so the docs
// can be previewed alongside the workbench during local dev.
const docs = await builder
  .addViteApp("mango-docs", "./docs-site")
  .withYarn({ install: false })
  .withExternalHttpEndpoints();

// Suppress unused-var warnings — `ui` and `docs` exist so the compose graph wires up.
void ui;
void docs;

await builder.build().run();
