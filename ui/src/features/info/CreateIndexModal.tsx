import { useMutation } from "@tanstack/react-query";
import { IconLoader2, IconX } from "@tabler/icons-react";
import { useState } from "react";
import { ApiError, api } from "../../api/client";

interface Props {
  cid: string;
  database: string | null;
  collection: string;
  onClose: () => void;
  onCreated: () => void;
}

export const CreateIndexModal = ({
  cid,
  database,
  collection,
  onClose,
  onCreated,
}: Props) => {
  const [keysJson, setKeysJson] = useState('{ "fieldName": 1 }');
  const [unique, setUnique] = useState(false);
  const [sparse, setSparse] = useState(false);
  const [name, setName] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => {
      let keys: Record<string, 1 | -1 | string>;
      try {
        keys = JSON.parse(keysJson);
        if (!keys || typeof keys !== "object" || Array.isArray(keys)) {
          throw new Error("Keys must be a JSON object");
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setParseError(msg);
        throw new Error(msg);
      }
      setParseError(null);
      return api.createIndex({
        cid,
        name: collection,
        database: database ?? undefined,
        keys,
        options: {
          name: name.trim() || undefined,
          unique: unique || undefined,
          sparse: sparse || undefined,
        },
      });
    },
    onSuccess: onCreated,
  });

  const error =
    parseError ??
    (create.error instanceof ApiError
      ? create.error.message
      : create.error instanceof Error
        ? create.error.message
        : null);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
        <header className="mb-3 flex items-start gap-3">
          <div className="flex-1">
            <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Create index
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              On <span className="font-mono">{collection}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <IconX size={16} />
          </button>
        </header>

        <div className="space-y-3">
          <Field label="Keys (JSON)">
            <textarea
              value={keysJson}
              onChange={(e) => setKeysJson(e.target.value)}
              rows={3}
              spellCheck={false}
              className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              placeholder='{ "createdAt": -1, "status": 1 }'
            />
            <div className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
              Use 1 for ascending, -1 for descending, or "text" / "2dsphere" / "hashed".
            </div>
          </Field>
          <Field label="Name (optional)">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="auto-generated if blank"
              spellCheck={false}
              className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </Field>
          <div className="flex flex-wrap gap-3 text-xs">
            <label className="flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={unique}
                onChange={(e) => setUnique(e.target.checked)}
              />
              Unique
            </label>
            <label className="flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={sparse}
                onChange={(e) => setSparse(e.target.checked)}
              />
              Sparse
            </label>
          </div>
          {error && (
            <div className="rounded border border-red-300 bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
              {error}
            </div>
          )}
        </div>

        <footer className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => create.mutate()}
            disabled={create.isPending}
            className="flex items-center gap-1 rounded bg-violet-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-400 disabled:opacity-50"
          >
            {create.isPending && (
              <IconLoader2 size={12} className="animate-spin" />
            )}
            Create
          </button>
        </footer>
      </div>
    </div>
  );
};

const Field = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <div>
    <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
      {label}
    </div>
    {children}
  </div>
);
