// Aspire TypeScript AppHost — orchestrates Mango's server + UI for local dev.
// Run with: aspire run
// See: https://aspire.dev/get-started/first-app/?aspire-lang=typescript

import { createBuilder } from "./.modules/aspire.js";

const builder = await createBuilder();

// Hono API server. The "dev" script (./server/package.json) runs
// `tsx watch src/index.ts`, so we get hot-reload during development. Aspire
// allocates a port and exposes it via PORT, which server/src/config.ts reads.
// withOtlpExporter() injects OTEL_EXPORTER_OTLP_ENDPOINT pointing at the
// Aspire dashboard — server/src/instrumentation.ts picks that up automatically.
const server = await builder
  .addJavaScriptApp("mango-server", "./server", { runScriptName: "dev" })
  .withHttpEndpoint({ env: "PORT" })
  .withOtlpExporter()
  .withExternalHttpEndpoints();

// Vite UI. addViteApp auto-creates an http endpoint and exposes the port via
// PORT — vite.config.ts reads PORT/VITE_PORT and binds Vite there. VITE_MANGO_API
// points the Vite dev proxy at the server's allocated port (the proxy forwards
// /api/* to mango-server). VITE_OTEL_ENABLED turns on the browser OTel SDK in
// ui/src/telemetry.ts.
const ui = await builder
  .addViteApp("mango-ui", "./ui")
  .withReference(server)
  .withEnvironment("VITE_MANGO_API", await server.getEndpoint("http"))
  .withEnvironment("VITE_OTEL_ENABLED", "true")
  .withExternalHttpEndpoints()
  .waitFor(server);

// Suppress unused-var warning — `ui` exists so the compose graph wires up.
void ui;

await builder.build().run();
