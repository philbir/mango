import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { useMemo } from "react";
import { extractIdString, formatUuid } from "../../api/client";
import { useSettings } from "../../settings";

interface Props {
  documents: Array<Record<string, unknown>>;
  loading?: boolean;
  onRowClick?: (id: string) => void;
}

const formatCell = (
  value: unknown,
  uuidFormat: "canonical" | "short" | "compact" | "raw",
): string => {
  if (value === null || value === undefined) return "—";
  const uuid = formatUuid(value, uuidFormat);
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

export const DocumentTable = ({ documents, loading, onRowClick }: Props) => {
  const { uuidFormat } = useSettings();

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
            {formatCell(ctx.getValue(), uuidFormat)}
          </span>
        ),
      })),
    [columnNames, uuidFormat],
  );

  const table = useReactTable({
    data: documents,
    columns,
    getCoreRowModel: getCoreRowModel(),
    enableColumnResizing: true,
    columnResizeMode: "onChange",
  });

  return (
    <div className="h-full overflow-auto">
      <table
        className="border-separate border-spacing-0"
        style={{
          width: table.getCenterTotalSize(),
          tableLayout: "fixed",
        }}
      >
        <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-900">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
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
                colSpan={columns.length || 1}
                className="px-3 py-6 text-center text-sm text-slate-400"
              >
                Loading…
              </td>
            </tr>
          )}
          {!loading && documents.length === 0 && (
            <tr>
              <td
                colSpan={columns.length || 1}
                className="px-3 py-6 text-center text-sm text-slate-400"
              >
                No documents.
              </td>
            </tr>
          )}
          {table.getRowModel().rows.map((row) => {
            const id = extractIdString(row.original._id);
            return (
              <tr
                key={id}
                onClick={() => onRowClick?.(id)}
                className="cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/60"
              >
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
