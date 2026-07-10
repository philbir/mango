import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { useMemo } from "react";
import { extractIdString, formatUuid } from "../../api/client";
import { useSettings, type UuidRepresentation } from "../../settings";

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
  selection?: TableSelection;
}

const formatCell = (
  value: unknown,
  uuidRepresentation: UuidRepresentation,
): string => {
  if (value === null || value === undefined) return "—";
  const uuid = formatUuid(value, uuidRepresentation);
  if (uuid !== null) return uuid;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (value instanceof Date) return value.toISOString();
  if (
    typeof value === "object" &&
    "$oid" in (value as Record<string, unknown>)
  ) {
    return String((value as Record<string, unknown>).$oid);
  }
  if (
    typeof value === "object" &&
    "$date" in (value as Record<string, unknown>)
  ) {
    const v = (value as Record<string, unknown>).$date;
    return typeof v === "string" ? v : JSON.stringify(v);
  }
  if (
    typeof value === "object" &&
    "$numberDecimal" in (value as Record<string, unknown>)
  ) {
    return String((value as Record<string, unknown>).$numberDecimal);
  }
  if (
    typeof value === "object" &&
    "$numberInt" in (value as Record<string, unknown>)
  ) {
    return String((value as Record<string, unknown>).$numberInt);
  }
  if (
    typeof value === "object" &&
    "$numberLong" in (value as Record<string, unknown>)
  ) {
    return String((value as Record<string, unknown>).$numberLong);
  }
  try {
    const s = JSON.stringify(value);
    return s.length > 80 ? `${s.slice(0, 77)}…` : s;
  } catch {
    return String(value);
  }
};

const COLUMN_LIMIT = 12;

export const DocumentTable = ({
  documents,
  loading,
  onRowClick,
  selection,
}: Props) => {
  const { uuidRepresentation } = useSettings();

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

  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () =>
      columnNames.map((name) => ({
        id: name,
        accessorFn: (row) => row[name],
        header: name,
        size: name === "_id" ? 260 : 180,
        minSize: 60,
        maxSize: 800,
        cell: (ctx) => (
          <span className="font-mono text-[12px] text-slate-700 dark:text-slate-200">
            {formatCell(ctx.getValue(), uuidRepresentation)}
          </span>
        ),
      })),
    [columnNames, uuidRepresentation],
  );

  const table = useReactTable({
    data: documents,
    columns,
    getCoreRowModel: getCoreRowModel(),
    enableColumnResizing: true,
    columnResizeMode: "onChange",
  });

  const SELECT_COL_WIDTH = 38;

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
                  className="border-b border-slate-200 px-2 py-2 text-center dark:border-slate-700"
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
                  className="group relative select-none border-b border-slate-200 px-3 py-2 text-left text-[12px] font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200"
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
                          ? "bg-sky-500"
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
                className="px-3 py-6 text-center text-sm text-slate-400"
              >
                Loading…
              </td>
            </tr>
          )}
          {!loading && documents.length === 0 && (
            <tr>
              <td
                colSpan={columns.length + (selection ? 1 : 0) || 1}
                className="px-3 py-6 text-center text-sm text-slate-400"
              >
                No documents.
              </td>
            </tr>
          )}
          {table.getRowModel().rows.map((row) => {
            const id = extractIdString(row.original._id);
            const isSelected = selection?.selectedIds.has(id) ?? false;
            return (
              <tr
                key={id}
                onClick={() => onRowClick?.(id)}
                className={`cursor-pointer ${
                  isSelected
                    ? "bg-sky-50 hover:bg-sky-100 dark:bg-sky-500/10 dark:hover:bg-sky-500/20"
                    : "hover:bg-slate-100 dark:hover:bg-slate-800/60"
                }`}
              >
                {selection && (
                  <td
                    className="border-b border-slate-200 px-2 py-1.5 text-center dark:border-slate-800"
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
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className="truncate border-b border-slate-200 px-3 py-1.5 dark:border-slate-800"
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
