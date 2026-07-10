import { useQueries, useQuery } from "@tanstack/react-query";
import {
  IconBraces,
  IconLoader2,
  IconPlayerPlayFilled,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, extractIdString } from "../../api/client";
import { SaveToWorkspaceDialog } from "../workspaces/SaveToWorkspaceDialog";
import { UnboundSaveHeader } from "../workspaces/UnboundSaveHeader";
import { useWorkspaceFileBinding } from "../workspaces/useWorkspaceFileBinding";
import { WorkspaceFileHeader } from "../workspaces/WorkspaceFileHeader";
import { useServerConfig } from "../connections/useServerConfig";
import { useTabs } from "../tabs/TabsContext";
import {
  MonacoShellInput,
  type MonacoShellInputHandle,
  setMongoShellSchemas,
} from "../../components/MonacoShellInput";
import { useResize } from "../../components/useResize";
import { type PageSize, useSettings } from "../../settings";
import {
  type ApplyKind,
  useAssistantBinding,
} from "../assistant/AssistantContext";
import { useActiveConnection } from "../connections/useActiveConnection";
import { useActiveDatabase } from "../connections/useActiveDatabase";
import { DocumentEditor } from "../editor/DocumentEditor";
import { ResultPanel, type ResultFormat } from "./ResultPanel";

interface Props {
  initialCommand?: string;
  tabId?: string;
  /**
   * Collection this console is scoped to. Set when ConsoleView is mounted
   * inside CollectionView's console tab. Console files always carry a
   * collection in their frontmatter, so we only allow Save-to-workspace
   * when one is known (either passed in here or inferred from the script).
   */
  collection?: string;
}

const PAGE_SIZES: PageSize[] = [50, 100, 200, 500];

const inferCollection = (script: string): string | null => {
  const m = /\bdb\.([\w$]+)\b/.exec(script);
  return m?.[1] ?? null;
};

