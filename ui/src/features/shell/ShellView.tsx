import {
  IconBraces,
  IconTerminal2,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, stringifyEJSON } from "../../api/client";
import { ExecuteButton } from "../../components/ExecuteButton";
import {
  MonacoJsonInput,
  type MonacoJsonInputHandle,
} from "../../components/MonacoJsonInput";
import { MONGO_SHELL_LANGUAGE } from "../../monaco-mongo";
import { useSettings } from "../../settings";
import {
  type ApplyKind,
  useAssistantBinding,
} from "../assistant/AssistantContext";
import { useActiveConnection } from "../connections/useActiveConnection";
import { useActiveDatabase } from "../connections/useActiveDatabase";
import { formatDocument, isShellFormat } from "../documents/docFormats";
import { parseShellDocument } from "../documents/shellParse";

const PRESETS: Array<{ label: string; command: string }> = [
  { label: "ping", command: '{"ping":1}' },
  { label: "buildInfo", command: '{"buildInfo":1}' },
  { label: "dbStats", command: '{"dbStats":1}' },
  { label: "serverStatus", command: '{"serverStatus":1}' },
  {
    label: "listCollections",
    command: '{"listCollections":1,"nameOnly":true}',
  },
  { label: "connectionStatus", command: '{"connectionStatus":1}' },
];

interface ShellViewProps {
  tabId?: string;
}

export const ShellView = ({ tabId }: ShellViewProps = {}) => {
  const { activeId } = useActiveConnection();
  const { database } = useActiveDatabase();
  const [text, setText] = useState('{"ping":1}');
  const [running, setRunning] = useState(false);
  const [runningMs, setRunningMs] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const [result, setResult] = useState<unknown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { jsonFormat, formatOptions, queryTimeoutSeconds } = useSettings();
  // Response rendered in the global format (Settings → Configure formats),
  // same as the result list and document viewer.
  const resultText = useMemo(
    () =>
      result === null ? "" : formatDocument(result, jsonFormat, formatOptions),
    [result, jsonFormat, formatOptions],
  );

  const onTextChange = (next: string) => {
    setText(next);
  };

  const shellCompletion = useMemo(() => ({ commandKeywords: true }), []);
  const editorRef = useRef<MonacoJsonInputHandle | null>(null);
  useEffect(() => {
    if (!running) return;
    const start = performance.now();
    const interval = window.setInterval(() => setRunningMs(performance.now() - start), 200);
    return () => {
      window.clearInterval(interval);
      setRunningMs(0);
    };
  }, [running]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const handlerSupports: ApplyKind[] = useMemo(() => ["shell"], []);
  useAssistantBinding({
    key: tabId ? `tab:${tabId}` : "shell",
    mode: "shell",
    collection: null,
    handlers: {
      supports: handlerSupports,
      apply: (kind, payload) => {
        if (kind === "shell") setText(payload);
      },
    },
  });

  const onRun = async () => {
    if (running) return;
    if (!activeId) {
      setError("No active connection.");
      return;
    }
    // The input accepts shell syntax (`ObjectId("…")`, `ISODate("…")`, bare
    // keys) as well as plain JSON; the server only speaks canonical EJSON.
    let command: unknown;
    try {
      command = parseShellDocument(text, formatOptions.uuidRepresentation);
    } catch (e) {
      setError(`Invalid command: ${e instanceof Error ? e.message : String(e)}`);
      setResult(null);
      return;
    }
    if (!command || typeof command !== "object" || Array.isArray(command)) {
      setError("Command must be an object, e.g. { ping: 1 }.");
      setResult(null);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setError(null);
    try {
      const r = await api.runShell(
        activeId,
        stringifyEJSON(command, false),
        database ?? undefined,
        controller.signal,
        queryTimeoutSeconds * 1000,
      );
      setResult(r);
    } catch (e) {
      if (controller.signal.aborted) return;
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
      setError(msg);
      setResult(null);
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
  };

  return (
    <div className="flex h-full flex-1 flex-col">
      <header className="flex h-10 flex-shrink-0 items-center gap-3 border-b border-slate-200 bg-slate-50 pl-4 pr-12 dark:border-slate-800 dark:bg-slate-900/40">
        <IconTerminal2 size={16} className="flex-shrink-0 text-sky-600 dark:text-sky-400" />
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="flex-shrink-0 font-mono text-[14px] font-medium text-slate-900 dark:text-slate-100">
            Shell
          </span>
          <span className="truncate text-[11.5px] text-slate-500 dark:text-slate-400">
            Raw <span className="font-mono">db.runCommand</span> — JSON or shell syntax
            (<span className="font-mono">ObjectId("…")</span>,{" "}
            <span className="font-mono">ISODate("…")</span>)
          </span>
        </div>
      </header>

      <section className="border-b border-slate-200 bg-slate-50/60 px-4 pb-2 dark:border-slate-800 dark:bg-slate-900/30">
        <div className="flex min-h-12 flex-wrap items-center gap-1.5 py-1">
          <span className="eyebrow mr-1">Presets</span>
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setText(p.command)}
              className="btn btn-sm btn-outline h-[22px] min-h-0 px-1.5 font-mono font-normal"
            >
              {p.label}
            </button>
          ))}
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => editorRef.current?.format()}
            className="btn btn-sm btn-ghost"
            title="Format (⇧⌥F)"
          >
            <IconBraces size={13} />
            Format
          </button>
          <span className="hidden text-[11px] text-slate-400 dark:text-slate-500 lg:inline">
            <kbd>⌘</kbd> <kbd>↵</kbd> runs · <kbd>⌃</kbd> <kbd>Space</kbd> completes
          </span>
          <ExecuteButton
            running={running}
            onRun={() => void onRun()}
            onCancel={() => abortRef.current?.abort()}
          />
          {running && runningMs >= 1000 && (
            <span className="tabular-nums text-[11px] text-slate-500">{(runningMs / 1000).toFixed(1)} s</span>
          )}
        </div>
        <div className="min-h-[140px] overflow-hidden rounded border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900">
          <MonacoJsonInput
            ref={editorRef}
            value={text}
            language={MONGO_SHELL_LANGUAGE}
            onChange={onTextChange}
            minHeight="140px"
            showLineNumbers
            completion={shellCompletion}
            onSubmit={onRun}
          />
        </div>
      </section>

      <section className="flex min-h-0 flex-1 flex-col p-4">
        {error && (
          <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
            {error}
          </div>
        )}
        {!error && result === null && (
          <div className="text-[13px] text-slate-500 dark:text-slate-400">
            Run a command to see the response.
          </div>
        )}
        {!error && result !== null && (
          <div className="min-h-0 flex-1 overflow-hidden rounded border border-slate-300 dark:border-slate-700">
            <MonacoJsonInput
              key={`shell-result-${jsonFormat}`}
              value={resultText}
              language={isShellFormat(jsonFormat) ? MONGO_SHELL_LANGUAGE : "json"}
              onChange={() => {
                /* read-only */
              }}
              minHeight="100%"
              showLineNumbers
              readOnly
            />
          </div>
        )}
      </section>
    </div>
  );
};
