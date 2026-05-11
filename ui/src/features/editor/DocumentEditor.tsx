import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  IconAlertTriangle,
  IconDeviceFloppy,
  IconPencil,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  api,
  extractIdString,
  formatDocumentId,
  parseEJSON,
  stringifyEJSON,
} from "../../api/client";
import { MonacoJsonInput } from "../../components/MonacoJsonInput";
import { useActiveConnection } from "../connections/useActiveConnection";
import { useActiveDatabase } from "../connections/useActiveDatabase";
import { useSettings } from "../../settings";

interface Props {
  collectionName: string;
  document: Record<string, unknown>;
  onClose: () => void;
  readOnly?: boolean;
}

type Mode = "view" | "edit";

const stripId = (doc: Record<string, unknown>): Record<string, unknown> => {
  const { _id: _ignored, ...rest } = doc;
  return rest;
};

export const DocumentEditor = ({
  collectionName,
  document: doc,
  onClose,
  readOnly = false,
}: Props) => {
  const { activeId } = useActiveConnection();
  const { database } = useActiveDatabase();
  const { uuidFormat } = useSettings();
  const queryClient = useQueryClient();

  const id = extractIdString(doc._id);
  const idDisplay = formatDocumentId(doc._id, uuidFormat);
  const fullJson = useMemo(() => stringifyEJSON(doc), [doc]);
  const editJson = useMemo(() => stringifyEJSON(stripId(doc)), [doc]);

  const [mode, setMode] = useState<Mode>("view");
  const [editText, setEditText] = useState(editJson);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Reset state when the document changes (different row clicked).
  useEffect(() => {
    setMode("view");
    setEditText(editJson);
    setError(null);
    setSavedAt(null);
  }, [editJson]);

  const save = useMutation({
    mutationFn: async () => {
      let parsed: unknown;
      try {
        parsed = parseEJSON(editText);
      } catch (e) {
        throw new Error(
          `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      if (
        !parsed ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      ) {
        throw new Error("Body must be a JSON object.");
      }
      if (!activeId) throw new Error("No active connection");
      const merged = { _id: doc._id, ...(parsed as Record<string, unknown>) };
      return api.putDocument(
        activeId,
        collectionName,
        id,
        stringifyEJSON(merged),
        database ?? undefined,
      );
    },
    onSuccess: (result) => {
      setEditText(stringifyEJSON(stripId(result.document)));
      setSavedAt(Date.now());
      setError(null);
      setMode("view");
      queryClient.invalidateQueries({ queryKey: ["docs", activeId] });
    },
    onError: (e) => {
      const message =
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
      setError(message);
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!activeId) throw new Error("No active connection");
      return api.deleteDocument(
        activeId,
        collectionName,
        id,
        database ?? undefined,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["docs", activeId] });
      onClose();
    },
    onError: (e) => {
      const message =
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
      setError(message);
    },
  });

  const onClickDelete = () => {
    if (
      confirm(
        `Delete this document?\n\n_id: ${id}\n\nThis cannot be undone.`,
      )
    ) {
      remove.mutate();
    }
  };

  const onCancelEdit = () => {
    setEditText(editJson);
    setMode("view");
    setError(null);
  };

  const isViewing = mode === "view";

  return (
    <div className="fixed inset-0 z-30 flex items-stretch justify-end bg-black/50">
      <div className="flex h-full w-1/2 min-w-[480px] flex-col border-l border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900">
        <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-500">
              {collectionName}
              {!isViewing && (
                <span className="ml-1.5 rounded bg-amber-500/15 px-1.5 py-px text-[9px] font-semibold text-amber-700 dark:text-amber-300">
                  EDITING
                </span>
              )}
            </div>
            <div className="truncate font-mono text-sm text-slate-900 dark:text-slate-100">
              {idDisplay}
            </div>
          </div>

          {isViewing && !readOnly && (
            <>
              <button
                type="button"
                onClick={() => setMode("edit")}
                className="flex items-center gap-1.5 rounded border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <IconPencil size={13} />
                Update
              </button>
              <button
                type="button"
                onClick={onClickDelete}
                disabled={remove.isPending}
                className="flex items-center gap-1.5 rounded border border-red-300 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-700/40 dark:text-red-300 dark:hover:bg-red-900/20"
              >
                <IconTrash size={13} />
                {remove.isPending ? "Deleting…" : "Delete"}
              </button>
            </>
          )}
          {!isViewing && (
            <>
              <button
                type="button"
                onClick={onCancelEdit}
                className="rounded border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => save.mutate()}
                disabled={save.isPending}
                className="flex items-center gap-1.5 rounded bg-sky-500 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-sky-400 disabled:opacity-50"
              >
                <IconDeviceFloppy size={13} />
                {save.isPending ? "Saving…" : "Save"}
              </button>
            </>
          )}

          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            title="Close"
          >
            <IconX size={18} />
          </button>
        </header>

        {!isViewing && (
          <div className="flex items-center gap-1.5 border-b border-amber-200 bg-amber-50 px-4 py-1 text-[11px] text-amber-800 dark:border-amber-700/30 dark:bg-amber-900/20 dark:text-amber-200">
            <IconAlertTriangle size={11} />
            <span>
              <span className="font-mono">_id</span> is hidden — it can't be
              changed.
            </span>
          </div>
        )}

        <div className="flex-1 overflow-hidden">
          {isViewing ? (
            <MonacoJsonInput
              key={`view-${id}`}
              value={fullJson}
              onChange={() => {
                /* read-only */
              }}
              minHeight="100%"
              showLineNumbers
              readOnly
            />
          ) : (
            <MonacoJsonInput
              key={`edit-${id}`}
              value={editText}
              onChange={setEditText}
              minHeight="100%"
              showLineNumbers
            />
          )}
        </div>

        {(error || savedAt) && (
          <footer className="border-t border-slate-200 px-4 py-2 text-xs dark:border-slate-800">
            {error && (
              <div className="rounded border border-red-300 bg-red-50 px-2 py-1 text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
                {error}
              </div>
            )}
            {!error && savedAt && (
              <div className="text-emerald-600 dark:text-emerald-400">
                Saved {new Date(savedAt).toLocaleTimeString()}
              </div>
            )}
          </footer>
        )}
      </div>
    </div>
  );
};
