// File browser for a single GridFS bucket. Lists files with metadata, a
// search-by-name input, and per-row actions (preview / download / delete).
// Clicking a row opens GridFsViewer in a modal.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconFiles,
  IconRefresh,
  IconSearch,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import {
  type GridFsFileMeta,
  api,
  extractIdString,
} from "../../api/client";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { showToast } from "../../components/toasts";
import { useActiveDatabase } from "../connections/useActiveDatabase";
import { useTabs } from "../tabs/TabsContext";
import { GridFsViewer, resolveFileContentType } from "./GridFsViewer";

interface Props {
  tabId: string;
}

const PAGE_SIZE = 100;

export const GridFsView = ({ tabId }: Props) => {
  const { tabs } = useTabs();
  const tab = tabs.find((t) => t.id === tabId);
  const { database: activeDatabase } = useActiveDatabase();
  const queryClient = useQueryClient();
  const cid = tab?.connectionId ?? "";
  const bucket = tab?.bucket ?? "";
  const database = tab?.database ?? activeDatabase ?? undefined;

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [skip, setSkip] = useState(0);
  const [selected, setSelected] = useState<GridFsFileMeta | null>(null);
  const [pendingDelete, setPendingDelete] = useState<GridFsFileMeta | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  // Debounce the search input so typing doesn't fire a new query per keystroke.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setSkip(0);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [search]);

  const filesQuery = useQuery({
    queryKey: ["gridfs-files", cid, bucket, database, debouncedSearch, skip],
    queryFn: () =>
      api.listGridFsFiles({
        cid,
        bucket,
        database,
        search: debouncedSearch || undefined,
        skip,
        limit: PAGE_SIZE,
      }),
    enabled: !!cid && !!bucket,
  });

  if (!tab || !cid || !bucket) {
    return (
      <div className="p-4 text-xs text-slate-500 dark:text-slate-400">
        Tab not found.
      </div>
    );
  }

  const data = filesQuery.data;
  const files = data?.files ?? [];

  const onDelete = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await api.deleteGridFsFile({
        cid,
        bucket,
        fileId: extractIdString(pendingDelete._id),
        database,
      });
      showToast({
        kind: "success",
        title: `Deleted ${pendingDelete.filename}`,
      });
      // Close the drawer if we just deleted the file it was previewing.
      if (
        selected &&
        extractIdString(selected._id) === extractIdString(pendingDelete._id)
      ) {
        setSelected(null);
      }
      setPendingDelete(null);
      queryClient.invalidateQueries({
        queryKey: ["gridfs-files", cid, bucket, database],
      });
      queryClient.invalidateQueries({
        queryKey: ["collections", cid, database],
      });
    } catch (e) {
      showToast({
        kind: "error",
        title: e instanceof Error ? e.message : "Delete failed",
      });
    } finally {
      setBusy(false);
    }
  };

  const total = data?.total ?? 0;
  const hasMore = data?.hasMore ?? false;
  const fromIdx = total === 0 ? 0 : skip + 1;
  const toIdx = Math.min(total, skip + files.length);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white dark:bg-slate-950">
      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <IconFiles size={16} className="text-emerald-500" />
        <div className="flex items-baseline gap-1.5 text-sm">
          <span className="font-semibold text-slate-800 dark:text-slate-100">
            {bucket}
          </span>
          <span className="text-[11px] text-slate-400">GridFS bucket</span>
          {database && (
            <span className="text-[11px] text-slate-500">· {database}</span>
          )}
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-950">
          <IconSearch size={12} className="text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by filename…"
            className="w-56 bg-transparent text-[12px] text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
          />
        </div>
        <button
          type="button"
          onClick={() => filesQuery.refetch()}
          className="rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          title="Refresh"
        >
          <IconRefresh
            size={13}
            className={filesQuery.isFetching ? "animate-spin" : ""}
          />
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {filesQuery.isLoading && (
          <div className="p-4 text-xs text-slate-400">Loading files…</div>
        )}
        {filesQuery.isError && (
          <div className="m-3 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
            {(filesQuery.error as Error).message}
          </div>
        )}
        {!filesQuery.isLoading && files.length === 0 && (
          <div className="p-4 text-xs text-slate-500 dark:text-slate-400">
            {debouncedSearch
              ? "No files match that filter."
              : "Bucket is empty."}
          </div>
        )}
        {files.length > 0 && (
          <table className="w-full table-fixed border-collapse text-[12.5px]">
            <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
              <tr>
                <th className="w-[44%] px-3 py-1.5 font-medium">Filename</th>
                <th className="w-[22%] px-3 py-1.5 font-medium">Type</th>
                <th className="w-[14%] px-3 py-1.5 text-right font-medium">
                  Size
                </th>
                <th className="w-[20%] px-3 py-1.5 font-medium">Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => {
                const fileId = extractIdString(file._id);
                const isSelected =
                  selected != null && extractIdString(selected._id) === fileId;
                const contentType =
                  resolveFileContentType(file) ?? "application/octet-stream";
                return (
                  <tr
                    key={fileId}
                    onClick={() => setSelected(file)}
                    className={[
                      "cursor-pointer border-b border-slate-100 dark:border-slate-800/60",
                      isSelected
                        ? "bg-sky-500/10 dark:bg-sky-500/15"
                        : "hover:bg-slate-50 dark:hover:bg-slate-900/40",
                    ].join(" ")}
                  >
                    <td className="truncate px-3 py-1.5 font-mono text-slate-700 dark:text-slate-200">
                      {file.filename}
                    </td>
                    <td className="truncate px-3 py-1.5 text-slate-600 dark:text-slate-300">
                      {contentType}
                    </td>
                    <td className="px-3 py-1.5 text-right text-slate-600 dark:text-slate-300">
                      {formatBytes(file.length)}
                    </td>
                    <td className="truncate px-3 py-1.5 text-slate-500 dark:text-slate-400">
                      {formatDate(file.uploadDate)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {total > 0 && (
        <div className="flex items-center justify-between border-t border-slate-200 px-3 py-1.5 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
          <span>
            {fromIdx.toLocaleString()}–{toIdx.toLocaleString()} of{" "}
            {total.toLocaleString()}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSkip(Math.max(0, skip - PAGE_SIZE))}
              disabled={skip === 0}
              className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-40 dark:border-slate-700"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => setSkip(skip + PAGE_SIZE)}
              disabled={!hasMore}
              className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-40 dark:border-slate-700"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {selected && (
        <GridFsViewer
          cid={cid}
          bucket={bucket}
          database={database}
          file={selected}
          onClose={() => setSelected(null)}
          onDelete={(file) => setPendingDelete(file)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete file"
          message={`Delete "${pendingDelete.filename}"? This cannot be undone.`}
          confirmLabel={busy ? "Deleting…" : "Delete"}
          danger
          onCancel={() => (busy ? undefined : setPendingDelete(null))}
          onConfirm={onDelete}
        />
      )}
    </div>
  );
};

const formatBytes = (n: number | null | undefined): string => {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
};

const formatDate = (value: unknown): string => {
  if (!value) return "—";
  if (value instanceof Date) return value.toLocaleString();
  if (typeof value === "string") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString();
    return value;
  }
  if (typeof value === "object" && value && "$date" in (value as object)) {
    const inner = (value as { $date: unknown }).$date;
    if (typeof inner === "string") {
      const d = new Date(inner);
      if (!Number.isNaN(d.getTime())) return d.toLocaleString();
    }
  }
  return String(value);
};