export const ConsoleView = ({
  initialCommand = "db.\n",
  tabId,
  collection: collectionProp,
}: Props) => {
  const { activeId, active } = useActiveConnection();
  const { database } = useActiveDatabase();
  const { pageSize, setPageSize } = useSettings();
  const config = useServerConfig();
  const { tabs, closeTab } = useTabs();
  const tab = tabId ? tabs.find((t) => t.id === tabId) ?? null : null;
  const fileBinding = useWorkspaceFileBinding({
    workspaceId: tab?.workspaceId,
    filePath: tab?.workspaceFilePath,
  });
  const [code, setCode] = useState(initialCommand);
  const [resultView, setResultView] = useState<ResultFormat>("table");
  const editorRef = useRef<MonacoShellInputHandle | null>(null);
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Pin the command for paging — we re-run the same command across page changes
  // until the user presses Run, which re-pins.
  const [pinned, setPinned] = useState<string | null>(null);

  // Seed editor from the bound file once it loads (or when external changes
  // are reloaded). We only overwrite while not dirty so an in-progress edit
  // isn't clobbered by a re-fetch.
  const [seededMtime, setSeededMtime] = useState<number | null>(null);
  useEffect(() => {
    if (!fileBinding.bound) return;
    if (fileBinding.mtime === null) return;
    if (seededMtime === fileBinding.mtime && !dirty) return;
    if (dirty) return;
    setCode(fileBinding.script || "");
    setSeededMtime(fileBinding.mtime);
    setDirty(false);
    setSaveError(null);
  }, [fileBinding.bound, fileBinding.mtime, fileBinding.script, dirty, seededMtime]);

  const onCodeChange = (next: string) => {
    setCode(next);
    if (fileBinding.bound) setDirty(next !== fileBinding.script);
  };

  const saveBound = async () => {
    if (!fileBinding.bound) return;
    setSaveError(null);
    try {
      await fileBinding.save({
        frontmatter: {
          ...fileBinding.frontmatter,
          collection:
            collectionProp ??
            fileBinding.frontmatter.collection ??
            inferCollection(code),
          connectionId: activeId ?? fileBinding.frontmatter.connectionId,
          connection: active?.name ?? fileBinding.frontmatter.connection,
          database: database ?? fileBinding.frontmatter.database,
        },
        description: fileBinding.description,
        script: code,
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

  const onRun = () => {
    const cmd = code.trim();
    if (!cmd) return;
    // When the command and page are unchanged the query key doesn't move,
    // so React Query won't refetch — but Run should always re-query for
    // fresh data, so force a refetch in that case.
    const unchanged = cmd === pinned && page === 0;
    setPage(0);
    setPinned(cmd);
    if (unchanged) void run.refetch();
  };

  const handlerSupports: ApplyKind[] = useMemo(() => ["console"], []);
  useAssistantBinding({
    key: tabId ? `tab:${tabId}` : "console",
    mode: "console",
    collection: null,
    handlers: {
      supports: handlerSupports,
      apply: (kind, payload) => {
        if (kind === "console") {
          setCode(payload);
        }
      },
    },
  });

  // Cmd/Ctrl+S → save back to the bound file when one is bound, otherwise
  // open the "save to workspace" dialog. No-op when nothing's pending or
  // workspaces are off.
  useEffect(() => {
    if (!config.workspacesEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S")) {
        if (fileBinding.bound) {
          e.preventDefault();
          if (dirty) void saveBound();
          return;
        }
        if (!code.trim()) return;
        e.preventDefault();
        setShowSaveDialog(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.workspacesEnabled, code, fileBinding.bound, dirty]);

  // Pick up commands sent from other views (e.g. CollectionView routing a
  // `mango-console` block from the assistant into the active console tab).
  useEffect(() => {
    const onSet = (e: Event) => {
      const detail = (e as CustomEvent<{ key: string; command: string }>).detail;
      if (!detail) return;
      if (detail.key === tabId || detail.key === "*") {
        setCode(detail.command);
      }
    };
    window.addEventListener("mango:console:set", onSet);
    return () => window.removeEventListener("mango:console:set", onSet);
  }, [tabId]);

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

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {fileBinding.bound && tab?.workspaceId && tab?.workspaceFilePath ? (
        <WorkspaceFileHeader
          workspaceId={tab.workspaceId}
          filePath={tab.workspaceFilePath}
          dirty={dirty}
          saving={fileBinding.saving}
          externallyChangedAt={fileBinding.externallyChangedAt}
          deleted={fileBinding.deleted}
          onSave={saveBound}
          onReload={() => fileBinding.reload()}
          onAfterDelete={() => tabId && closeTab(tabId)}
          onClose={tabId ? () => closeTab(tabId) : undefined}
        />
      ) : config.workspacesEnabled && (collectionProp || inferCollection(code)) ? (
        <UnboundSaveHeader
          canSave={!!code.trim()}
          onSave={() => setShowSaveDialog(true)}
        />
      ) : null}
      {fileBinding.bound && saveError && (
        <div className="border-b border-red-200 bg-red-50 px-3 py-1 text-[11.5px] text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
          {saveError}
        </div>
      )}
      {fileBinding.bound && fileBinding.loadError && (
        <div className="border-b border-red-200 bg-red-50 px-3 py-1 text-[11.5px] text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
          {fileBinding.loadError}
        </div>
      )}
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
            onClick={() => editorRef.current?.format()}
            className="flex items-center gap-1 rounded border border-slate-300 px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            title="Format command (⇧⌥F or ⌘⇧F)"
          >
            <IconBraces size={11} />
            Format
          </button>
          <kbd className="mr-12 rounded border border-slate-300 px-1 text-[10px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
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

      {showSaveDialog && (
        <SaveToWorkspaceDialog
          connectionId={activeId}
          kind="console"
          script={code}
          collection={collectionProp ?? inferCollection(code)}
          onClose={() => setShowSaveDialog(false)}
        />
      )}
    </div>
  );
};
