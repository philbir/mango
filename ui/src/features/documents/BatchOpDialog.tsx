import { useMutation, useQueryClient } from "@tanstack/react-query";
import { IconAlertTriangle, IconX } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { ApiError, api, parseEJSON } from "../../api/client";
import { MonacoJsonInput } from "../../components/MonacoJsonInput";
import { useActiveConnection } from "../connections/useActiveConnection";
import { useActiveDatabase } from "../connections/useActiveDatabase";

export type BatchOp = "delete" | "update";

interface Props {
  collectionName: string;
  /** Canonical-EJSON filter string the operation targets. */
  filterEJSON: string;
  /** Number of documents the filter targets, for the summary line. */
  count: number | null;
  initialOp: BatchOp;
  onClose: () => void;
  /** Called after a successful op — the host clears its selection. */
  onDone: () => void;
}

const DEFAULT_UPDATE = '{\n  "$set": {\n    \n  }\n}';

export const BatchOpDialog = ({
  collectionName,
  filterEJSON: filterProp,
  count: countProp,
  initialOp,
  onClose,
  onDone,
}: Props) => {
  const { activeId } = useActiveConnection();
  const { database } = useActiveDatabase();
  const queryClient = useQueryClient();

  // Snapshot the target at open time. The op runs against exactly the rows
  // selected when the dialog opened, even if the host clears its selection
  // after a successful run (which it does, to reset the checkboxes).
  const [filterEJSON] = useState(filterProp);
  const [count] = useState(countProp);

  const [op, setOp] = useState<BatchOp>(initialOp);
  const [updateText, setUpdateText] = useState(DEFAULT_UPDATE);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const command = useMemo(() => {
    if (op === "delete") {
      return `db.${collectionName}.deleteMany(\n  ${filterEJSON}\n)`;
    }
    return `db.${collectionName}.updateMany(\n  ${filterEJSON},\n  ${updateText.trim() || "{}"}\n)`;
  }, [op, collectionName, filterEJSON, updateText]);

  const run = useMutation({
    mutationFn: async () => {
      if (!activeId) throw new Error("No active connection");
      if (op === "delete") {
        return api.deleteMany(
          activeId,
          collectionName,
          filterEJSON,
          database ?? undefined,
        );
      }
      return api.updateMany(
        activeId,
        collectionName,
        filterEJSON,
        updateText,
        database ?? undefined,
      );
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["docs", activeId] });
      if ("deletedCount" in res) {
        setResult(`Deleted ${res.deletedCount} document(s).`);
      } else {
        setResult(
          `Matched ${res.matchedCount}, modified ${res.modifiedCount} document(s).`,
        );
      }
      setError(null);
      onDone();
    },
    onError: (e) => {
      setError(
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e),
      );
    },
  });

  const onConfirm = () => {
    setError(null);
    if (op === "update") {
      // Validate the update body client-side for a friendlier error than the
      // server's generic 400 — the server re-checks regardless.
      let parsed: unknown;
      try {
        parsed = parseEJSON(updateText);
      } catch (e) {
        setError(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setError("Update body must be a JSON object.");
        return;
      }
      const keys = Object.keys(parsed as Record<string, unknown>);
      if (keys.length === 0) {
        setError("Update is empty.");
        return;
      }
      if (keys.some((k) => !k.startsWith("$"))) {
        setError("Update body must contain only operator keys ($set, $unset, …).");
        return;
      }
    }
    run.mutate();
  };

  const busy = run.isPending;
  const danger = op === "delete";

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
        <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          {danger && (
            <IconAlertTriangle
              size={18}
              className="flex-shrink-0 text-red-500"
            />
          )}
          <div className="flex-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
            Batch {op === "delete" ? "delete" : "update"}
            {count != null && (
              <span className="ml-1.5 font-normal text-slate-500 dark:text-slate-400">
                · {count.toLocaleString()} document{count === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <div className="flex rounded border border-slate-300 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900">
            <OpTab value="update" current={op} onChange={setOp} label="Update" />
            <OpTab value="delete" current={op} onChange={setOp} label="Delete" />
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
          >
            <IconX size={14} />
          </button>
        </header>

        <div className="flex-1 space-y-3 overflow-auto px-4 py-3">
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Filter
            </div>
            <pre className="max-h-32 overflow-auto rounded border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[11.5px] leading-relaxed text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
              {filterEJSON}
            </pre>
          </div>

          {op === "update" && (
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Update (operator body)
              </div>
              <div className="h-40 overflow-hidden rounded border border-slate-300 dark:border-slate-700">
                <MonacoJsonInput
                  value={updateText}
                  onChange={setUpdateText}
                  minHeight="100%"
                />
              </div>
            </div>
          )}

          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Will execute
            </div>
            <pre className="overflow-auto rounded border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[11.5px] leading-relaxed text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
              {command}
            </pre>
          </div>

          {error && (
            <div className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
              {error}
            </div>
          )}
          {result && !error && (
            <div className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs text-emerald-700 dark:border-emerald-700/40 dark:bg-emerald-900/20 dark:text-emerald-300">
              {result}
            </div>
          )}
        </div>

        <footer className="flex items-center gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-700">
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {result ? "Close" : "Cancel"}
          </button>
          {!result && (
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className={`rounded px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${
                danger
                  ? "bg-red-500 hover:bg-red-400"
                  : "bg-sky-500 hover:bg-sky-400"
              }`}
            >
              {busy
                ? "…"
                : op === "delete"
                  ? "Delete"
                  : "Update"}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
};

const OpTab = ({
  value,
  current,
  onChange,
  label,
}: {
  value: BatchOp;
  current: BatchOp;
  onChange: (v: BatchOp) => void;
  label: string;
}) => (
  <button
    type="button"
    onClick={() => onChange(value)}
    className={`rounded px-2 py-0.5 text-[11px] ${
      current === value
        ? value === "delete"
          ? "bg-red-500/15 text-red-700 dark:bg-red-500/20 dark:text-red-200"
          : "bg-sky-500/15 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200"
        : "text-slate-600 dark:text-slate-300"
    }`}
  >
    {label}
  </button>
);
