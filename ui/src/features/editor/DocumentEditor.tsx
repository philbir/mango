import { useMutation, useQueryClient } from "@tanstack/react-query";
import { IconDeviceFloppy, IconX } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import {
  ApiError,
  api,
  extractIdString,
  parseEJSON,
  stringifyEJSON,
} from "../../api/client";
import { CodeMirrorJson } from "../../components/CodeMirrorJson";
import { useActiveConnection } from "../connections/useActiveConnection";

interface Props {
  collectionName: string;
  document: Record<string, unknown>;
  onClose: () => void;
}

export const DocumentEditor = ({
  collectionName,
  document: doc,
  onClose,
}: Props) => {
  const { activeId } = useActiveConnection();
  const id = extractIdString(doc._id);
  const initial = stringifyEJSON(doc);
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    setText(initial);
    setError(null);
    setSavedAt(null);
  }, [initial]);

  const mutation = useMutation({
    mutationFn: async () => {
      try {
        parseEJSON(text);
      } catch (e) {
        throw new Error(
          `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      if (!activeId) throw new Error("No active connection");
      return api.putDocument(activeId, collectionName, id, text);
    },
    onSuccess: (result) => {
      setText(stringifyEJSON(result.document));
      setSavedAt(Date.now());
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["docs", activeId, collectionName] });
    },
    onError: (e) => {
      const message =
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
      setError(message);
    },
  });

  return (
    <div className="fixed inset-0 z-30 flex items-stretch justify-end bg-black/50">
      <div className="flex h-full w-[min(720px,90vw)] flex-col border-l border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900">
        <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="flex-1">
            <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-500">
              {collectionName}
            </div>
            <div className="font-mono text-sm text-slate-900 dark:text-slate-100">
              {id}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            title="Close"
          >
            <IconX size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-hidden">
          <CodeMirrorJson value={text} onChange={setText} minHeight="100%" />
        </div>

        <footer className="flex items-center gap-3 border-t border-slate-200 px-4 py-3 dark:border-slate-800">
          {error && (
            <div className="flex-1 rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
              {error}
            </div>
          )}
          {!error && savedAt && (
            <div className="flex-1 text-xs text-emerald-600 dark:text-emerald-400">
              Saved {new Date(savedAt).toLocaleTimeString()}
            </div>
          )}
          {!error && !savedAt && <div className="flex-1" />}
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="flex items-center gap-1.5 rounded bg-sky-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50"
          >
            <IconDeviceFloppy size={14} />
            {mutation.isPending ? "Saving…" : "Save"}
          </button>
        </footer>
      </div>
    </div>
  );
};
