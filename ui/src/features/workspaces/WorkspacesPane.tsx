import { IconFolderPlus, IconRefresh } from "@tabler/icons-react";
import { useState } from "react";
import { NewWorkspaceDialog } from "./NewWorkspaceDialog";
import { WorkspaceRoot } from "./WorkspaceRoot";
import { useWorkspaces } from "./useWorkspaces";

export const WorkspacesPane = () => {
  const { workspaces, enabled, isLoading, error, refetch } = useWorkspaces();
  const [showNew, setShowNew] = useState(false);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-slate-200 px-2 py-1 dark:border-slate-800">
        <span className="flex-1 text-[10.5px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Workspaces
        </span>
        <button
          type="button"
          onClick={() => setShowNew(true)}
          disabled={!enabled}
          className="flex items-center gap-1 rounded px-1 py-0.5 text-[10.5px] text-slate-500 hover:bg-slate-200 hover:text-slate-800 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          title="New workspace"
        >
          <IconFolderPlus size={11} />
          New
        </button>
        <button
          type="button"
          onClick={() => refetch()}
          className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          title="Refresh list"
        >
          <IconRefresh size={12} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!enabled && (
          <div className="m-2 rounded border border-slate-200 bg-slate-50 p-3 text-[11.5px] text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            Workspaces are disabled in this mode (the server's filesystem is
            not the user's filesystem). Available in the desktop app and the
            local dev server.
          </div>
        )}
        {enabled && isLoading && (
          <div className="px-2 py-2 text-xs text-slate-400">Loading…</div>
        )}
        {enabled && error && (
          <div className="px-2 py-2 text-xs text-red-500">
            {error.message}
          </div>
        )}
        {enabled && !isLoading && workspaces.length === 0 && (
          <div className="m-2 rounded border border-slate-200 bg-slate-50 p-3 text-[11.5px] text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            No workspaces yet. A workspace is a folder on disk where Mango
            saves your Mongo scripts as plain Markdown files.
            <button
              type="button"
              onClick={() => setShowNew(true)}
              className="mt-2 inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700"
            >
              <IconFolderPlus size={11} />
              Add a workspace
            </button>
          </div>
        )}
        {enabled &&
          workspaces.map((w) => <WorkspaceRoot key={w.id} workspace={w} />)}
      </div>

      {showNew && <NewWorkspaceDialog onClose={() => setShowNew(false)} />}
    </div>
  );
};
