import { useQuery } from "@tanstack/react-query";
import {
  IconAlertTriangle,
  IconBraces,
  IconChevronDown,
  IconChevronRight,
  IconLoader2,
  IconNotes,
  IconPlayerPlayFilled,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api } from "../../api/client";
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
  type MangoKind,
  parseMd,
  serializeMd,
} from "./markdownDoc";
import { NotebookView } from "./NotebookView";
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

export const WorkspaceFileView = ({ tabId }: Props) => {
  const { tabs, closeTab } = useTabs();
  const tab = tabs.find((t) => t.id === tabId);
  const { activeId, active } = useActiveConnection();
  const { database } = useActiveDatabase();
  const { pageSize, setPageSize } = useSettings();

  const workspaceId = tab?.workspaceId;
  const filePath = tab?.workspaceFilePath;

  const fileQuery = useWorkspaceFile(workspaceId ?? "", filePath ?? "");
  const save = useSaveWorkspaceFile(workspaceId ?? "");

  const parsed = useMemo(() => {
    if (!fileQuery.data?.raw) return null;
    return parseMd(fileQuery.data.raw);
  }, [fileQuery.data?.raw]);

  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [frontmatter, setFrontmatter] = useState<MangoFrontmatter>({
    kind: null,
    collection: null,
    connection: null,
    connectionId: null,
    database: null,
    fields: null,
  });
  const [mtime, setMtime] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [descriptionOpen, setDescriptionOpen] = useState(false);

  // Hydrate state from server response.
  useEffect(() => {
    if (!parsed || !fileQuery.data) return;
    setCode(parsed.script);
    setDescription(parsed.description);
    setFrontmatter(parsed.frontmatter);
    setMtime(fileQuery.data.mtime);
    setSaveError(null);
  }, [parsed, fileQuery.data?.mtime]);

  // Derive dirty from the loaded baseline so programmatic editor seeding
  // doesn't flip it on. Save success invalidates the file query, which
  // resets `parsed` and zeroes the diff again.
  const dirty = useMemo(() => {
    if (!parsed) return false;
    return (
      code !== parsed.script ||
      description !== parsed.description ||
      frontmatter.kind !== parsed.frontmatter.kind ||
      frontmatter.collection !== parsed.frontmatter.collection
    );
  }, [code, description, frontmatter, parsed]);

  const editorRef = useRef<MonacoShellInputHandle | null>(null);
  const { size: editorHeight, onMouseDown: onEditorResize } = useResize({
    storageKey: "mango:workspace-file-editor-height",
    axis: "y",
    initial: 240,
    min: 140,
    max: 600,
  });

  const { externallyChangedAt, deleted } = useExternalChangeWatch(
    workspaceId ?? "",
    filePath ?? "",
    mtime,
    !!workspaceId && !!filePath,
  );

  const collectionsQuery = useQuery({
    queryKey: ["collections", activeId, database],
    queryFn: () => api.listCollections(activeId!, database ?? undefined),
    enabled: !!activeId && !!database,
    staleTime: 60_000,
  });
  const collections = collectionsQuery.data?.collections.map((c) => c.name) ?? [];

  // Run state — same shape as ConsoleView.
  const [resultView, setResultView] = useState<ResultFormat>("table");
  const [page, setPage] = useState(0);
  const [pinned, setPinned] = useState<string | null>(null);
  const skip = page * pageSize;

  const run = useQuery({
    queryKey: ["ws-run", activeId, database, pinned, skip, pageSize],
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

  const onRun = () => {
    const cmd = code.trim();
    if (!cmd) return;
    setPage(0);
    setPinned(cmd);
  };

  const onSave = async () => {
    if (!workspaceId || !filePath) return;
    setSaveError(null);
    // Refresh connection/database metadata on save so the file always
    // remembers the connection it was last successfully run against —
    // that's what we route to next time it's opened.
    const refreshedFm = {
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
        setSaveError(String(e));
      }
    }
  };

  // Cmd/Ctrl + S → save in place.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        if (dirty) onSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, code, description, frontmatter, mtime, workspaceId, filePath]);

  // Free-form notebook files get a dedicated view with Code Lens "Run"
  // actions on every ```mongo``` fence. Branch must come after all hooks
  // above so hook order stays stable across renders.
  if (parsed?.frontmatter.kind === "notebook") {
    return <NotebookView tabId={tabId} />;
  }

  if (!tab || !workspaceId || !filePath) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        Workspace tab is missing data.
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

  const setKind = (kind: MangoKind) => {
    setFrontmatter((fm) => ({ ...fm, kind }));
  };

  const setCollection = (col: string) => {
    setFrontmatter((fm) => ({ ...fm, collection: col || null }));
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
        workspaceId={workspaceId ?? ""}
        filePath={filePath ?? ""}
        dirty={dirty}
        saving={save.isPending}
        externallyChangedAt={externallyChangedAt}
        deleted={deleted}
        onSave={onSave}
        onReload={() => fileQuery.refetch()}
        onAfterDelete={() => closeTab(tabId)}
        onClose={() => closeTab(tabId)}
      />

      <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50/30 px-3 py-1 text-[11px] dark:border-slate-800 dark:bg-slate-900/20">
        <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Kind
        </span>
        <select
          value={frontmatter.kind ?? "console"}
          onChange={(e) => setKind(e.target.value as MangoKind)}
          className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          title="Script kind"
        >
          <option value="query">query</option>
          <option value="console">console</option>
          <option value="shell">shell</option>
          <option value="aggregation">aggregation</option>
        </select>
        <input
          type="text"
          value={frontmatter.collection ?? ""}
          onChange={(e) => setCollection(e.target.value)}
          placeholder="collection"
          className="w-32 rounded border border-slate-300 bg-white px-1 py-0.5 font-mono text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
        />
      </div>

      {deleted && (
        <div className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-3 py-1 text-[11.5px] text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
          <IconAlertTriangle size={12} />
          File was deleted on disk. Save will recreate it.
        </div>
      )}

      <ConnectionMismatchBanner
        hint={frontmatter.connection}
        activeConnectionId={activeId}
      />

      {/*
        Description / notes — editable Markdown. Collapsed by default to keep
        the focus on the script; the user can expand to read or edit.
        On save, this body is serialized back into the .md file outside the
        ```mongo fence (see markdownDoc.ts), so the on-disk format stays a
        readable Markdown document with one executable code block.
      */}
      <div className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <button
          type="button"
          onClick={() => setDescriptionOpen((o) => !o)}
          className="flex w-full items-center gap-1.5 px-3 py-1 text-left text-[11.5px] text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/40"
        >
          {descriptionOpen ? (
            <IconChevronDown size={11} className="shrink-0 text-slate-400" />
          ) : (
            <IconChevronRight size={11} className="shrink-0 text-slate-400" />
          )}
          <IconNotes size={11} className="shrink-0 text-slate-400" />
          <span className="font-medium">Description</span>
          {!descriptionOpen && description.trim() && (
            <span className="truncate text-[11px] text-slate-400">
              · {description.trim().split(/\r?\n/)[0]}
            </span>
          )}
          {!descriptionOpen && !description.trim() && (
            <span className="text-[11px] text-slate-400">
              · empty (click to add notes)
            </span>
          )}
        </button>
        {descriptionOpen && (
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Notes for this query — Markdown. Headings, links, lists all welcome."
            className="block max-h-48 min-h-[5rem] w-full resize-y border-t border-slate-200 bg-white px-3 py-2 font-mono text-[12px] leading-relaxed text-slate-700 placeholder:text-slate-400 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
            spellCheck
          />
        )}
      </div>

      <div
        className="relative flex flex-shrink-0 flex-col border-b border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/30"
        style={{ height: editorHeight }}
      >
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-1 text-[11px] dark:border-slate-800">
          <span className="font-mono text-slate-500 dark:text-slate-400">
            {frontmatter.collection
              ? `db.${frontmatter.collection}.<method>(…)`
              : "db.<collection>.<method>(…)"}
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
      />
    </div>
  );
};

const ConnectionMismatchBanner = ({
  hint,
  activeConnectionId,
}: {
  hint: string | null;
  activeConnectionId: string | null;
}) => {
  const conns = useQuery({
    queryKey: ["connections-list-min"],
    queryFn: () => api.listConnections(),
    staleTime: 60_000,
  });
  if (!hint) return null;
  const active = conns.data?.connections.find((c) => c.id === activeConnectionId);
  const activeName = active?.name ?? "(unknown)";
  if (active?.name === hint) return null;
  return (
    <div className="flex items-center gap-2 border-b border-sky-200 bg-sky-50 px-3 py-1 text-[11.5px] text-sky-800 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-300">
      <IconAlertTriangle size={12} />
      Hint: this file references "{hint}" — running against "{activeName}".
    </div>
  );
};
