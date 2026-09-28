import {
  IconAlertTriangle,
  IconCheck,
  IconCircleDashed,
  IconCopy,
  IconFolderOpen,
  IconLoader2,
  IconRefresh,
  IconStethoscope,
  IconX,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { isTauri } from "../updater/useUpdater";
import {
  getSidecarStatus,
  onApiUnavailable,
  onDesktopBootOrigin,
  openDesktopLogs,
  probeHealth,
  restartDesktopApp,
  runDiagnostics,
  type DiagnosticResult,
  type DiagnosticsReport,
  type HealthCheck,
} from "./apiHealth";

/** How long a fresh boot keeps showing "Starting…" before calling it down. */
const BOOT_GRACE_MS = 20_000;
const BOOT_POLL_MS = 600;
/** Background re-probe once the app is up. */
const LIVE_POLL_MS = 30_000;
/** Re-probe cadence while the error screen is showing. */
const DOWN_POLL_MS = 5_000;

type Phase =
  | { kind: "starting" }
  | { kind: "ok" }
  | { kind: "down"; title: string; reason: string; checks?: HealthCheck[] };

/**
 * Nothing under this mounts until GET /api/health answers — so a dead or
 * missing server shows one explanatory screen (with Retry / Diagnose / logs)
 * instead of every query toasting "Could not load …". Once up, it keeps a
 * slow background probe and re-probes immediately whenever a request fails
 * with isApiUnavailable(); if the API goes away the screen covers the app
 * (still mounted, so open tabs survive) until it's back.
 */
export const ApiHealthGate = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>({ kind: "starting" });
  const [mounted, setMounted] = useState(false);
  const bootStarted = useRef(Date.now());
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const check = useCallback(async (): Promise<void> => {
    // Desktop, still on the bundled origin: the shell owns the answer and
    // will navigate the WebView itself once the sidecar is up.
    if (onDesktopBootOrigin()) {
      const sidecar = await getSidecarStatus();
      if (sidecar?.state === "failed") {
        setPhase({
          kind: "down",
          title: "Mango's server didn't start",
          reason: sidecar.error ?? "The bundled server process stopped.",
        });
      } else if (!sidecar && Date.now() - bootStarted.current > BOOT_GRACE_MS) {
        setPhase({
          kind: "down",
          title: "Mango's server didn't start",
          reason: "The desktop shell hasn't reported the server's status.",
        });
      }
      return;
    }

    const probe = await probeHealth();
    if (probe.kind === "ok") {
      if (phaseRef.current.kind === "down") void queryClient.invalidateQueries();
      setPhase({ kind: "ok" });
      setMounted(true);
      return;
    }
    if (probe.kind === "unhealthy") {
      setPhase({
        kind: "down",
        title: "Mango's server isn't healthy",
        reason: "The server is running, but some of its startup checks failed.",
        checks: probe.report.checks,
      });
      return;
    }
    const booting = phaseRef.current.kind === "starting";
    if (booting && Date.now() - bootStarted.current < BOOT_GRACE_MS) return;
    setPhase({ kind: "down", title: "Mango can't reach its server", reason: probe.reason });
  }, [queryClient]);

  // Poll at a cadence that fits the phase.
  useEffect(() => {
    void check();
    const every =
      phase.kind === "starting" ? BOOT_POLL_MS : phase.kind === "down" ? DOWN_POLL_MS : LIVE_POLL_MS;
    const timer = setInterval(() => void check(), every);
    return () => clearInterval(timer);
  }, [phase.kind, check]);

  useEffect(() => onApiUnavailable(() => void check()), [check]);

  return (
    <>
      {mounted && children}
      {phase.kind === "starting" && !mounted && <StartingScreen />}
      {phase.kind === "down" && (
        <ErrorScreen
          title={phase.title}
          reason={phase.reason}
          checks={phase.checks}
          onRetry={check}
        />
      )}
    </>
  );
};

const Screen = ({ children }: { children: ReactNode }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-white p-4 dark:bg-slate-950">
    {children}
  </div>
);

const StartingScreen = () => (
  <Screen>
    <div className="flex flex-col items-center gap-3 text-slate-600 dark:text-slate-300" role="status">
      <IconLoader2 size={28} className="animate-spin text-sky-600 dark:text-sky-400" />
      <div className="text-sm">Starting Mango…</div>
    </div>
  </Screen>
);

