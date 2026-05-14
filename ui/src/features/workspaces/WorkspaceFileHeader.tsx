import {
  IconAlertTriangle,
  IconDeviceFloppy,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useState } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { mangoFileDisplayName } from "./markdownDoc";
import { useDeleteWorkspacePath } from "./useWorkspaceFile";
import { useWorkspaces } from "./useWorkspaces";

interface Props {
  workspaceId: string;
  filePath: string;
  dirty: boolean;
  saving: boolean;
  /** Saved-on-disk timestamp from the external watcher; truthy = banner. */
  externallyChangedAt?: number | null;
  /** True iff the file was removed on disk by some other process. */
  deleted?: boolean;
  onSave: () => void;
  onReload?: () => void;
  /** Called after a successful delete — usually closes/cleans up the tab. */
  onAfterDelete?: () => void;
  /** Optional close button. Hidden when omitted. */
  onClose?: () => void;
}

/**
 * Shared header for any view bound to a workspace file. Renders the workspace
 * color dot, `workspace/name` path (extension stripped — `.mng.md` is internal),
 * dirty/external-change indicators, and Save / Delete / Close actions. Used by
 * the notebook, file, console (when bound), and collection-query (when bound)
 * views so the file experience is consistent across modes.
 */
export const WorkspaceFileHeader = ({
  workspaceId,
  filePath,
  dirty,
  saving,
  externallyChangedAt,
  deleted,
  onSave,
  onReload,
  onAfterDelete,
  onClose,
}: Props) => {
  const { workspaces } = useWorkspaces();
  const workspace = workspaces.find((w) => w.id === workspaceId);
  const del = useDeleteWorkspacePath(workspaceId);
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50/60 px-3 py-1.5 text-[12px] dark:border-slate-800 dark:bg-slate-900/30">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: workspace?.color ?? "#94a3b8" }}
        />
        <span className="truncate font-mono text-slate-700 dark:text-slate-200">
          {workspace?.name}/{mangoFileDisplayName(filePath)}
        </span>
        {dirty && (
          <span className="rounded bg-amber-200/60 px-1 text-[10px] font-medium text-amber-800 dark:bg-amber-700/30 dark:text-amber-200">
            unsaved
          </span>
        )}
        {externallyChangedAt && !deleted && onReload && (
          <button
            type="button"
            onClick={onReload}
            className="flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10.5px] text-amber-800 hover:bg-amber-100 dark:border-amber-700/60 dark:bg-amber-900/30 dark:text-amber-200"
            title="File changed on disk — reload"
          >
            <IconAlertTriangle size={10} />
            Changed on disk · Reload
          </button>
        )}
        {deleted && (
          <span className="text-[10.5px] text-red-600 dark:text-red-400">
            File deleted on disk — Save will recreate it.
          </span>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={onSave}
          disabled={!dirty || saving}
          className="flex items-center gap-1 rounded border border-slate-300 px-1.5 py-0.5 text-[11px] hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800"
          title="Save (⌘/Ctrl+S)"
        >
          <IconDeviceFloppy size={11} />
          {saving ? "Saving…" : dirty ? "Save" : "Saved"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={del.isPending}
          className="flex items-center gap-1 rounded border border-slate-300 px-1.5 py-0.5 text-[11px] text-red-600 hover:bg-red-50 disabled:opacity-40 dark:border-slate-700 dark:text-red-400 dark:hover:bg-red-950/30"
          title="Delete file"
        >
          <IconTrash size={11} />
          Delete
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            title="Close"
          >
            <IconX size={11} />
          </button>
        )}
      </div>

      {confirming && (
        <ConfirmDialog
          title={`Delete "${mangoFileDisplayName(filePath.split("/").pop() ?? filePath)}"?`}
          message={
            <div>
              This permanently removes the file from{" "}
              <span className="font-mono">
                {workspace?.name ?? "this workspace"}
              </span>
              . This cannot be undone.
            </div>
          }
          confirmLabel="Delete"
          danger
          busy={del.isPending}
          onCancel={() => {
            if (!del.isPending) setConfirming(false);
          }}
          onConfirm={() => {
            del.mutate(filePath, {
              onSuccess: () => {
                setConfirming(false);
                onAfterDelete?.();
              },
            });
          }}
        />
      )}
    </>
  );
};
