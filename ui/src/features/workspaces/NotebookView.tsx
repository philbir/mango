import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconAlertTriangle,
  IconBraces,
  IconLoader2,
  IconPlayerPlayFilled,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, extractIdString } from "../../api/client";
import { DocumentEditor } from "../editor/DocumentEditor";
import {
  MonacoShellInput,
  type MonacoShellInputHandle,
} from "../../components/MonacoShellInput";
import { useResize } from "../../components/useResize";
import { type PageSize, useSettings } from "../../settings";
import { useActiveConnection } from "../connections/useActiveConnection";
import { useActiveDatabase } from "../connections/useActiveDatabase";
import { ResultPanel, type ResultFormat } from "../documents/ResultPanel";
import { useTabs } from "../tabs/TabsContext";
import {
  type MangoFrontmatter,
  parseMd,
  serializeMd,
} from "./markdownDoc";
import {
  useExternalChangeWatch,
  useSaveWorkspaceFile,
  useWorkspaceFile,
} from "./useWorkspaceFile";
import { WorkspaceFileHeader } from "./WorkspaceFileHeader";

interface Props {
  tabId: string;
}

const PAGE_SIZES: PageSize[] = [50, 100, 200, 500];

const EMPTY_FM: MangoFrontmatter = {
  collection: null,
  connection: null,
  connectionId: null,
  database: null,
  fields: null,
};

