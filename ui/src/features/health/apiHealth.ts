import { isTauri } from "../updater/useUpdater";

export interface HealthCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface HealthReport {
  ok: boolean;
  version: string;
  uptimeSec: number;
  checks: HealthCheck[];
}

/** Mirrors `SidecarStatus` in desktop/src-tauri/src/lib.rs. */
export interface SidecarStatus {
  state: "starting" | "ready" | "failed";
  port: number;
  error: string | null;
  recentLogs: string[];
  logDir: string | null;
}

export type ProbeResult =
  | { kind: "ok"; report: HealthReport }
  /** The server answered, but its own checks failed (HTTP 503 + report). */
  | { kind: "unhealthy"; report: HealthReport }
  | { kind: "unreachable"; reason: string };

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** One GET /api/health, classified. Never throws. */
export const probeHealth = async (timeoutMs = 4000): Promise<ProbeResult> => {
  let res: Response;
  try {
    res = await fetch("/api/health", {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return { kind: "unreachable", reason: `No response from ${location.origin}/api/health: ${describe(error)}` };
  }
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) {
    return {
      kind: "unreachable",
      reason: `/api/health answered HTTP ${res.status} with ${type || "no content type"} instead of JSON — the Mango server isn't behind ${location.origin}.`,
    };
  }
  try {
    const report = (await res.json()) as HealthReport;
    if (res.ok && report.ok) return { kind: "ok", report };
    return { kind: "unhealthy", report };
  } catch (error) {
    return { kind: "unreachable", reason: `/api/health returned invalid JSON: ${describe(error)}` };
  }
};

// ---------------------------------------------------------------------------
// Desktop shell (Tauri) bridge

const invoke = <T>(cmd: string): Promise<T> => {
  // Only reached behind isTauri().
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return window.__TAURI_INTERNALS__!.invoke<T>(cmd);
};

/**
 * The desktop WebView boots on the bundled origin — tauri://localhost on
 * macOS/Linux, http(s)://tauri.localhost on Windows — and is redirected to
 * http://127.0.0.1:<port> once the sidecar answers. Before that there is no
 * API at all, only the shell's view of the sidecar process. (`tauri:dev`
 * serves the UI from Vite on http://localhost, which has a real /api proxy.)
 */
export const onDesktopBootOrigin = (): boolean =>
  isTauri() && (location.protocol === "tauri:" || location.hostname === "tauri.localhost");

export const getSidecarStatus = async (): Promise<SidecarStatus | null> => {
  if (!isTauri()) return null;
  try {
    return await invoke<SidecarStatus>("sidecar_status");
  } catch {
    return null;
  }
};

export const openDesktopLogs = (): Promise<void> => invoke<void>("open_log_dir");

export const restartDesktopApp = (): Promise<void> => invoke<void>("restart_app");

// ---------------------------------------------------------------------------
// "The API just failed" signal — raised by the query cache when a request
// fails with isApiUnavailable(), so the gate re-probes right away instead of
// waiting for its next background tick.

const listeners = new Set<() => void>();

export const reportApiUnavailable = (): void => {
  for (const listener of listeners) listener();
};

export const onApiUnavailable = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// ---------------------------------------------------------------------------
// Diagnostics

export interface DiagnosticResult {
  name: string;
  status: "ok" | "warn" | "fail" | "skip";
  detail: string;
}

const timedGet = async (path: string): Promise<DiagnosticResult> => {
  const started = performance.now();
  try {
    const res = await fetch(path, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    const ms = Math.round(performance.now() - started);
    const type = res.headers.get("content-type") ?? "none";
    const summary = `HTTP ${res.status} · ${type.split(";")[0]} · ${ms} ms`;
    if (!type.includes("application/json")) {
      return { name: `GET ${path}`, status: "fail", detail: `${summary} — expected JSON` };
    }
    if (!res.ok) {
      const body = await res.text();
      return { name: `GET ${path}`, status: "fail", detail: `${summary} — ${body.slice(0, 300)}` };
    }
    return { name: `GET ${path}`, status: "ok", detail: summary };
  } catch (error) {
    return { name: `GET ${path}`, status: "fail", detail: describe(error) };
  }
};

export interface DiagnosticsReport {
  results: DiagnosticResult[];
  sidecar: SidecarStatus | null;
  text: string;
}

/** Everything the error screen's "Diagnose" panel shows and copies. */
export const runDiagnostics = async (): Promise<DiagnosticsReport> => {
  const results: DiagnosticResult[] = [];
  const desktop = isTauri();
  results.push({
    name: "Environment",
    status: "ok",
    detail: `${desktop ? "Desktop app" : "Browser"} · origin ${location.origin}`,
  });

  const sidecar = await getSidecarStatus();
  if (desktop) {
    results.push(
      sidecar
        ? {
            name: "Server process",
            status: sidecar.state === "ready" ? "ok" : sidecar.state === "starting" ? "warn" : "fail",
            detail:
              sidecar.state === "failed"
                ? (sidecar.error ?? "failed")
                : `${sidecar.state} on 127.0.0.1:${sidecar.port}`,
          }
        : { name: "Server process", status: "warn", detail: "The desktop shell didn't report sidecar status." },
    );
  }

  const probe = await probeHealth();
  if (probe.kind === "unreachable") {
    results.push({ name: "API health", status: "fail", detail: probe.reason });
  } else {
    results.push({
      name: "API health",
      status: probe.kind === "ok" ? "ok" : "fail",
      detail: `Mango ${probe.report.version} · up ${probe.report.uptimeSec}s`,
    });
    for (const check of probe.report.checks) {
      results.push({
        name: `Server check: ${check.name}`,
        status: check.ok ? "ok" : "fail",
        detail: check.detail ?? (check.ok ? "ok" : "failed"),
      });
    }
  }

  // Only worth hitting the rest when something answered.
  const reachable = probe.kind !== "unreachable";
  for (const path of ["/api/config", "/api/connections", "/api/system/key-health"]) {
    results.push(
      reachable
        ? await timedGet(path)
        : { name: `GET ${path}`, status: "skip", detail: "Skipped — API unreachable" },
    );
  }

  const lines = [
    `Mango diagnostics — ${new Date().toISOString()}`,
    `User agent: ${navigator.userAgent}`,
    "",
    ...results.map((r) => `[${r.status.toUpperCase()}] ${r.name}: ${r.detail}`),
  ];
  if (sidecar?.recentLogs.length) {
    lines.push("", "Recent server output:", ...sidecar.recentLogs);
  }
  return { results, sidecar, text: lines.join("\n") };
};
