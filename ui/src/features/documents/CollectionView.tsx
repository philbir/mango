import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  IconBraces,
  IconChevronLeft,
  IconChevronRight,
  IconPlayerPlayFilled,
  IconSparkles,
  IconTable,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { api, extractIdString } from "../../api/client";
import { InteractiveJsonView } from "../../components/JsonView";
import { MonacoJsonInput } from "../../components/MonacoJsonInput";
import { type PageSize, useSettings } from "../../settings";
import { useActiveConnection } from "../connections/useActiveConnection";
import { DocumentEditor } from "../editor/DocumentEditor";
import { AiQueryPrompt } from "./AiQueryPrompt";
import { QueryBuilder } from "./QueryBuilder";
import { DocumentTable } from "./DocumentTable";

const PAGE_SIZES: PageSize[] = [50, 100, 200, 500];
const EMPTY_FILTER_TEMPLATE = "{\n  \n}";

export const CollectionView = () => {
  const { name = "" } = useParams<{ name: string }>();
  const { pageSize, setPageSize } = useSettings();
  const { activeId } = useActiveConnection();

  const [filterDraft, setFilterDraft] = useState(EMPTY_FILTER_TEMPLATE);
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);
  const [view, setView] = useState<"table" | "json">("table");
  const [queryMode, setQueryMode] = useState<"raw" | "builder" | "ai">("raw");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    setPage(0);
    setSelectedId(null);
    setFilter("");
    setFilterDraft(EMPTY_FILTER_TEMPLATE);
  }, [name]);

  const skip = page * pageSize;

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ["docs", activeId, name, filter, skip, pageSize],
    queryFn: () =>
      api.findDocuments({ cid: activeId!, name, filter, skip, limit: pageSize }),
    enabled: !!name && !!activeId,
    placeholderData: keepPreviousData,
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

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
    queryKey: ["schema", activeId, name],
    queryFn: () => api.getSchema(activeId!, name, 50),
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
            onClick={() => setView("table")}
            className={`flex items-center gap-1 rounded px-2 py-1 ${
              view === "table"
                ? "bg-sky-500/15 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200"
                : "text-slate-600 dark:text-slate-300"
            }`}
          >
            <IconTable size={14} />
            Table
          </button>
          <button
            type="button"
            onClick={() => setView("json")}
            className={`flex items-center gap-1 rounded px-2 py-1 ${
              view === "json"
                ? "bg-sky-500/15 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200"
                : "text-slate-600 dark:text-slate-300"
            }`}
          >
            <IconBraces size={14} />
            JSON
          </button>
        </div>
      </header>

      <section className="border-b border-slate-200 bg-slate-50/60 px-5 py-3 dark:border-slate-800 dark:bg-slate-900/30">
        <div className="mb-2 flex items-center gap-2">
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
        {queryMode === "raw" && (
          <div className="flex items-stretch gap-2">
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
              className="flex items-center gap-1.5 rounded bg-sky-500 px-3 text-sm font-medium text-white hover:bg-sky-400"
            >
              <IconPlayerPlayFilled size={14} />
              Run
            </button>
          </div>
        )}
        {queryMode === "builder" && (
          <QueryBuilder
            collectionName={name}
            initialJson={filterDraft}
            onRun={(json) => onApplyFilter(json)}
          />
        )}
        {queryMode === "ai" && (
          <AiQueryPrompt
            collectionName={name}
            onApply={(json) => {
              setFilterDraft(json);
              onApplyFilter(json);
            }}
          />
        )}
      </section>

      <section className="flex-1 overflow-hidden">
        {isError && (
          <div className="px-5 py-4 text-sm text-red-500 dark:text-red-400">
            {(error as Error).message}
          </div>
        )}
        {!isError && view === "table" && (
          <DocumentTable
            documents={docs}
            loading={isLoading || isFetching}
            onRowClick={(id) => setSelectedId(id)}
          />
        )}
        {!isError && view === "json" && (
          <div className="h-full overflow-auto p-3">
            <InteractiveJsonView value={docs} collapsed={1} />
          </div>
        )}
      </section>

      <footer className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-2 text-sm dark:border-slate-800 dark:bg-slate-900/40">
        <div className="text-slate-500 dark:text-slate-400">
          {data
            ? `Showing ${data.skip + 1}–${data.skip + docs.length} of ${data.total.toLocaleString()}`
            : "—"}
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <span>Page size</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value) as PageSize);
                setPage(0);
              }}
              className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {PAGE_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="flex items-center rounded border border-slate-300 px-2 py-1 text-slate-600 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200"
            >
              <IconChevronLeft size={14} />
            </button>
            <div className="font-mono text-xs text-slate-500 dark:text-slate-300">
              {page + 1} / {totalPages}
            </div>
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              disabled={!data?.hasMore}
              className="flex items-center rounded border border-slate-300 px-2 py-1 text-slate-600 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200"
            >
              <IconChevronRight size={14} />
            </button>
          </div>
        </div>
      </footer>

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
