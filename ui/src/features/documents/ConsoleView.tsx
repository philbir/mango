import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import {
  IconLoader2,
  IconPlayerPlayFilled,
  IconSparkles,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { ApiError, api, extractIdString } from "../../api/client";
import {
  MonacoShellInput,
  setMongoShellSchemas,
} from "../../components/MonacoShellInput";
import { useResize } from "../../components/useResize";
import { type PageSize, useSettings } from "../../settings";
import { useActiveConnection } from "../connections/useActiveConnection";
import { useActiveDatabase } from "../connections/useActiveDatabase";
import { DocumentEditor } from "../editor/DocumentEditor";
import { ResultPanel, type ResultFormat } from "./ResultPanel";

interface Props {
  initialCommand?: string;
}

const PAGE_SIZES: PageSize[] = [50, 100, 200, 500];

export const ConsoleView = ({ initialCommand = "db.\n" }: Props) => {
  const { activeId } = useActiveConnection();
  const { database } = useActiveDatabase();
  const { pageSize, setPageSize } = useSettings();
  const [code, setCode] = useState(initialCommand);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [resultView, setResultView] = useState<ResultFormat>("table");
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Pin the command for paging — we re-run the same command across page changes
  // until the user presses Run, which re-pins.
  const [pinned, setPinned] = useState<string | null>(null);

  const { size: editorHeight, onMouseDown: onEditorResize } = useResize({
    storageKey: "mango:console-editor-height",
    axis: "y",
    initial: 220,
    min: 120,
    max: 600,
  });

  const collectionsQuery = useQuery({
    queryKey: ["collections", activeId, database],
    queryFn: () => api.listCollections(activeId!, database ?? undefined),
    enabled: !!activeId && !!database,
    staleTime: 60_000,
  });
  const collections =
    collectionsQuery.data?.collections.map((c) => c.name) ?? [];

  // Track which collections the user references in the editor so we can
  // pre-fetch their schemas for autocompletion inside `db.<col>.find({…})`.
  const referencedCollections = useMemo(() => {
    const set = new Set<string>();
    for (const m of code.matchAll(/\bdb\.([\w$]+)\b/g)) {
      if (m[1]) set.add(m[1]);
    }
    const valid = new Set(collections);
    return Array.from(set).filter((c) => valid.has(c));
  }, [code, collections]);

  const schemaQueries = useQueries({
    queries: referencedCollections.map((c) => ({
      queryKey: ["schema", activeId, database, c] as const,
      queryFn: () => api.getSchema(activeId!, c, 30, database ?? undefined),
      enabled: !!activeId && !!c,
      staleTime: 60_000,
    })),
  });

  useEffect(() => {
    const map: Record<string, string[]> = {};
    schemaQueries.forEach((q, i) => {
      const name = referencedCollections[i];
      if (name && q.data) {
        map[name] = q.data.fields.map((f) => f.path);
      }
    });
    setMongoShellSchemas(map);
  });

  const skip = page * pageSize;

  const run = useQuery({
    queryKey: ["console", activeId, database, pinned, skip, pageSize],
    queryFn: async () => {
      if (!activeId) throw new Error("No active connection.");
      if (!pinned) return null;
      return api.runConsole({
        cid: activeId,
        command: pinned,
        database: database ?? undefined,
        skip,
        limit: pageSize,
      });
    },
    enabled: !!activeId && !!pinned,
  });

  const ai = useMutation({
    mutationFn: async () => {
      if (!activeId) throw new Error("No active connection.");
      return api.generateAiCommand({
        connectionId: activeId,
        prompt: aiPrompt.trim(),
        database: database ?? undefined,
      });
    },
    onSuccess: (result) => {
      setCode(result.command);
      setAiOpen(false);
    },
  });

  const onRun = () => {
    const cmd = code.trim();
    if (!cmd) return;
    setPage(0);
    setPinned(cmd);
  };

  const resultDocs = Array.isArray(run.data?.result)
    ? (run.data!.result as Array<Record<string, unknown>>)
    : null;
  const selectedDoc =
    selectedId && resultDocs
      ? resultDocs.find((d) => extractIdString(d._id) === selectedId) ?? null
      : null;
  // Best-effort: pull the collection name out of the pinned command for header display.
  const inferredCollection =
    pinned?.match(/\bdb\.([\w$]+)/)?.[1] ?? "(console)";

  const errorMessage =
    run.data?.error ??
    (run.error instanceof ApiError
      ? run.error.message
      : run.error instanceof Error
        ? run.error.message
        : null);

  const aiError =
    ai.error instanceof ApiError
      ? ai.error.message
      : ai.error instanceof Error
        ? ai.error.message
        : null;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div
        className="relative flex flex-shrink-0 flex-col border-b border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/30"
        style={{ height: editorHeight }}
      >
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-1.5 text-[11px] dark:border-slate-800">
          <span className="font-mono text-slate-500 dark:text-slate-400">
            db.&lt;collection&gt;.&lt;method&gt;(…)
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setAiOpen((o) => !o)}
            className={[
              "flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium",
              aiOpen
                ? "border-violet-400 bg-violet-50 text-violet-700 dark:border-violet-500/40 dark:bg-violet-900/30 dark:text-violet-200"
                : "border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800",
            ].join(" ")}
          >
            <IconSparkles size={11} />
            AI
          </button>
          <kbd className="rounded border border-slate-300 px-1 text-[10px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
            ⌘/Ctrl + Enter
          </kbd>
        </div>

        {aiOpen && (
          <div className="flex items-stretch gap-2 border-b border-slate-200 bg-violet-50/50 px-4 py-2 dark:border-slate-800 dark:bg-violet-900/10">
            <input
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  aiPrompt.trim() &&
                  !ai.isPending
                ) {
                  e.preventDefault();
                  ai.mutate();
                }
              }}
              placeholder='Describe what to run, e.g. "delete users that never logged in"'
              className="flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
            <button
              type="button"
              onClick={() => ai.mutate()}
              disabled={!aiPrompt.trim() || ai.isPending}
              className="flex items-center gap-1 rounded bg-violet-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-violet-400 disabled:opacity-50"
            >
              {ai.isPending ? (
                <>
                  <IconLoader2 size={12} className="animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <IconSparkles size={12} />
                  Generate
                </>
              )}
            </button>
          </div>
        )}
        {ai.data?.explanation && (
          <div className="border-b border-violet-200 bg-violet-50 px-4 py-1 text-[11px] text-violet-800 dark:border-violet-700/30 dark:bg-violet-900/20 dark:text-violet-200">
            <span className="font-medium">
              {ai.data.provider} · {ai.data.model}
            </span>
            {" — "}
            {ai.data.explanation}
          </div>
        )}
        {aiError && (
          <div className="border-b border-red-200 bg-red-50 px-4 py-1 text-[11px] text-red-700 dark:border-red-700/30 dark:bg-red-900/20 dark:text-red-300">
            {aiError}
          </div>
        )}

        <div className="flex flex-1 items-stretch overflow-hidden">
          <div className="flex-1 overflow-hidden bg-white dark:bg-slate-900">
            <MonacoShellInput
              value={code}
              onChange={setCode}
              collections={collections}
              onSubmit={onRun}
              showLineNumbers
            />
          </div>
          <div className="flex flex-col items-stretch border-l border-slate-200 px-2 py-2 dark:border-slate-800">
            <button
              type="button"
              onClick={onRun}
              disabled={!code.trim() || run.isFetching}
              className="flex items-center gap-1.5 rounded bg-sky-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50"
            >
              {run.isFetching ? (
                <>
                  <IconLoader2 size={14} className="animate-spin" />
                  Running…
                </>
              ) : (
                <>
                  <IconPlayerPlayFilled size={14} />
                  Run
                </>
              )}
            </button>
          </div>
        </div>

        <div
          onMouseDown={onEditorResize}
          className="absolute -bottom-0.5 left-0 right-0 z-10 h-1 cursor-row-resize hover:bg-sky-500/40"
          title="Drag to resize"
        />
      </div>

      <ResultPanel
        format={resultView}
        onFormatChange={setResultView}
        rawValue={run.data?.result ?? null}
        isLoading={run.isFetching}
        errorMessage={errorMessage}
        elapsedMs={run.data?.elapsedMs ?? null}
        paging={
          run.data && run.data.paged
            ? {
                skip: run.data.skip,
                pageSize,
                total: null,
                hasMore: run.data.hasMore,
                onPrev: () => setPage((p) => Math.max(0, p - 1)),
                onNext: () => setPage((p) => p + 1),
                onPageSizeChange: (s) => {
                  setPageSize(s);
                  setPage(0);
                },
                pageSizes: PAGE_SIZES,
              }
            : null
        }
        emptyHint="Press ⌘/Ctrl + Enter to run."
        onRowClick={(id) => setSelectedId(id)}
      />

      {selectedDoc && (
        <DocumentEditor
          collectionName={inferredCollection}
          document={selectedDoc}
          onClose={() => setSelectedId(null)}
          readOnly
        />
      )}
    </div>
  );
};
