import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  IconPlayerPlayFilled,
  IconSparkles,
  IconTable,
  IconTerminal2,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, extractIdString } from "../../api/client";
import { MonacoJsonInput } from "../../components/MonacoJsonInput";
import { useResize } from "../../components/useResize";
import { type PageSize, useSettings } from "../../settings";
import { useActiveConnection } from "../connections/useActiveConnection";
import { useActiveDatabase } from "../connections/useActiveDatabase";
import { DocumentEditor } from "../editor/DocumentEditor";
import { AiQueryPrompt } from "./AiQueryPrompt";
import { ConsoleView } from "./ConsoleView";
import { FieldPicker, buildProjectionJson } from "./FieldPicker";
import { QueryBuilder } from "./QueryBuilder";
import { ResultPanel, type ResultFormat } from "./ResultPanel";

const PAGE_SIZES: PageSize[] = [50, 100, 200, 500];
const EMPTY_FILTER_TEMPLATE = "{\n  \n}";

interface CollectionViewProps {
  name: string;
}

export const CollectionView = ({ name }: CollectionViewProps) => {
  const { pageSize, setPageSize, defaultCollectionMode } = useSettings();
  const { activeId } = useActiveConnection();
  const { database } = useActiveDatabase();

  const [filterDraft, setFilterDraft] = useState(EMPTY_FILTER_TEMPLATE);
  const [filter, setFilter] = useState("");
  const [selectedFields, setSelectedFields] = useState<Set<string>>(
    () => new Set(),
  );
  const [page, setPage] = useState(0);
  const [view, setView] = useState<ResultFormat>("table");
  const [pageMode, setPageMode] = useState<"query" | "console">(
    defaultCollectionMode,
  );
  const [queryMode, setQueryMode] = useState<"raw" | "builder" | "ai">("raw");
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  const skip = page * pageSize;
  const projection = useMemo(
    () => buildProjectionJson(selectedFields),
    [selectedFields],
  );

  // Track query timing for the footer status.
  const queryStartRef = useRef<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

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

  return (
    <div className="flex h-full flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3 dark:border-slate-800 dark:bg-slate-900/40">
        <IconTable size={18} className="text-sky-600 dark:text-sky-400" />
        <div className="flex-1">
          <div className="font-mono text-base text-slate-900 dark:text-slate-100">{name}</div>
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
        </div>
      </header>

      {pageMode === "console" && (
        <ConsoleView initialCommand={`db.${name}.find(\n{\n  \n})\n`} />
      )}

      {pageMode === "query" && (
      <>
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
            <button
              type="button"
              onClick={() => setQueryMode("ai")}
              className={`flex items-center gap-1 rounded px-2 py-0.5 ${
                queryMode === "ai"
                  ? "bg-violet-500/15 text-violet-700 dark:bg-violet-500/20 dark:text-violet-200"
                  : "text-slate-600 dark:text-slate-300"
              }`}
            >
              <IconSparkles size={11} />
              AI
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
                    value={filterDraft}
                    onChange={setFilterDraft}
                    minHeight="64px"
                    completion={filterCompletion}
                    onSubmit={() => onApplyFilter()}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => onApplyFilter()}
                  className="flex items-center gap-1.5 self-start rounded bg-sky-500 px-3 py-2 text-sm font-medium text-white hover:bg-sky-400"
                >
                  <IconPlayerPlayFilled size={14} />
                  Run
                </button>
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
            {queryMode === "ai" && (
              <div className="flex-1 overflow-y-auto pr-1">
                <AiQueryPrompt
                  collectionName={name}
                  onApply={(json) => {
                    setFilterDraft(json);
                    onApplyFilter(json);
                  }}
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
    </div>
  );
};

