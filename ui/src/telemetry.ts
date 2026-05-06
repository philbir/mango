// Browser OpenTelemetry bootstrap for the Mango UI.
//
// Imported as the very first thing in main.tsx so spans cover document-load
// and any fetch/XHR triggered by React render.
//
// Telemetry is opt-in: the SDK only starts when VITE_OTEL_ENABLED is "true".
// The exporter posts OTLP/HTTP+JSON to a same-origin proxy on the API server
// (/api/otlp/v1/...), which forwards to the Aspire dashboard's OTLP/HTTP
// receiver. This avoids cross-origin requests from the browser.

import { WebTracerProvider, BatchSpanProcessor } from "@opentelemetry/sdk-trace-web";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { ZoneContextManager } from "@opentelemetry/context-zone";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { DocumentLoadInstrumentation } from "@opentelemetry/instrumentation-document-load";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { XMLHttpRequestInstrumentation } from "@opentelemetry/instrumentation-xml-http-request";

const enabled = import.meta.env.VITE_OTEL_ENABLED === "true";

if (enabled) {
  const serviceName = import.meta.env.VITE_OTEL_SERVICE_NAME ?? "mango-ui";
  const serviceVersion = import.meta.env.VITE_APP_VERSION ?? "dev";
  // Default to the same-origin proxy on the API server. The dev Vite server
  // proxies /api → :5180 (see vite.config.ts), so this works in both dev and
  // prod without configuration.
  const collectorBase =
    import.meta.env.VITE_OTEL_COLLECTOR_BASE_URL ?? "/api/otlp";

  const provider = new WebTracerProvider({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: serviceVersion,
    }),
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({ url: `${collectorBase}/v1/traces` }),
      ),
    ],
  });

  provider.register({ contextManager: new ZoneContextManager() });

  registerInstrumentations({
    instrumentations: [
      new DocumentLoadInstrumentation(),
      new FetchInstrumentation({
        // Don't trace the OTLP exporter's own POSTs — would create a feedback loop.
        ignoreUrls: [/\/api\/otlp\//],
        propagateTraceHeaderCorsUrls: [/.*/],
      }),
      new XMLHttpRequestInstrumentation({
        ignoreUrls: [/\/api\/otlp\//],
        propagateTraceHeaderCorsUrls: [/.*/],
      }),
    ],
  });

  // eslint-disable-next-line no-console
  console.log(
    `[mango/ui] OpenTelemetry started → ${collectorBase} (service=${serviceName})`,
  );
}
