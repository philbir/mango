import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  IconBraces,
  IconInfoCircle,
  IconPlayerPlayFilled,
  IconTable,
  IconTerminal2,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, extractIdString } from "../../api/client";
import {
  MonacoJsonInput,
  type MonacoJsonInputHandle,
} from "../../components/MonacoJsonInput";
import { useResize } from "../../components/useResize";
import { type PageSize, useSettings } from "../../settings";
import {
  type ApplyKind,
  useAssistantBinding,
} from "../assistant/AssistantContext";
import { useActiveConnection } from "../connections/useActiveConnection";
import { useActiveDatabase } from "../connections/useActiveDatabase";
import { useTabs } from "../tabs/TabsContext";
import { DocumentEditor } from "../editor/DocumentEditor";
import { InfoView } from "../info/InfoView";
import { useServerConfig } from "../connections/useServerConfig";
import { SaveToWorkspaceDialog } from "../workspaces/SaveToWorkspaceDialog";
import { UnboundSaveHeader } from "../workspaces/UnboundSaveHeader";
import { useWorkspaceFileBinding } from "../workspaces/useWorkspaceFileBinding";
import { WorkspaceFileHeader } from "../workspaces/WorkspaceFileHeader";
import { ConsoleView } from "./ConsoleView";
import { FieldPicker, buildProjectionJson } from "./FieldPicker";
import { QueryBuilder } from "./QueryBuilder";
import { ResultPanel, type ResultFormat } from "./ResultPanel";

const PAGE_SIZES: PageSize[] = [50, 100, 200, 500];
const EMPTY_FILTER_TEMPLATE = "{\n  \n}";

interface CollectionViewProps {
  name: string;
  tabId?: string;
}

