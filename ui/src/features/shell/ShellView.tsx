import {
  IconAlertTriangle,
  IconBraces,
  IconDeviceFloppy,
  IconPlayerPlayFilled,
  IconTerminal2,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api } from "../../api/client";
import { InteractiveJsonView } from "../../components/JsonView";
import {
  MonacoJsonInput,
  type MonacoJsonInputHandle,
} from "../../components/MonacoJsonInput";
import {
  type ApplyKind,
  useAssistantBinding,
} from "../assistant/AssistantContext";
import { useActiveConnection } from "../connections/useActiveConnection";
import { useActiveDatabase } from "../connections/useActiveDatabase";
import { useTabs } from "../tabs/TabsContext";
import { useWorkspaceFileBinding } from "../workspaces/useWorkspaceFileBinding";

const PRESETS: Array<{ label: string; command: string }> = [
  { label: "ping", command: '{"ping":1}' },
  { label: "buildInfo", command: '{"buildInfo":1}' },
  { label: "dbStats", command: '{"dbStats":1}' },
  { label: "serverStatus", command: '{"serverStatus":1}' },
  {
    label: "collStats: dossier",
    command: '{"collStats":"dossier"}',
  },
  {
    label: "aggregate sample",
    command: `{
  "aggregate": "dossier",
  "pipeline": [{ "$sample": { "size": 3 } }],
  "cursor": {}
}`,
  },
];

interface ShellViewProps {
  tabId?: string;
}

export const ShellView = ({ tabId }: ShellViewProps = {}) => {
  const { activeId, active } = useActiveConnection();
  const { database } = useActiveDatabase();
  const { tabs, closeTab } = useTabs();
  const tab = tabId ? tabs.find((t) => t.id === tabId) ?? null : null;
  const fileBinding = useWorkspaceFileBinding({
    workspaceId: tab?.workspaceId,
    filePath: tab?.workspaceFilePath,
  });
  const [text, setText] = useState('{"ping":1}');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<unknown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [seededMtime, setSeededMtime] = useState<number | null>(null);

  // Seed editor from the bound file once it loads. Skip while dirty so
  // in-progress edits aren't clobbered.
  useEffect(() => {
    if (!fileBinding.bound || fileBinding.mtime === null || dirty) return;
    if (seededMtime === fileBinding.mtime) return;
    setText(fileBinding.script || "");
    setSeededMtime(fileBinding.mtime);
    setDirty(false);
    setSaveError(null);
  }, [fileBinding.bound, fileBinding.mtime, fileBinding.script, dirty, seededMtime]);

  const onTextChange = (next: string) => {
    setText(next);
    if (fileBinding.bound) setDirty(next !== fileBinding.script);
  };

  const saveBound = async () => {
    if (!fileBinding.bound) return;
    setSaveError(null);
    try {
      await fileBinding.save({
        frontmatter: {
          ...fileBinding.frontmatter,
          kind: "shell",
          connectionId: activeId ?? fileBinding.frontmatter.connectionId,
          connection: active?.name ?? fileBinding.frontmatter.connection,
          database: database ?? fileBinding.frontmatter.database,
        },
        description: fileBinding.description,
        script: text,
      });
      setDirty(false);
    } catch (e) {
      if (e instanceof ApiError) {
        setSaveError(
          e.status === 409
            ? "File changed on disk. Reload to see changes, then save again."
            : e.message,
        );
      } else {
        setSaveError(e instanceof Error ? e.message : String(e));
      }
    }
  };

  // Cmd/Ctrl + S → save when bound.
  useEffect(() => {
    if (!fileBinding.bound) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        if (dirty) void saveBound();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileBinding.bound, dirty, text]);

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
    setRunning(true);
    setError(null);
    try {
      const r = await api.runShell(activeId, text, database ?? undefined);
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
          </div>
        </div>
      </header>

      {fileBinding.bound && (
        <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1 text-[11.5px] dark:border-slate-800 dark:bg-slate-900/40">
          <IconDeviceFloppy size={12} className="text-slate-400" />
          <span className="truncate font-mono text-slate-700 dark:text-slate-200">
            {tab?.workspaceFilePath}
          </span>
          {dirty && (
            <span className="rounded bg-amber-200/60 px-1 text-[10px] font-medium text-amber-800 dark:bg-amber-700/30 dark:text-amber-200">
              unsaved
            </span>
          )}
          {fileBinding.externallyChangedAt && !fileBinding.deleted && (
            <button
              type="button"
              onClick={() => fileBinding.reload()}
              className="flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10.5px] text-amber-800 hover:bg-amber-100 dark:border-amber-700/60 dark:bg-amber-900/30 dark:text-amber-200"
            >
              <IconAlertTriangle size={10} />
              Changed on disk · Reload
            </button>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={saveBound}
            disabled={!dirty || fileBinding.saving}
            className="flex items-center gap-1 rounded border border-slate-300 px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            title="Save (⌘/Ctrl + S)"
          >
            <IconDeviceFloppy size={11} />
            {fileBinding.saving ? "Saving…" : dirty ? "Save" : "Saved"}
          </button>
          {tabId && (
            <button
              type="button"
              onClick={() => closeTab(tabId)}
              className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <IconX size={11} />
            </button>
          )}
        </div>
      )}
      {fileBinding.bound && saveError && (
        <div className="border-b border-red-200 bg-red-50 px-3 py-1 text-[11.5px] text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
          {saveError}
        </div>
      )}

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
            title="Format JSON (⇧⌥F)"
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

      <section className="flex-1 overflow-auto p-5">
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
          <InteractiveJsonView value={result} collapsed={3} />
        )}
      </section>
    </div>
  );
};
