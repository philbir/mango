import {
  columnResizingFeature,
  columnSizingFeature,
  flexRender,
  tableFeatures,
  useTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { useEffect, useMemo, useRef } from "react";
import { extractIdString } from "../../api/client";
import { useSettings } from "../../settings";
import { formatCellValue } from "./docFormats";

export interface TableSelection {
  /** Currently-selected row id strings (may span pages). */
  selectedIds: Set<string>;
  /** Toggle a single row; `rawId` is the untouched BSON `_id` for filter building. */
  onToggle: (id: string, rawId: unknown, selected: boolean) => void;
  /** Toggle every row on the current page at once. */
  onToggleAll: (
    rows: Array<{ id: string; rawId: unknown }>,
    selected: boolean,
  ) => void;
}

interface Props {
  documents: Array<Record<string, unknown>>;
  loading?: boolean;
  onRowClick?: (id: string) => void;
  /** Row whose document is open in the detail drawer — highlighted, and the
   * anchor for ↑/↓ keyboard navigation. */
  activeRowId?: string | null;
  selection?: TableSelection;
}

// Keys typed into these belong to the control, not to row navigation.
const isEditableTarget = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  !!target.closest(
    'input:not([type="checkbox"]), textarea, select, [contenteditable="true"], .monaco-editor',
  );

const COLUMN_LIMIT = 12;

// Left accent bar on the active row's first cell.
const ACTIVE_BAR = "shadow-[inset_3px_0_0_var(--color-sky-500)]";

const features = tableFeatures({ columnSizingFeature, columnResizingFeature });
type Doc = Record<string, unknown>;

export const DocumentTable = ({
  documents,
  loading,
  onRowClick,
  activeRowId,
  selection,
}: Props) => {
  const { formatOptions } = useSettings();
  const activeRowRef = useRef<HTMLTableRowElement | null>(null);

  // Rows of the current page as {id, rawId} for select-all + header state.
  const pageRows = useMemo(
    () =>
      documents.map((d) => ({ id: extractIdString(d._id), rawId: d._id })),
    [documents],
  );
  const selectedOnPage = useMemo(() => {
    if (!selection) return 0;
    let n = 0;
    for (const r of pageRows) if (selection.selectedIds.has(r.id)) n++;
    return n;
  }, [selection, pageRows]);
  const allOnPageSelected =
    pageRows.length > 0 && selectedOnPage === pageRows.length;

  const columnNames = useMemo(() => {
    const seen = new Set<string>();
    seen.add("_id");
    for (const doc of documents) {
      for (const key of Object.keys(doc)) {
        if (seen.size >= COLUMN_LIMIT) break;
        seen.add(key);
      }
      if (seen.size >= COLUMN_LIMIT) break;
    }
    return Array.from(seen);
  }, [documents]);

  const columns = useMemo<ColumnDef<typeof features, Doc>[]>(
    () =>
      columnNames.map((name) => ({
        id: name,
        accessorFn: (row) => row[name],
        header: name,
        size: name === "_id" ? 260 : 180,
        minSize: 60,
        maxSize: 800,
        cell: (ctx) => (
          <span className="font-mono text-[12px] text-slate-800 dark:text-slate-200">
            {formatCellValue(ctx.getValue(), formatOptions)}
          </span>
        ),
      })),
    [columnNames, formatOptions],
  );

  const table = useTable({
    features,
    data: documents,
    columns,
    enableColumnResizing: true,
    columnResizeMode: "onChange",
  });

  const SELECT_COL_WIDTH = 38;

  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeRowId]);

  // ↑/↓ steps the open document through the rows of the current page. Only
  // active while a drawer is open, and paused while the drawer is editing or
  // showing a confirm dialog so navigation can't discard pending work.
  useEffect(() => {
    if (!activeRowId || !onRowClick) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      if (isEditableTarget(e.target)) return;
      if (document.querySelector("[data-doc-editor-locked]")) return;
      const idx = pageRows.findIndex((r) => r.id === activeRowId);
      if (idx === -1) return;
      const next = pageRows[idx + (e.key === "ArrowDown" ? 1 : -1)];
      e.preventDefault();
      if (next) onRowClick(next.id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeRowId, onRowClick, pageRows]);

  return (
    <div className="h-full overflow-auto">
      <table
        className="border-separate border-spacing-0"
        style={{
          width: table.getCenterTotalSize() + (selection ? SELECT_COL_WIDTH : 0),
          tableLayout: "fixed",
        }}
      >
        <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-900">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {selection && (
                <th
                  className="border-b border-slate-300 px-2 py-1.5 text-center dark:border-slate-700"
                  style={{ width: SELECT_COL_WIDTH }}
                >
                  <input
                    type="checkbox"
                    aria-label="Select all rows on this page"
                    className="cursor-pointer align-middle accent-sky-500"
                    checked={allOnPageSelected}
                    ref={(el) => {
                      if (el)
                        el.indeterminate =
                          selectedOnPage > 0 && !allOnPageSelected;
                    }}
                    onChange={(e) =>
                      selection.onToggleAll(pageRows, e.target.checked)
                    }
                  />
                </th>
              )}
              {hg.headers.map((h) => (
                <th
                  key={h.id}
                  className="group relative select-none border-b border-slate-300 px-3 py-1.5 text-left font-mono text-[11.5px] font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                  style={{ width: h.getSize() }}
                >
                  <span className="block truncate">
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </span>
                  {h.column.getCanResize() && (
                    <span
                      onMouseDown={h.getResizeHandler()}
                      onTouchStart={h.getResizeHandler()}
                      onClick={(e) => e.stopPropagation()}
                      className={[
                        "absolute right-0 top-0 z-20 h-full w-1 cursor-col-resize touch-none",
                        h.column.getIsResizing()
                          ? "bg-accent"
                          : "bg-transparent group-hover:bg-slate-300 dark:group-hover:bg-slate-600",
                      ].join(" ")}
                    />
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {loading && documents.length === 0 && (
            <tr>
              <td
                colSpan={columns.length + (selection ? 1 : 0) || 1}
                className="px-3 py-6 text-center text-sm text-slate-500"
              >
                Loading…
              </td>
            </tr>
          )}
          {!loading && documents.length === 0 && (
            <tr>
              <td
                colSpan={columns.length + (selection ? 1 : 0) || 1}
                className="px-3 py-6 text-center text-sm text-slate-500"
              >
                No documents.
              </td>
            </tr>
          )}
          {table.getRowModel().rows.map((row) => {
            const id = extractIdString(row.original._id);
            const isSelected = selection?.selectedIds.has(id) ?? false;
            const isActive = activeRowId === id;
            return (
              <tr
                key={id}
                ref={isActive ? activeRowRef : undefined}
                aria-current={isActive ? "true" : undefined}
                onClick={() => onRowClick?.(id)}
                className={`cursor-pointer ${
                  isActive
                    ? "bg-sky-100 dark:bg-sky-500/25"
                    : isSelected
                      ? "bg-sky-50 hover:bg-sky-100 dark:bg-sky-500/10 dark:hover:bg-sky-500/20"
                      : "hover:bg-slate-100 dark:hover:bg-slate-800/60"
                }`}
              >
                {selection && (
                  <td
                    className={`border-b border-slate-200 px-2 py-1.5 text-center dark:border-slate-800 ${
                      isActive ? ACTIVE_BAR : ""
                    }`}
                    style={{ width: SELECT_COL_WIDTH }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      aria-label="Select row"
                      className="cursor-pointer align-middle accent-sky-500"
                      checked={isSelected}
                      onChange={(e) =>
                        selection.onToggle(id, row.original._id, e.target.checked)
                      }
                    />
                  </td>
                )}
                {row.getAllCells().map((cell, i) => (
                  <td
                    key={cell.id}
                    className={`truncate border-b border-slate-200 px-3 py-1.5 dark:border-slate-800 ${
                      isActive && !selection && i === 0 ? ACTIVE_BAR : ""
                    }`}
                    style={{ width: cell.column.getSize() }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