export const CollectionView = ({ name, tabId }: CollectionViewProps) => {
  const { pageSize, setPageSize, defaultCollectionMode } = useSettings();
  const { activeId, active } = useActiveConnection();
  const { database } = useActiveDatabase();
  const { tabs, closeTab } = useTabs();
  const tab = tabId ? tabs.find((t) => t.id === tabId) ?? null : null;

  const [filterDraft, setFilterDraft] = useState(EMPTY_FILTER_TEMPLATE);
  const [filter, setFilter] = useState("");
  const [selectedFields, setSelectedFields] = useState<Set<string>>(
    () => new Set(),
  );
  const [page, setPage] = useState(0);
  const [view, setView] = useState<ResultFormat>("table");
  // Initial page mode honors the tab's pinned mode (set when opening from
  // a `.mnq.md` query file or `.mnc.md` console file); otherwise we fall
  // back to the user's preference.
  const [pageMode, setPageMode] = useState<"query" | "console" | "info">(
    tab?.initialPageMode ?? defaultCollectionMode,
  );
  // In single-tab mode the tab object is mutated in place (same id) when
  // navigating to a new file, so the component doesn't remount and the
  // useState above stays stuck on the previous value. Re-sync whenever the
  // bound file path or its pinned mode changes.
  useEffect(() => {
    if (tab?.initialPageMode) setPageMode(tab.initialPageMode);
  }, [tab?.workspaceFilePath, tab?.initialPageMode]);
  const [queryMode, setQueryMode] = useState<"raw" | "builder">("raw");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const config = useServerConfig();
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Workspace-file binding: when this tab was opened from a workspace file,
  // we seed the filter from the file's stored script and Save writes it back.
  const fileBinding = useWorkspaceFileBinding({
    workspaceId: tab?.workspaceId,
    filePath: tab?.workspaceFilePath,
  });
  const [seededMtime, setSeededMtime] = useState<number | null>(null);
  const [filterDirty, setFilterDirty] = useState(false);

  /**
   * The body we store on disk for a `kind: query` file is just the filter
   * JSON. Projection lives in frontmatter (`fields:`) so the body stays
   * focused on what changes most often — the filter.
   */
  const buildQueryBody = (filterJson: string): string => {
    return filterJson.trim() || "{}";
  };

  /**
   * Read the filter out of a stored query body. Modern files store the
   * filter directly (a JSON object). Legacy files wrapped it as
   * `db.<col>.find(<filter>, <projection>?)` — we still parse those so
   * existing workspaces keep opening, but on save they get rewritten to
   * the filter-only form.
   *
   * We keep brace-matched substrings rather than calling JSON.parse so
   * MongoDB Extended JSON (`$oid`, `$date`, …) and comments survive the
   * round-trip.
   */
  const extractStoredFilter = (script: string): string | null => {
    const trimmed = script.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("{")) return trimmed;
    const m = /\bdb\.[\w$]+\.find\s*\(/.exec(script);
    if (!m) return null;
    let i = m.index + m[0].length;
    let depth = 0;
    let buf = "";
    let inString: '"' | "'" | "`" | null = null;
    while (i < script.length) {
      const ch = script[i]!;
      if (inString) {
        buf += ch;
        if (ch === "\\" && i + 1 < script.length) {
          buf += script[i + 1];
          i += 2;
          continue;
        }
        if (ch === inString) inString = null;
        i++;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        inString = ch;
        buf += ch;
        i++;
        continue;
      }
      if (ch === "{" || ch === "[" || ch === "(") {
        depth++;
        buf += ch;
        i++;
        continue;
      }
      if (ch === "}" || ch === "]") {
        depth--;
        buf += ch;
        i++;
        continue;
      }
      if (ch === ")" || (ch === "," && depth === 0)) {
        if (depth === 0) return buf.trim() || null;
        depth--;
        buf += ch;
        i++;
        continue;
      }
      buf += ch;
      i++;
    }
    return buf.trim() || null;
  };

  const normalizeFilter = (s: string): string => s.replace(/\s+/g, "");

  const { size: filterHeight, onMouseDown: onFilterResize } = useResize({
    storageKey: "mango:filter-height",
    axis: "y",
    initial: 180,
    min: 110,
    max: 480,
  });

  useEffect(() => {
    setPage(0);
    setSelectedId(null);
    setFilter("");
    setFilterDraft(EMPTY_FILTER_TEMPLATE);
    setSelectedFields(new Set());
  }, [name]);

  // Seed the filter from the bound workspace file. Fires on initial load
  // (seededMtime null) and whenever the file's mtime advances on disk —
  // EXCEPT when the user has unsaved edits (filterDirty), in which case we
  // preserve the in-flight edit instead of clobbering it on a refetch.
  useEffect(() => {
    if (!fileBinding.bound || fileBinding.mtime === null) return;
    if (seededMtime === fileBinding.mtime) return;
    if (seededMtime !== null && filterDirty) return;
    const filterFromFile = extractStoredFilter(fileBinding.script);
    if (filterFromFile) {
      setFilterDraft(filterFromFile);
      setFilter(filterFromFile);
    }
    // Seed projection field selection from frontmatter — this replaces the
    // older inline-projection encoding inside the find() call.
    const fmFields = fileBinding.frontmatter.fields;
    if (fmFields && fmFields.length > 0) {
      setSelectedFields(new Set(fmFields));
    } else {
      setSelectedFields(new Set());
    }
    setSeededMtime(fileBinding.mtime);
    setFilterDirty(false);
    setSaveError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileBinding.bound, fileBinding.mtime, fileBinding.script]);

  const saveBoundQuery = async (currentFields: Set<string>) => {
    if (!fileBinding.bound) return;
    setSaveError(null);
    try {
      const fieldList = [...currentFields];
      await fileBinding.save({
        frontmatter: {
          ...fileBinding.frontmatter,
          collection: name,
          connectionId: activeId ?? fileBinding.frontmatter.connectionId,
          connection: active?.name ?? fileBinding.frontmatter.connection,
          database: database ?? fileBinding.frontmatter.database,
          fields: fieldList.length > 0 ? fieldList : null,
        },
        description: fileBinding.description,
        script: buildQueryBody(filterDraft),
      });
      setFilterDirty(false);
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

  const skip = page * pageSize;
  const projection = useMemo(
    () => buildProjectionJson(selectedFields),
    [selectedFields],
  );

  // Mark the filter as dirty whenever the filter or selected-fields list
  // diverges from the bound file's stored values. Wait until the seeder
  // has run (seededMtime set) so we don't false-flip dirty on the initial
  // mount when filterDraft still holds the empty placeholder.
  useEffect(() => {
    if (!fileBinding.bound) return;
    if (seededMtime === null) return;
    const storedFilter = extractStoredFilter(fileBinding.script) ?? "{}";
    const filterChanged =
      normalizeFilter(buildQueryBody(filterDraft)) !==
      normalizeFilter(storedFilter);
    const stored = fileBinding.frontmatter.fields ?? [];
    const current = [...selectedFields].sort();
    const fieldsChanged =
      stored.length !== current.length ||
      [...stored].sort().some((f, i) => f !== current[i]);
    setFilterDirty(filterChanged || fieldsChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    fileBinding.bound,
    fileBinding.script,
    fileBinding.frontmatter.fields,
    filterDraft,
    selectedFields,
    seededMtime,
  ]);

  // Cmd/Ctrl + S → save bound file or open the save dialog (query mode).
  useEffect(() => {
    if (pageMode !== "query") return;
    if (!config.workspacesEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        if (fileBinding.bound) {
          if (filterDirty) void saveBoundQuery(selectedFields);
        } else if (filterDraft.trim()) {
          setShowSaveDialog(true);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageMode, config.workspacesEnabled, fileBinding.bound, filterDirty, filterDraft, projection]);

  // Track query timing for the footer status.
  const queryStartRef = useRef<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  const filterEditorRef = useRef<MonacoJsonInputHandle | null>(null);

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: [
      "docs",
      activeId,
      database,
      name,
      filter,
      projection,
      skip,
      pageSize,
    ],
    queryFn: () =>
      api.findDocuments({
        cid: activeId!,
        database: database ?? undefined,
        name,
        filter,
        projection: projection || undefined,
        skip,
        limit: pageSize,
      }),
    enabled: !!name && !!activeId,
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    if (isFetching) {
      queryStartRef.current = performance.now();
      setElapsedMs(null);
    } else if (queryStartRef.current !== null) {
      setElapsedMs(performance.now() - queryStartRef.current);
      queryStartRef.current = null;
    }
  }, [isFetching]);

  const onApplyFilter = (next?: string) => {
    const value = next ?? filterDraft;
    setFilterDraft(value);
    setFilter(value);
    setPage(0);
  };

  const docs = data?.documents ?? [];
  const selectedDoc = useMemo(() => {
    if (!selectedId) return null;
    return docs.find((d) => extractIdString(d._id) === selectedId) ?? null;
  }, [docs, selectedId]);

  const { data: schema } = useQuery({
    queryKey: ["schema", activeId, database, name],
    queryFn: () => api.getSchema(activeId!, name, 50, database ?? undefined),
    enabled: !!name && !!activeId,
    staleTime: 60_000,
  });

  const filterCompletion = useMemo(
    () => ({
      fields: schema?.fields.map((f) => f.path) ?? [],
      fieldTypes: Object.fromEntries(
        (schema?.fields ?? []).map((f) => [f.path, f.types]),
      ),
    }),
    [schema],
  );

  // The assistant's mode follows the active sub-tab inside the collection view:
  //  - Query mode → it can edit the filter / projection / sort BSON
  //  - Console mode → it can write a full db.<collection>.<method>(…) command
  // The inner ConsoleView (mounted when pageMode === "console") also binds
  // itself; its binding wins while it's mounted, and when it unmounts our
  // effect re-fires (supports list changes) and we re-bind.
  const handlerSupports: ApplyKind[] = useMemo(() => {
    if (pageMode === "console") return ["console"];
    if (pageMode === "info") return [];
    return ["filter", "projection", "sort", "pipeline"];
  }, [pageMode]);

  const assistantMode =
    pageMode === "console"
      ? "console"
      : pageMode === "info"
        ? "indexes"
        : "collection";

  useAssistantBinding({
    key: tabId ? `tab:${tabId}` : `collection:${name}`,
    mode: assistantMode,
    collection: name,
    handlers: {
      supports: handlerSupports,
      apply: (kind, payload) => {
        if (kind === "filter") {
          setFilterDraft(payload);
          onApplyFilter(payload);
          setQueryMode("raw");
          setPageMode("query");
        } else if (kind === "projection" || kind === "sort" || kind === "pipeline") {
          // No first-class slot for these on the query view yet — drop the user
          // into console mode and pre-fill an aggregation skeleton so they can
          // tweak it. (The pipeline payload is itself the most useful here.)
          setPageMode("console");
          if (kind === "pipeline") {
            window.dispatchEvent(
              new CustomEvent("mango:console:set", {
                detail: {
                  key: "*",
                  command: `db.${name}.aggregate(${payload})`,
                },
              }),
            );
          }
        } else if (kind === "console") {
          setPageMode("console");
          window.dispatchEvent(
            new CustomEvent("mango:console:set", {
              detail: { key: "*", command: payload },
            }),
          );
        }
      },
    },
  });

  return (
    <div className="flex h-full flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3 pr-12 dark:border-slate-800 dark:bg-slate-900/40">
        <IconTable size={18} className="text-sky-600 dark:text-sky-400" />
        <div className="flex-1">
          <div className="font-mono text-base text-slate-900 dark:text-slate-100">
            {name}
            {active?.name && (
              <span className="ml-1.5 font-sans text-[11px] font-normal text-slate-400 dark:text-slate-500">
                — {active.name}
              </span>
            )}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-500">
            {data ? `${data.total.toLocaleString()} documents` : "…"}
          </div>
        </div>
        <div className="flex rounded border border-slate-300 bg-white p-0.5 text-xs dark:border-slate-700 dark:bg-slate-900">
          <button
            type="button"
            onClick={() => setPageMode("query")}
            className={`flex items-center gap-1 rounded px-2 py-1 ${
              pageMode === "query"
                ? "bg-sky-500/15 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200"
                : "text-slate-600 dark:text-slate-300"
            }`}
          >
            <IconTable size={14} />
            Query
          </button>
          <button
            type="button"
            onClick={() => setPageMode("console")}
            className={`flex items-center gap-1 rounded px-2 py-1 ${
              pageMode === "console"
                ? "bg-sky-500/15 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200"
                : "text-slate-600 dark:text-slate-300"
            }`}
          >
            <IconTerminal2 size={14} />
            Console
          </button>
          <button
            type="button"
            onClick={() => setPageMode("info")}
            className={`flex items-center gap-1 rounded px-2 py-1 ${
              pageMode === "info"
                ? "bg-violet-500/15 text-violet-700 dark:bg-violet-500/20 dark:text-violet-200"
                : "text-slate-600 dark:text-slate-300"
            }`}
            title="Stats, indexes, and query plan playground"
          >
            <IconInfoCircle size={14} />
            Info
          </button>
        </div>
      </header>

      {pageMode === "console" && (
        <ConsoleView
          tabId={tabId}
          initialCommand={`db.${name}.find(\n{\n  \n})\n`}
          collection={name}
        />
      )}

      {pageMode === "info" && activeId && (
        <InfoView
          cid={activeId}
          database={database}
          collection={name}
          threadKey={tabId ? `tab:${tabId}` : `collection:${name}`}
        />
      )}

      {pageMode === "query" && (
      <>
      {fileBinding.bound && tab?.workspaceId && tab?.workspaceFilePath ? (
        <WorkspaceFileHeader
          workspaceId={tab.workspaceId}
          filePath={tab.workspaceFilePath}
          dirty={filterDirty}
          saving={fileBinding.saving}
          externallyChangedAt={fileBinding.externallyChangedAt}
          deleted={fileBinding.deleted}
          onSave={() => void saveBoundQuery(selectedFields)}
          onReload={() => fileBinding.reload()}
          onAfterDelete={() => tabId && closeTab(tabId)}
          onClose={tabId ? () => closeTab(tabId) : undefined}
        />
      ) : config.workspacesEnabled ? (
        <UnboundSaveHeader
          canSave={!!filterDraft.trim()}
          onSave={() => setShowSaveDialog(true)}
        />
      ) : null}
      <section
        className="relative flex flex-col border-b border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/30"
        style={{ height: filterHeight }}
      >
        <div className="flex items-center gap-2 px-5 pb-1 pt-3">
          <div className="flex rounded border border-slate-300 bg-white p-0.5 text-[11px] dark:border-slate-700 dark:bg-slate-900">
            <button
              type="button"
              onClick={() => setQueryMode("raw")}
              className={`rounded px-2 py-0.5 ${
                queryMode === "raw"
                  ? "bg-sky-500/15 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200"
                  : "text-slate-600 dark:text-slate-300"
              }`}
            >
              Raw
            </button>
            <button
              type="button"
              onClick={() => setQueryMode("builder")}
              className={`rounded px-2 py-0.5 ${
                queryMode === "builder"
                  ? "bg-sky-500/15 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200"
                  : "text-slate-600 dark:text-slate-300"
              }`}
            >
              Builder
            </button>
          </div>
          <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-500">
            Filter
          </span>
        </div>

        <div className="flex flex-1 gap-3 overflow-hidden px-5 pb-3 pt-1">
          <div className="flex flex-1 flex-col overflow-hidden">
            {queryMode === "raw" && (
              <div className="flex flex-1 items-stretch gap-2 overflow-hidden">
                <div className="flex-1 overflow-hidden rounded border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900">
                  <MonacoJsonInput
                    ref={filterEditorRef}
                    value={filterDraft}
                    onChange={setFilterDraft}
                    minHeight="64px"
                    completion={filterCompletion}
                    onSubmit={() => onApplyFilter()}
                  />
                </div>
                <div className="flex flex-col gap-1.5 self-start">
                  <button
                    type="button"
                    onClick={() => onApplyFilter()}
                    className="flex items-center gap-1.5 rounded bg-sky-500 px-3 py-2 text-sm font-medium text-white hover:bg-sky-400"
                  >
                    <IconPlayerPlayFilled size={14} />
                    Run
                  </button>
                  <button
                    type="button"
                    onClick={() => filterEditorRef.current?.format()}
                    className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    title="Format JSON (⇧⌥F)"
                  >
                    <IconBraces size={11} />
                    Format
                  </button>
                </div>
              </div>
            )}
            {queryMode === "builder" && (
              <div className="flex-1 overflow-y-auto pr-1">
                <QueryBuilder
                  collectionName={name}
                  filterJson={filterDraft}
                  onChange={setFilterDraft}
                  onRun={(json) => onApplyFilter(json)}
                />
              </div>
            )}
          </div>
          <div className="flex w-60 flex-col overflow-hidden">
            <FieldPicker
              fields={schema?.fields.map((f) => f.path) ?? []}
              selected={selectedFields}
              onChange={setSelectedFields}
            />
          </div>
        </div>

        <div
          onMouseDown={onFilterResize}
          className="absolute -bottom-0.5 left-0 right-0 z-10 h-1 cursor-row-resize hover:bg-sky-500/40"
          title="Drag to resize"
        />
      </section>

      <ResultPanel
        format={view}
        onFormatChange={setView}
        rawValue={data?.documents ?? null}
        isLoading={isLoading || isFetching}
        errorMessage={isError ? (error as Error).message : null}
        elapsedMs={elapsedMs}
        paging={
          data
            ? {
                skip,
                pageSize,
                total: data.total,
                hasMore: data.hasMore,
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
        onRowClick={(id) => setSelectedId(id)}
        emptyHint="No matching documents."
      />

      </>
      )}

      {selectedDoc && (
        <DocumentEditor
          collectionName={name}
          document={selectedDoc}
          onClose={() => setSelectedId(null)}
        />
      )}

      {showSaveDialog && (
        <SaveToWorkspaceDialog
          connectionId={activeId}
          kind="query"
          script={buildQueryBody(filterDraft)}
          collection={name}
          fields={[...selectedFields]}
          suggestedFilename={`${name}-find`}
          onClose={() => setShowSaveDialog(false)}
        />
      )}

      {pageMode === "query" && saveError && (
        <div className="border-t border-red-200 bg-red-50 px-3 py-1 text-[11.5px] text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
          {saveError}
        </div>
      )}
    </div>
  );
};