export const NotebookView = ({ tabId }: Props) => {
  const { tabs, closeTab } = useTabs();
  const tab = tabs.find((t) => t.id === tabId) ?? null;
  const workspaceId = tab?.workspaceId ?? "";
  const filePath = tab?.workspaceFilePath ?? "";
  const { activeId, active } = useActiveConnection();
  const { database } = useActiveDatabase();
  const { pageSize, setPageSize } = useSettings();

  const fileQuery = useWorkspaceFile(workspaceId, filePath);
  const save = useSaveWorkspaceFile(workspaceId);

  const parsed = useMemo(
    () => (fileQuery.data?.raw ? parseMd(fileQuery.data.raw) : null),
    [fileQuery.data?.raw],
  );

  // The fenced ```mongo body is the editor's value. We preserve description
  // and frontmatter verbatim across saves so any prose the user already had
  // (or any extra fences we no longer render) round-trips untouched.
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [frontmatter, setFrontmatter] = useState<MangoFrontmatter>(EMPTY_FM);
  const [mtime, setMtime] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!parsed || !fileQuery.data) return;
    setCode(parsed.script);
    setDescription(parsed.description);
    setFrontmatter(parsed.frontmatter);
    setMtime(fileQuery.data.mtime);
    setSaveError(null);
  }, [parsed, fileQuery.data?.mtime]);

  // Derive dirty by comparing against the loaded baseline. Avoids false
  // positives when Monaco fires onChange during the programmatic setValue
  // that seeds the editor on file load.
  const dirty = useMemo(() => {
    if (!parsed) return false;
    return code !== parsed.script || description !== parsed.description;
  }, [code, description, parsed]);

  const editorRef = useRef<MonacoShellInputHandle | null>(null);
  const { size: editorHeight, onMouseDown: onEditorResize } = useResize({
    storageKey: "mango:notebook-editor-height",
    axis: "y",
    initial: 360,
    min: 200,
    max: 800,
  });

  const { externallyChangedAt, deleted } = useExternalChangeWatch(
    workspaceId,
    filePath,
    mtime,
    !!workspaceId && !!filePath,
  );

  const collectionsQuery = useQuery({
    queryKey: ["collections", activeId, database],
    queryFn: () => api.listCollections(activeId!, database ?? undefined),
    enabled: !!activeId && !!database,
    staleTime: 60_000,
  });
  const collections =
    collectionsQuery.data?.collections.map((c) => c.name) ?? [];

  const [resultView, setResultView] = useState<ResultFormat>("table");
  const [page, setPage] = useState(0);
  const [pinned, setPinned] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const skip = page * pageSize;
  const queryClient = useQueryClient();

  const run = useQuery({
    queryKey: ["nb-run", activeId, database, pinned, skip, pageSize],
    queryFn: async () => {
      if (!activeId || !pinned) return null;
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

  const runText = (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;
    setPage(0);
    setPinned(trimmed);
    setSelectedId(null);
  };

  // Same detection ResultPanel uses for the table view — if the result is an
  // array of plain objects, each row becomes a clickable detail-view target.
  const resultDocs = useMemo<Array<Record<string, unknown>> | null>(() => {
    const v = run.data?.result;
    if (!Array.isArray(v) || v.length === 0) return null;
    for (const r of v) {
      if (r === null || typeof r !== "object" || Array.isArray(r)) return null;
    }
    return v as Array<Record<string, unknown>>;
  }, [run.data?.result]);

  const selectedDoc = useMemo(() => {
    if (!selectedId || !resultDocs) return null;
    return (
      resultDocs.find((d) => extractIdString(d._id) === selectedId) ?? null
    );
  }, [selectedId, resultDocs]);

  // Update needs to know which collection a row came from. Prefer the explicit
  // frontmatter binding; otherwise infer from the script if it references
  // exactly one collection (e.g. `db.users.find()` → "users"). Anything more
  // ambiguous than that drops the panel into read-only mode.
  const inferredCollection = useMemo(() => {
    if (frontmatter.collection) return frontmatter.collection;
    const matches = code.matchAll(/\bdb\.([A-Za-z_$][\w$]*)\./g);
    const names = new Set<string>();
    for (const m of matches) names.add(m[1]!);
    return names.size === 1 ? [...names][0]! : null;
  }, [frontmatter.collection, code]);

  const canEditSelected =
    !!inferredCollection && !!selectedDoc && selectedDoc._id !== undefined;

  // Cmd+Enter (and the Run button) — selection if there is one, else whole file.
  const onRunSmart = () => {
    const sel = editorRef.current?.getSelectedText() ?? "";
    runText(sel.trim() ? sel : code);
  };

  const onRunAll = () => runText(code);

  const onSave = async () => {
    if (!workspaceId || !filePath) return;
    setSaveError(null);
    const refreshedFm: MangoFrontmatter = {
      ...frontmatter,
      connectionId: activeId ?? frontmatter.connectionId,
      connection: active?.name ?? frontmatter.connection,
      database: database ?? frontmatter.database,
    };
    const raw = serializeMd({
      frontmatter: refreshedFm,
      description,
      script: code,
    });
    try {
      const res = await save.mutateAsync({
        path: filePath,
        raw,
        expectedMtime: mtime,
      });
      setMtime(res.mtime);
    } catch (e) {
      if (e instanceof ApiError) {
        setSaveError(
          e.status === 409
            ? "File changed on disk. Reload to see external changes, then save again."
            : e.message,
        );
      } else {
        setSaveError(e instanceof Error ? e.message : String(e));
      }
    }
  };

  // Cmd/Ctrl + S → save in place.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        if (dirty && !save.isPending) void onSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, code, description, frontmatter, mtime, workspaceId, filePath]);

  if (!tab || !workspaceId || !filePath) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        Notebook tab is missing data.
      </div>
    );
  }

  if (fileQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        Loading…
      </div>
    );
  }

  if (fileQuery.isError) {
    return (
      <div className="m-4 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
        <div className="mb-2 font-medium">Failed to load file.</div>
        <div className="font-mono text-[11.5px]">
          {(fileQuery.error as Error)?.message}
        </div>
        <button
          type="button"
          onClick={() => fileQuery.refetch()}
          className="mt-2 rounded border border-red-300 bg-white px-2 py-1 text-[12px]"
        >
          Retry
        </button>
      </div>
    );
  }

  const onCodeChange = (next: string) => {
    setCode(next);
  };

  const errorMessage =
    run.data?.error ??
    (run.error instanceof ApiError
      ? run.error.message
      : run.error instanceof Error
        ? run.error.message
        : null);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <WorkspaceFileHeader
        workspaceId={workspaceId}
        filePath={filePath}
        dirty={dirty}
        saving={save.isPending}
        externallyChangedAt={externallyChangedAt}
        deleted={deleted}
        onSave={onSave}
        onReload={() => fileQuery.refetch()}
        onAfterDelete={() => closeTab(tabId)}
        onClose={() => closeTab(tabId)}
      />

      {deleted && (
        <div className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-3 py-1 text-[11.5px] text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
          <IconAlertTriangle size={12} />
          File was deleted on disk. Save will recreate it.
        </div>
      )}

      <div
        className="relative flex flex-shrink-0 flex-col border-b border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/30"
        style={{ height: editorHeight }}
      >
        <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-1 text-[11px] dark:border-slate-800">
          <span className="font-mono text-slate-500 dark:text-slate-400">
            mongo-shell · select to run a fragment, or run all
          </span>
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
          <button
            type="button"
            onClick={onRunAll}
            disabled={!code.trim() || run.isFetching}
            className="flex items-center gap-1 rounded border border-slate-300 px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            title="Run all"
          >
            Run all
          </button>
          <kbd className="rounded border border-slate-300 px-1 text-[10px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
            ⌘/Ctrl + Enter
          </kbd>
        </div>
        <div className="flex flex-1 items-stretch overflow-hidden">
          <div className="flex-1 overflow-hidden bg-white dark:bg-slate-900">
            <MonacoShellInput
              ref={editorRef}
              value={code}
              onChange={onCodeChange}
              collections={collections}
              onSubmit={onRunSmart}
              showLineNumbers
            />
          </div>
          <div className="flex flex-col items-stretch border-l border-slate-200 px-2 py-2 dark:border-slate-800">
            <button
              type="button"
              onClick={onRunSmart}
              disabled={!code.trim() || run.isFetching}
              className="flex items-center gap-1.5 rounded bg-sky-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50"
              title="Run selection if any, else run all (⌘/Ctrl + Enter)"
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

      {saveError && (
        <div className="border-b border-red-200 bg-red-50 px-3 py-1 text-[11.5px] text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
          {saveError}
        </div>
      )}

      <ResultPanel
        format={resultView}
        onFormatChange={setResultView}
        rawValue={run.data?.result ?? null}
        isLoading={run.isFetching}
        errorMessage={errorMessage}
        elapsedMs={run.data?.elapsedMs ?? null}
        onRowClick={(id) => setSelectedId(id)}
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
        emptyHint="Select a fragment or press ⌘/Ctrl + Enter to run."
      />

      {selectedDoc && (
        <DocumentEditor
          collectionName={inferredCollection ?? "(result)"}
          document={selectedDoc}
          readOnly={!canEditSelected}
          onClose={() => setSelectedId(null)}
          onSaved={() =>
            queryClient.invalidateQueries({ queryKey: ["nb-run"] })
          }
        />
      )}
    </div>
  );
};
