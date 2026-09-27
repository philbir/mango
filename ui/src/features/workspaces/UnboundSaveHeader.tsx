import { IconDeviceFloppy } from "@tabler/icons-react";

interface Props {
  /** Disable Save when there's nothing meaningful to save yet. */
  canSave: boolean;
  onSave: () => void;
}

/**
 * Header bar for query/console tabs that aren't yet bound to a workspace
 * file. Visually matches WorkspaceFileHeader so the tab chrome stays
 * consistent — only difference is no path/dot/delete/close, just a
 * Save-to-workspace action.
 */
export const UnboundSaveHeader = ({ canSave, onSave }: Props) => (
  <div className="flex h-8 flex-shrink-0 items-center gap-2 border-b border-slate-200 bg-slate-50/60 px-4 text-[11.5px] dark:border-slate-800 dark:bg-slate-900/30">
    <span className="text-slate-500 dark:text-slate-400">Not saved to a workspace</span>
    <div className="flex-1" />
    <button
      type="button"
      onClick={onSave}
      disabled={!canSave}
      className="btn btn-sm btn-outline"
      title="Save to workspace (⌘/Ctrl+S)"
    >
      <IconDeviceFloppy size={13} />
      Save to workspace…
    </button>
  </div>
);
