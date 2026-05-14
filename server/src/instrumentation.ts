// OpenTelemetry bootstrap. Imported as the very first line of index.ts so the
// SDK can install its require/import hooks before Hono, mongodb, etc. are
// loaded — otherwise auto-instrumentation can't patch them.
//
// No-op unless OTEL_EXPORTER_OTLP_ENDPOINT is set. Default endpoint for the
// standalone Aspire dashboard is http://localhost:4317 (gRPC).

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

if (endpoint) {
  // Dynamic import so OTel modules are only evaluated when telemetry is on —
  // keeps cold-start fast for users who don't run the dashboard. Top-level
  // await blocks subsequent module evaluation in the importing file, so by the
  // time index.ts evaluates `import { serve } from "@hono/node-server"`, the
  // SDK is already started and its instrumentations have hooked the loader.
  const { NodeSDK } = await import("@opentelemetry/sdk-node");
  const { getNodeAutoInstrumentations } = await import(
    "@opentelemetry/auto-instrumentations-node"
  );
  const { OTLPTraceExporter } = await import(
    "@opentelemetry/exporter-trace-otlp-grpc"
  );
  const { OTLPMetricExporter } = await import(
    "@opentelemetry/exporter-metrics-otlp-grpc"
  );
  const { OTLPLogExporter } = await import(
    "@opentelemetry/exporter-logs-otlp-grpc"
  );
  const { PeriodicExportingMetricReader } = await import(
    "@opentelemetry/sdk-metrics"
  );
  const { resourceFromAttributes } = await import("@opentelemetry/resources");
  const {
    ATTR_SERVICE_NAME,
    ATTR_SERVICE_VERSION,
  } = await import("@opentelemetry/semantic-conventions");

  const serviceName = process.env.OTEL_SERVICE_NAME ?? "mango-server";
  const serviceVersion = process.env.npm_package_version ?? "dev";

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: serviceVersion,
    }),
    traceExporter: new OTLPTraceExporter({ url: endpoint }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: endpoint }),
      exportIntervalMillis: 5_000,
    }),
    logRecordProcessors: [
      new (await import("@opentelemetry/sdk-logs")).BatchLogRecordProcessor(
        new OTLPLogExporter({ url: endpoint }),
      ),
    ],
    instrumentations: [
      getNodeAutoInstrumentations({
        // fs is extremely chatty and rarely useful for an HTTP service.
        "@opentelemetry/instrumentation-fs": { enabled: false },
      }),
    ],
  });

  sdk.start();
  console.log(`[mango] OpenTelemetry started → ${endpoint} (service=${serviceName})`);

  const shutdown = async () => {
    try {
      await sdk.shutdown();
    } catch {
      /* ignore — best effort flush on exit */
    }
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