const ErrorScreen = ({
  title,
  reason,
  checks,
  onRetry,
}: {
  title: string;
  reason: string;
  checks?: HealthCheck[];
  onRetry: () => Promise<void>;
}) => {
  const desktop = isTauri();
  const [retrying, setRetrying] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [report, setReport] = useState<DiagnosticsReport | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const act = async (fn: () => Promise<void>) => {
    setActionError(null);
    try {
      await fn();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  };

  const diagnose = () =>
    act(async () => {
      setDiagnosing(true);
      try {
        setReport(await runDiagnostics());
      } finally {
        setDiagnosing(false);
      }
    });

  return (
    <Screen>
      <div className="w-full max-w-2xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start gap-3">
          <IconAlertTriangle size={24} className="mt-0.5 flex-shrink-0 text-red-600 dark:text-red-400" />
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h1>
            <p className="mt-1 break-words text-sm text-slate-600 dark:text-slate-300">{reason}</p>
            {checks && checks.length > 0 && (
              <ul className="mt-3 space-y-1">
                {checks.filter((c) => !c.ok).map((c) => (
                  <li key={c.name} className="font-mono text-xs text-red-700 dark:text-red-300">
                    {c.name}: {c.detail ?? "failed"}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-primary"
            disabled={retrying}
            onClick={() =>
              act(async () => {
                setRetrying(true);
                try {
                  await onRetry();
                } finally {
                  setRetrying(false);
                }
              })
            }
          >
            {retrying ? <IconLoader2 size={14} className="animate-spin" /> : <IconRefresh size={14} />}
            Retry
          </button>
          <button type="button" className="btn btn-outline" disabled={diagnosing} onClick={() => void diagnose()}>
            {diagnosing ? <IconLoader2 size={14} className="animate-spin" /> : <IconStethoscope size={14} />}
            {report ? "Run diagnostics again" : "Diagnose"}
          </button>
          {desktop && (
            <>
              <button type="button" className="btn btn-outline" onClick={() => void act(openDesktopLogs)}>
                <IconFolderOpen size={14} />
                Open logs
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => void act(restartDesktopApp)}>
                Restart Mango
              </button>
            </>
          )}
        </div>
        {actionError && <p className="mt-2 text-xs text-red-700 dark:text-red-300">{actionError}</p>}

        {report && (
          <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800">
            <div className="mb-2 flex items-center justify-between">
              <div className="eyebrow">Diagnostics</div>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() =>
                  act(async () => {
                    await navigator.clipboard.writeText(report.text);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  })
                }
              >
                {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
                {copied ? "Copied" : "Copy report"}
              </button>
            </div>
            <ul className="space-y-1.5">
              {report.results.map((r) => (
                <DiagnosticRow key={r.name} result={r} />
              ))}
            </ul>
            {report.sidecar && report.sidecar.recentLogs.length > 0 && (
              <>
                <div className="eyebrow mt-4 mb-1">Recent server output</div>
                <pre className="max-h-64 overflow-auto rounded border border-slate-200 bg-slate-50 p-2 font-mono text-[11px] leading-snug text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                  {report.sidecar.recentLogs.join("\n")}
                </pre>
              </>
            )}
          </div>
        )}
      </div>
    </Screen>
  );
};

const statusIcon: Record<DiagnosticResult["status"], ReactNode> = {
  ok: <IconCheck size={14} className="text-emerald-600 dark:text-emerald-400" />,
  warn: <IconAlertTriangle size={14} className="text-amber-600 dark:text-amber-400" />,
  fail: <IconX size={14} className="text-red-600 dark:text-red-400" />,
  skip: <IconCircleDashed size={14} className="text-slate-500" />,
};

const DiagnosticRow = ({ result }: { result: DiagnosticResult }) => (
  <li className="flex items-start gap-2 text-xs">
    <span className="mt-0.5 flex-shrink-0">{statusIcon[result.status]}</span>
    <span className="w-44 flex-shrink-0 font-medium text-slate-800 dark:text-slate-200">{result.name}</span>
    <span className="min-w-0 flex-1 break-words font-mono text-slate-600 dark:text-slate-400">{result.detail}</span>
  </li>
);
