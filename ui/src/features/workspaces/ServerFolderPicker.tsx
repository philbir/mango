import {
  IconAlertCircle,
  IconArrowUp,
  IconFolder,
  IconFolderFilled,
  IconHome,
  IconRefresh,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { ApiError, api } from "../../api/client";

interface Props {
  /** Initial folder to show. Falls back to the server's home directory. */
  initialPath?: string;
  onPick: (folderPath: string) => void;
  onCancel: () => void;
}

interface FsView {
  path: string;
  parent: string | null;
  home: string;
  entries: Array<{ name: string; hidden: boolean }>;
  readError: string | null;
}

/**
 * Server-side folder picker for the browser deployment, where Tauri's native
 * dialog isn't available. Walks the filesystem via `/api/workspaces/fs`.
 *
 * Starts at the server's home directory unless `initialPath` is provided.
 */
export const ServerFolderPicker = ({ initialPath, onPick, onCancel }: Props) => {
  const [view, setView] = useState<FsView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  const load = async (target?: string) => {
    setLoading(true);
    setError(null);
    try {
      const v = await api.listFsDirectory(target);
      setView(v);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(initialPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const visibleEntries = useMemo(() => {
    if (!view) return [];
    return showHidden ? view.entries : view.entries.filter((e) => !e.hidden);
  }, [view, showHidden]);

  const enter = (name: string) => {
    if (!view) return;
    // Use whichever separator the current path already uses.
    const sep = view.path.includes("\\") && !view.path.startsWith("/") ? "\\" : "/";
    const next = view.path.endsWith(sep)
      ? view.path + name
      : view.path + sep + name;
    load(next);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="flex h-[28rem] w-[34rem] max-w-full flex-col rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
        <header className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-700">
          <h2 className="flex-1 text-sm font-semibold text-slate-800 dark:text-slate-100">
            Pick a folder
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="rounded p-1 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
          >
            <IconX size={14} />
          </button>
        </header>

        <div className="flex items-center gap-1 border-b border-slate-200 px-2 py-1.5 text-[12px] dark:border-slate-700">
          <button
            type="button"
            onClick={() => view?.parent && load(view.parent)}
            disabled={!view?.parent || loading}
            className="flex items-center gap-1 rounded border border-slate-300 px-1.5 py-0.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            title="Up one level"
          >
            <IconArrowUp size={11} />
          </button>
          <button
            type="button"
            onClick={() => view && load(view.home)}
            disabled={!view || loading}
            className="flex items-center gap-1 rounded border border-slate-300 px-1.5 py-0.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            title="Home"
          >
            <IconHome size={11} />
          </button>
          <button
            type="button"
            onClick={() => view && load(view.path)}
            disabled={!view || loading}
            className="flex items-center gap-1 rounded border border-slate-300 px-1.5 py-0.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            title="Refresh"
          >
            <IconRefresh
              size={11}
              className={loading ? "animate-spin" : ""}
            />
          </button>
          <input
            type="text"
            value={view?.path ?? ""}
            onChange={(e) => setView((v) => (v ? { ...v, path: e.target.value } : v))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (view) load(view.path);
              }
            }}
            placeholder="/path/to/folder"
            className="ml-1 flex-1 rounded border border-slate-300 bg-white px-2 py-0.5 font-mono text-[11.5px] text-slate-900 focus:border-sky-400 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="px-3 py-2 text-[12px] text-slate-400">Loading…</div>
          )}
          {error && (
            <div className="m-3 flex items-start gap-2 rounded border border-red-200 bg-red-50 p-2 text-[11.5px] text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
              <IconAlertCircle size={12} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {!loading && !error && view?.readError && (
            <div className="m-3 flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-2 text-[11.5px] text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
              <IconAlertCircle size={12} className="mt-0.5 shrink-0" />
              <span>Could not list contents: {view.readError}</span>
            </div>
          )}
          {!loading && !error && view && visibleEntries.length === 0 && (
            <div className="px-3 py-2 text-[12px] text-slate-400">
              No subfolders.
            </div>
          )}
          <ul className="py-1">
            {visibleEntries.map((entry) => (
              <li key={entry.name}>
                <button
                  type="button"
                  onDoubleClick={() => enter(entry.name)}
                  onClick={() => enter(entry.name)}
                  className={[
                    "flex w-full items-center gap-2 px-3 py-1 text-left text-[12.5px] hover:bg-slate-100 dark:hover:bg-slate-800",
                    entry.hidden ? "opacity-60" : "",
                  ].join(" ")}
                >
                  <IconFolderFilled
                    size={13}
                    className="shrink-0 text-amber-400"
                  />
                  <span className="truncate font-mono text-slate-700 dark:text-slate-200">
                    {entry.name}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <footer className="flex items-center gap-2 border-t border-slate-200 px-3 py-2 dark:border-slate-700">
          <label className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300 text-sky-500 focus:ring-sky-500 dark:border-slate-600 dark:bg-slate-800"
            />
            Show hidden
          </label>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!view || loading}
            onClick={() => view && onPick(view.path)}
            className="flex items-center gap-1 rounded bg-sky-500 px-3 py-1 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50"
          >
            <IconFolder size={12} />
            Pick this folder
          </button>
        </footer>
      </div>
    </div>
  );
};
