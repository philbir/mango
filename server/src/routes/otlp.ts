import { Hono } from "hono";

// Same-origin proxy for browser OpenTelemetry exporters.
//
// The Aspire dashboard's OTLP/HTTP receiver lives on a different origin
// (defaults to http://localhost:4318) and would otherwise need CORS configured
// on the dashboard. Forwarding through the API server avoids that and keeps
// the browser bundle endpoint-agnostic — it always posts to /api/otlp/*.
//
// Pass-through is opt-in via OTEL_EXPORTER_OTLP_HTTP_ENDPOINT (or fallback to
// OTEL_EXPORTER_OTLP_ENDPOINT swapped to its standard HTTP port). When unset,
// the routes return 204 so the browser SDK silently no-ops.

export const otlpRoute = new Hono();

const httpEndpoint = (): string | null => {
  const explicit = process.env.OTEL_EXPORTER_OTLP_HTTP_ENDPOINT;
  if (explicit) return explicit.replace(/\/$/, "");
  const grpc = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!grpc) return null;
  // Convention for the Aspire dashboard: gRPC on 4317, HTTP on 4318.
  try {
    const u = new URL(grpc);
    if (u.port === "4317") u.port = "4318";
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
};

const forward = async (signal: "traces" | "metrics" | "logs", body: ArrayBuffer, contentType: string) => {
  const base = httpEndpoint();
  if (!base) return new Response(null, { status: 204 });
  const url = `${base}/v1/${signal}`;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    });
    const respBody = await resp.arrayBuffer();
    return new Response(respBody, {
      status: resp.status,
      headers: {
        "content-type": resp.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (err) {
    console.warn(
      `[mango/otlp] failed to forward ${signal} to ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return new Response(null, { status: 204 });
  }
};

otlpRoute.post("/v1/traces", async (c) => {
  const body = await c.req.arrayBuffer();
  return forward("traces", body, c.req.header("content-type") ?? "application/json");
});
otlpRoute.post("/v1/metrics", async (c) => {
  const body = await c.req.arrayBuffer();
  return forward("metrics", body, c.req.header("content-type") ?? "application/json");
});
otlpRoute.post("/v1/logs", async (c) => {
  const body = await c.req.arrayBuffer();
  return forward("logs", body, c.req.header("content-type") ?? "application/json");
});
