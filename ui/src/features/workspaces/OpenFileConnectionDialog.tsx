import { IconAlertTriangle, IconX } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { type ConnectionPublic } from "../../api/client";
import { type MangoFrontmatter } from "./markdownDoc";

interface Props {
  fileLabel: string;
  frontmatter: MangoFrontmatter;
  connections: ConnectionPublic[];
  /**
   * True when the file has a `connectionId` that doesn't match any current
   * connection — informs the user why we're prompting instead of opening
   * directly. False for legacy files with no `connectionId`.
   */
  staleConnectionId: boolean;
  onPick: (connectionId: string, database: string | null) => void;
  onCancel: () => void;
}

/**
 * Suggest a default connection when a workspace file has no usable
 * `connectionId`. We try, in order:
 *   1. exact match on the persisted `connection` display name
 *   2. exact match on `effectiveDefaultDatabase === frontmatter.database`
 *   3. fall back to the first connection in the list
 */
const suggestConnection = (
  fm: MangoFrontmatter,
  connections: ConnectionPublic[],
): string | null => {
  if (connections.length === 0) return null;
  if (fm.connection) {
    const byName = connections.find((c) => c.name === fm.connection);
    if (byName) return byName.id;
  }
  if (fm.database) {
    const byDb = connections.find(
      (c) => c.effectiveDefaultDatabase === fm.database,
    );
    if (byDb) return byDb.id;
  }
  return connections[0]?.id ?? null;
};

export const OpenFileConnectionDialog = ({
  fileLabel,
  frontmatter,
  connections,
  staleConnectionId,
  onPick,
  onCancel,
}: Props) => {
  const suggestedId = useMemo(
    () => suggestConnection(frontmatter, connections),
    [frontmatter, connections],
  );
  const [selectedId, setSelectedId] = useState<string>(suggestedId ?? "");
  const [database, setDatabase] = useState<string>(frontmatter.database ?? "");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId) return;
    onPick(selectedId, database.trim() || null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40">
      <form
        onSubmit={onSubmit}
        className="w-[440px] rounded-lg border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Pick connection for this file
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="rounded p-1 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
          >
            <IconX size={14} />
          </button>
        </div>

        <div className="mb-3 truncate font-mono text-[12px] text-slate-600 dark:text-slate-300">
          {fileLabel}
        </div>

        {staleConnectionId && (
          <div className="mb-3 flex items-start gap-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11.5px] text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
            <IconAlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
            <span>
              The connection this file was saved with is no longer
              registered. Pick another to continue.
            </span>
          </div>
        )}

        {connections.length === 0 ? (
          <div className="rounded border border-slate-200 bg-slate-50 p-3 text-[11.5px] text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            No connections registered yet. Add one from the sidebar first,
            then reopen this file.
          </div>
        ) : (
          <>
            <label className="mb-2 block">
              <span className="block text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Connection
              </span>
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                autoFocus
              >
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.effectiveDefaultDatabase
                      ? ` — ${c.effectiveDefaultDatabase}`
                      : ""}
                  </option>
                ))}
              </select>
            </label>

            <label className="mb-3 block">
              <span className="block text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Database
              </span>
              <input
                type="text"
                value={database}
                onChange={(e) => setDatabase(e.target.value)}
                placeholder="(use connection default)"
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 font-mono text-[12px] text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </label>
          </>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!selectedId}
            className="rounded bg-sky-500 px-3 py-1 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50"
          >
            Open
          </button>
        </div>
      </form>
    </div>
  );
};
