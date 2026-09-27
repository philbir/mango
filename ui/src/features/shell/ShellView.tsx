import {
  IconBraces,
  IconPlayerPlayFilled,
  IconTerminal2,
} from "@tabler/icons-react";
import { useMemo, useRef, useState } from "react";
import { ApiError, api, stringifyEJSON } from "../../api/client";
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
  const [result, setResult] = useState<unknown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { jsonFormat, formatOptions } = useSettings();
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
    setRunning(true);
    setError(null);
    try {
      const r = await api.runShell(
        activeId,
        stringifyEJSON(command, false),
        database ?? undefined,
      );
      setResult(r);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
      setError(msg);
      setResult(null);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex h-full flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3 pr-12 dark:border-slate-800 dark:bg-slate-900/40">
        <IconTerminal2 size={18} className="text-sky-600 dark:text-sky-400" />
        <div className="flex-1">
          <div className="font-mono text-base text-slate-900 dark:text-slate-100">
            Shell
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-500">
            Send a raw <span className="font-mono">db.runCommand</span> document
            — JSON or shell syntax (<span className="font-mono">ObjectId("…")</span>,{" "}
            <span className="font-mono">ISODate("…")</span>)
          </div>
        </div>
      </header>

      <section className="border-b border-slate-200 bg-slate-50/60 px-5 py-3 dark:border-slate-800 dark:bg-slate-900/30">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-500">
            Presets
          </span>
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setText(p.command)}
              className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {p.label}
            </button>
          ))}
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => editorRef.current?.format()}
            className="flex items-center gap-1 rounded border border-slate-300 px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            title="Format (⇧⌥F)"
          >
            <IconBraces size={11} />
            Format
          </button>
        </div>
        <div className="flex items-stretch gap-2">
          <div className="min-h-[140px] flex-1 overflow-hidden rounded border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900">
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
          <button
            type="button"
            onClick={onRun}
            disabled={running}
            className="flex items-center gap-1.5 self-start rounded bg-sky-500 px-3 py-2 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50"
          >
            <IconPlayerPlayFilled size={14} />
            {running ? "Running…" : "Run"}
          </button>
        </div>
        <div className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
          Tip: <kbd className="rounded border border-slate-300 px-1 dark:border-slate-700">⌘/Ctrl + Enter</kbd> to run · <kbd className="rounded border border-slate-300 px-1 dark:border-slate-700">⌃Space</kbd> for completions
        </div>
      </section>

      <section className="flex min-h-0 flex-1 flex-col p-5">
        {error && (
          <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
            {error}
          </div>
        )}
        {!error && result === null && (
          <div className="text-sm text-slate-500 dark:text-slate-400">
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
