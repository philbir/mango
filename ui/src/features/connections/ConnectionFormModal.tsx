import { useMutation, useQueryClient } from "@tanstack/react-query";
import { IconCheck, IconTrash, IconX } from "@tabler/icons-react";
import { useState } from "react";
import { ApiError, api, type ConnectionPublic } from "../../api/client";

const COLORS = [
  "#38bdf8",
  "#22c55e",
  "#a855f7",
  "#f97316",
  "#ef4444",
  "#eab308",
  "#ec4899",
  "#14b8a6",
];

interface Props {
  mode: "create" | "edit";
  existing?: ConnectionPublic;
  onClose: () => void;
}

export const ConnectionFormModal = ({ mode, existing, onClose }: Props) => {
  const queryClient = useQueryClient();
  const [name, setName] = useState(existing?.name ?? "");
  const [uri, setUri] = useState(""); // Edits start empty (URI is hidden); only sent if filled.
  const [defaultDatabase, setDefaultDatabase] = useState(
    existing?.defaultDatabase ?? "",
  );
  const [color, setColor] = useState(existing?.color ?? COLORS[0]!);
  const [testResult, setTestResult] = useState<
    { ok: true } | { ok: false; error: string } | null
  >(null);
  const [testing, setTesting] = useState(false);

  const onTest = async () => {
    if (!uri.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.testUri(uri.trim());
      setTestResult(res.ok ? { ok: true } : { ok: false, error: res.error ?? "" });
    } catch (e) {
      setTestResult({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setTesting(false);
    }
  };

  const save = useMutation({
    mutationFn: async () => {
      if (mode === "create") {
        return api.createConnection({
          name: name.trim(),
          uri: uri.trim(),
          defaultDatabase: defaultDatabase.trim() || null,
          color,
        });
      }
      return api.updateConnection(existing!.id, {
        name: name.trim(),
        uri: uri.trim() ? uri.trim() : undefined,
        defaultDatabase: defaultDatabase.trim() || null,
        color,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connections"] });
      onClose();
    },
  });

  const remove = useMutation({
    mutationFn: () => api.deleteConnection(existing!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connections"] });
      onClose();
    },
  });

  const error =
    save.error instanceof ApiError
      ? save.error.message
      : save.error instanceof Error
        ? save.error.message
        : null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
        <header className="mb-3 flex items-start gap-3">
          <div className="flex-1">
            <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {mode === "create" ? "New connection" : "Edit connection"}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              MongoDB connection details. The URI is encrypted at rest.
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
          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Production · Antoniq"
              className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </Field>

          <Field
            label={mode === "edit" ? "URI (leave empty to keep current)" : "URI"}
          >
            <input
              value={uri}
              onChange={(e) => setUri(e.target.value)}
              placeholder="mongodb://user:pass@host:27017/dbName?authSource=admin"
              spellCheck={false}
              className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
            {mode === "edit" && existing && (
              <div className="mt-1 font-mono text-[10px] text-slate-500">
                Current: {existing.uriRedacted}
              </div>
            )}
            <button
              type="button"
              onClick={onTest}
              disabled={!uri.trim() || testing}
              className="mt-2 flex items-center gap-1 rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {testing ? "Testing…" : "Test connection"}
            </button>
            {testResult?.ok === true && (
              <div className="mt-1 flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                <IconCheck size={12} /> Connected.
              </div>
            )}
            {testResult?.ok === false && (
              <div className="mt-1 text-[11px] text-red-600 dark:text-red-400">
                {testResult.error}
              </div>
            )}
          </Field>

          <Field label="Default database (optional)">
            <input
              value={defaultDatabase}
              onChange={(e) => setDefaultDatabase(e.target.value)}
              placeholder="leave blank to use the URI's database"
              className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </Field>

          <Field label="Color">
            <div className="flex flex-wrap gap-1.5">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`h-6 w-6 rounded-full border-2 ${
                    color === c
                      ? "border-slate-900 dark:border-slate-100"
                      : "border-transparent"
                  }`}
                  style={{ background: c }}
                />
              ))}
            </div>
          </Field>

          {error && (
            <div className="rounded border border-red-300 bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
              {error}
            </div>
          )}
        </div>

        <footer className="mt-5 flex items-center gap-2">
          {mode === "edit" && existing && (
            <button
              type="button"
              onClick={() => {
                if (confirm(`Delete connection "${existing.name}"?`)) {
                  remove.mutate();
                }
              }}
              disabled={remove.isPending}
              className="flex items-center gap-1 rounded border border-red-300 px-2 py-1.5 text-xs text-red-700 hover:bg-red-50 dark:border-red-700/40 dark:text-red-300 dark:hover:bg-red-900/20"
            >
              <IconTrash size={12} />
              Delete
            </button>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={
              save.isPending ||
              !name.trim() ||
              (mode === "create" && !uri.trim())
            }
            className="rounded bg-sky-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50"
          >
            {save.isPending ? "Saving…" : mode === "create" ? "Create" : "Save"}
          </button>
        </footer>
      </div>
    </div>
  );
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
      {label}
    </div>
    {children}
  </div>
);
