import {
  IconAlertCircle,
  IconAlertTriangle,
  IconBraces,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconLoader2,
  IconPencil,
  IconTable,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useMemo } from "react";
import { MonacoJsonInput } from "../../components/MonacoJsonInput";
import { MONGO_SHELL_LANGUAGE } from "../../monaco-mongo";
import { type PageSize, useSettings } from "../../settings";
import {
  formatDocument,
  formatDocumentList,
  isShellFormat,
} from "./docFormats";
import { DocumentTable, type TableSelection } from "./DocumentTable";

export type ResultFormat = "table" | "json";

export interface ResultPaging {
  skip: number;
  pageSize: number;
  total: number | null;
  hasMore: boolean;
  onPrev: () => void;
  onNext: () => void;
  onPageSizeChange?: (size: PageSize) => void;
  pageSizes?: PageSize[];
}

export interface ResultSelection extends TableSelection {
  /** Total selected (may span pages) — drives the batch action bar. */
  count: number;
  onDelete: () => void;
  onUpdate: () => void;
  onClear: () => void;
}

interface Props {
  format: ResultFormat;
  onFormatChange: (f: ResultFormat) => void;
  rawValue: unknown;
  isLoading: boolean;
  errorMessage: string | null;
  elapsedMs: number | null;
  paging: ResultPaging | null;
  truncated?: boolean;
  truncatedHint?: string | null;
  onRowClick?: (id: string) => void;
  /** Id of the row whose document is open in the detail drawer. */
  activeRowId?: string | null;
  emptyHint?: string;
  /** Enables row multi-select + a batch action bar. Table view only. */
  selection?: ResultSelection;
}

const formatElapsed = (ms: number): string => {
  if (ms < 1) return "<1 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
};

const asDocumentArray = (
  value: unknown,
): Array<Record<string, unknown>> | null => {
  if (!Array.isArray(value) || value.length === 0) return null;
  for (const v of value) {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  }
  return value as Array<Record<string, unknown>>;
};

