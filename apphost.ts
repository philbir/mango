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
  .addContainer("mongo", "mongo:7")
  .withEndpoint({ port: 27017, targetPort: 27017, name: "tcp" })
  .withVolume("/data/db", { name: "mango-mongo-data" });

// Hono API server. The "dev" script (./server/package.json) runs
// `tsx watch src/index.ts`, so we get hot-reload during development. Aspire
// allocates a port and exposes it via PORT, which server/src/config.ts reads.
// MONGO_URL points at the mongo container above — in multi mode the server's
// seedFromEnvIfEmpty() creates a "Default" connection from it on first boot.
// withOtlpExporter() injects OTEL_EXPORTER_OTLP_ENDPOINT pointing at the
// Aspire dashboard — server/src/instrumentation.ts picks that up automatically.
const server = await builder
  .addJavaScriptApp("mango-server", "./server", { runScriptName: "dev" })
  .withHttpEndpoint({ env: "PORT" })
  .withEnvironment("MONGO_URL", "mongodb://localhost:27017")
  .withOtlpExporter()
  .withExternalHttpEndpoints()
  .waitFor(mongo);

// Vite UI. addViteApp auto-creates an http endpoint and exposes the port via
// PORT — vite.config.ts reads PORT/VITE_PORT and binds Vite there. VITE_MANGO_API
// points the Vite dev proxy at the server's allocated port (the proxy forwards
// /api/* to mango-server).
const ui = await builder
  .addViteApp("mango-ui", "./ui")
  .withReference(server)
  .withEnvironment("VITE_MANGO_API", await server.getEndpoint("http"))
  .withExternalHttpEndpoints()
  .waitFor(server);

// Suppress unused-var warning — `ui` exists so the compose graph wires up.
void ui;

await builder.build().run();
