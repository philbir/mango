import { useMutation, useQueryClient } from "@tanstack/react-query";
import { IconAlertTriangle, IconEraser, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import { ApiError, api, type ClearCollectionsResult } from "../../api/client";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { useTabs } from "../tabs/TabsContext";

interface Props {
  cid: string;
  database: string;
}

type ConfirmAction = "clear" | "drop" | null;

export const DevToolsTab = ({ cid, database }: Props) => {
  const queryClient = useQueryClient();
  const { tabs, closeTab } = useTabs();
  const [confirming, setConfirming] = useState<ConfirmAction>(null);
  const [dropTyped, setDropTyped] = useState("");
  const [lastClearResult, setLastClearResult] =
    useState<ClearCollectionsResult | null>(null);

  const clear = useMutation({
    mutationFn: () => api.clearDatabaseCollections(cid, database),
    onSuccess: (data) => {
      setConfirming(null);
      setLastClearResult(data);
      queryClient.invalidateQueries({
        queryKey: ["database-stats", cid, database],
      });
      queryClient.invalidateQueries({ queryKey: ["collections", cid, database] });
    },
  });

  const drop = useMutation({
    mutationFn: () => api.dropDatabase(cid, database),
    onSuccess: () => {
      setConfirming(null);
      setDropTyped("");
      queryClient.invalidateQueries({ queryKey: ["databases", cid] });
      queryClient.invalidateQueries({ queryKey: ["collections", cid] });
      // The database is gone — close every tab tied to it.
      tabs
        .filter(
          (t) =>
            t.connectionId === cid &&
            ((t.kind === "database" && t.database === database) ||
              t.database === database),
        )
        .forEach((t) => closeTab(t.id));
    },
  });

  const mutationError =
    confirming === "clear" ? clear.error : confirming === "drop" ? drop.error : null;
  const errorMessage =
    mutationError instanceof ApiError
      ? mutationError.message
      : mutationError instanceof Error
        ? mutationError.message
        : null;

  return (
    <>
      <div className="space-y-5 p-5">
        <header className="flex items-start gap-2">
          <IconAlertTriangle
            size={16}
            className="mt-0.5 flex-shrink-0 text-amber-500"
          />
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Dev tools
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Destructive actions enabled by{" "}
              <span className="font-mono">MANGO_DEV_MODE</span>. Operations
              cannot be undone.
            </p>
          </div>
        </header>

        <section className="rounded border border-slate-200 p-4 dark:border-slate-700">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <IconEraser size={14} /> Clear all collections
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Deletes every document from every collection in{" "}
                <span className="font-mono font-semibold">{database}</span>.
                Indexes, views, and system collections are preserved.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                clear.reset();
                setLastClearResult(null);
                setConfirming("clear");
              }}
              className="flex-shrink-0 rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Clear collections
            </button>
          </div>
          {lastClearResult && (
            <div className="mt-3 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-700/40 dark:bg-emerald-900/20 dark:text-emerald-300">
              Cleared {lastClearResult.results.length} collection
              {lastClearResult.results.length === 1 ? "" : "s"}. Total deleted:{" "}
              {lastClearResult.results
                .reduce((sum, r) => sum + (r.deletedCount ?? 0), 0)
                .toLocaleString()}
              .
            </div>
          )}
        </section>

        <section className="rounded border border-red-200 p-4 dark:border-red-900/40">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-red-700 dark:text-red-300">
                <IconTrash size={14} /> Delete database
              </h3>
              <p className="mt-1 text-xs text-red-700/80 dark:text-red-300/80">
                Drops{" "}
                <span className="font-mono font-semibold">{database}</span> and
                every collection, document, and index inside it.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                drop.reset();
                setDropTyped("");
                setConfirming("drop");
              }}
              className="flex-shrink-0 rounded bg-red-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-400"
            >
              Delete database
            </button>
          </div>
        </section>
      </div>

      {confirming === "clear" && (
        <ConfirmDialog
          title="Clear all collections?"
          message={
            <div className="space-y-2">
              <div>
                Every document in every collection of{" "}
                <span className="font-mono font-semibold">{database}</span> will
                be deleted. Cannot be undone.
              </div>
              {errorMessage && (
                <div className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
                  {errorMessage}
                </div>
              )}
            </div>
          }
          confirmLabel="Clear"
          danger
          busy={clear.isPending}
          onConfirm={() => clear.mutate()}
          onCancel={() => {
            if (!clear.isPending) {
              clear.reset();
              setConfirming(null);
            }
          }}
        />
      )}

      {confirming === "drop" && (
        <ConfirmDialog
          title="Delete database?"
          message={
            <div className="space-y-2">
              <div>
                This will permanently drop{" "}
                <span className="font-mono font-semibold">{database}</span> and
                everything in it. Type the database name to confirm.
              </div>
              <input
                type="text"
                value={dropTyped}
                onChange={(e) => setDropTyped(e.target.value)}
                placeholder={database}
                className="w-full rounded border border-slate-300 bg-white px-2 py-1 font-mono text-sm text-slate-900 focus:border-red-400 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                autoFocus
              />
              {errorMessage && (
                <div className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
                  {errorMessage}
                </div>
              )}
            </div>
          }
          confirmLabel={dropTyped === database ? "Delete" : "Type the name"}
          danger
          busy={drop.isPending}
          onConfirm={() => {
            if (dropTyped === database) drop.mutate();
          }}
          onCancel={() => {
            if (!drop.isPending) {
              drop.reset();
              setDropTyped("");
              setConfirming(null);
            }
          }}
        />
      )}
    </>
  );
};