export const ResultPanel = ({
  format,
  onFormatChange,
  rawValue,
  isLoading,
  errorMessage,
  elapsedMs,
  paging,
  truncated,
  truncatedHint,
  onRowClick,
  activeRowId,
  emptyHint,
  selection,
}: Props) => {
  const { jsonFormat, formatOptions } = useSettings();
  const documents = useMemo(() => asDocumentArray(rawValue), [rawValue]);
  const canTable = !!documents;
  // Same global format as the document drawer, so a document reads the same
  // in the list as when opened.
  const jsonText = useMemo(
    () =>
      rawValue === null || rawValue === undefined
        ? ""
        : documents
          ? formatDocumentList(documents, jsonFormat, formatOptions)
          : formatDocument(rawValue, jsonFormat, formatOptions),
    [documents, rawValue, jsonFormat, formatOptions],
  );

  // Effective format: if no tabular shape is available, force JSON.
  const effectiveFormat: ResultFormat = canTable ? format : "json";

  const showRange = paging && documents
    ? `Showing ${paging.skip + 1}–${paging.skip + documents.length}${
        paging.total != null ? ` of ${paging.total.toLocaleString()}` : ""
      }`
    : null;

  const hasResult = rawValue !== null && rawValue !== undefined;

  return (
    <section className="flex flex-1 flex-col overflow-hidden">
      <div className="flex h-8 flex-shrink-0 items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 text-[11.5px] dark:border-slate-800 dark:bg-slate-900/40">
        <span className="eyebrow">Result</span>
        {isLoading && (
          <span className="flex items-center gap-1 text-sky-600 dark:text-sky-300">
            <IconLoader2 size={13} className="animate-spin" /> running…
          </span>
        )}
        {!isLoading && errorMessage && (
          <span
            className="flex items-center gap-1 truncate text-red-600 dark:text-red-400"
            title={errorMessage}
          >
            <IconAlertCircle size={13} />
            <span className="truncate">{errorMessage}</span>
          </span>
        )}
        {!isLoading && !errorMessage && hasResult && elapsedMs != null && (
          <span className="flex items-center gap-1 tabular-nums text-emerald-600 dark:text-emerald-400">
            <IconCheck size={13} /> {formatElapsed(elapsedMs)}
          </span>
        )}
        {selection && selection.count > 0 && (
          <div className="flex items-center gap-0.5 rounded border border-sky-300 bg-sky-50 py-0.5 pl-2 pr-0.5 dark:border-sky-500/40 dark:bg-sky-500/10">
            <span className="mr-1 font-medium tabular-nums text-sky-700 dark:text-sky-200">
              {selection.count} selected
            </span>
            <button
              type="button"
              onClick={selection.onUpdate}
              title="Update selected documents"
              className="btn btn-sm gap-1 px-1.5 text-sky-700 hover:bg-sky-100 dark:text-sky-200 dark:hover:bg-sky-500/20"
            >
              <IconPencil size={13} />
              Update
            </button>
            <button
              type="button"
              onClick={selection.onDelete}
              title="Delete selected documents"
              className="btn btn-sm gap-1 px-1.5 text-red-600 hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-500/20"
            >
              <IconTrash size={13} />
              Delete
            </button>
            <button
              type="button"
              onClick={selection.onClear}
              title="Clear selection"
              className="btn-icon text-slate-500 hover:bg-slate-200 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
            >
              <IconX size={13} />
            </button>
          </div>
        )}
        <div className="flex-1" />
        {canTable && (
          <div className="seg">
            <FormatTab
              value="table"
              current={format}
              onChange={onFormatChange}
              icon={<IconTable size={13} />}
              label="Table"
            />
            <FormatTab
              value="json"
              current={format}
              onChange={onFormatChange}
              icon={<IconBraces size={13} />}
              label="JSON"
            />
          </div>
        )}
      </div>

      {truncated && (
        <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-[11px] text-amber-800 dark:border-amber-700/30 dark:bg-amber-900/20 dark:text-amber-200">
          <IconAlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
          <span>{truncatedHint ?? "Result truncated."}</span>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {!hasResult && !isLoading && !errorMessage && (
          <div className="p-4 text-[13px] text-slate-500 dark:text-slate-400">
            {emptyHint ?? "—"}
          </div>
        )}
        {hasResult && effectiveFormat === "table" && documents && (
          <DocumentTable
            documents={documents}
            loading={isLoading}
            onRowClick={onRowClick}
            activeRowId={activeRowId}
            selection={selection}
          />
        )}
        {hasResult && effectiveFormat === "json" && (
          <div className="h-full">
            <MonacoJsonInput
              key={`result-${jsonFormat}`}
              value={jsonText}
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
      </div>

      {paging && (
        <div className="flex h-8 flex-shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 text-[11.5px] dark:border-slate-800 dark:bg-slate-900/40">
          <div className="tabular-nums text-slate-600 dark:text-slate-400">
            {showRange ?? "—"}
          </div>
          <div className="flex items-center gap-3">
            {paging.onPageSizeChange && paging.pageSizes && (
              <label className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                <span>Rows</span>
                <select
                  value={paging.pageSize}
                  onChange={(e) =>
                    paging.onPageSizeChange?.(
                      Number(e.target.value) as PageSize,
                    )
                  }
                  className="h-6 min-h-0 rounded border border-slate-300 bg-white px-1 text-[11.5px] text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  {paging.pageSizes.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={paging.onPrev}
                disabled={paging.skip === 0 || isLoading}
                className="btn-icon btn-outline"
                title="Previous page"
              >
                <IconChevronLeft size={14} />
              </button>
              <button
                type="button"
                onClick={paging.onNext}
                disabled={!paging.hasMore || isLoading}
                className="btn-icon btn-outline"
                title="Next page"
              >
                <IconChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

const FormatTab = ({
  value,
  current,
  onChange,
  icon,
  label,
}: {
  value: ResultFormat;
  current: ResultFormat;
  onChange: (v: ResultFormat) => void;
  icon: React.ReactNode;
  label: string;
}) => (
  <button
    type="button"
    onClick={() => onChange(value)}
    className="seg-item min-h-[20px] px-1.5 text-[11px]"
    data-active={current === value}
  >
    {icon}
    {label}
  </button>
);
