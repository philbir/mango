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
  <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50/60 px-3 py-1.5 text-[12px] dark:border-slate-800 dark:bg-slate-900/30">
    <span className="text-slate-400 dark:text-slate-500">Unsaved</span>
    <div className="flex-1" />
    <button
      type="button"
      onClick={onSave}
      disabled={!canSave}
      className="flex items-center gap-1 rounded border border-slate-300 px-1.5 py-0.5 text-[11px] hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800"
      title="Save to workspace (⌘/Ctrl+S)"
    >
      <IconDeviceFloppy size={11} />
      Save…
    </button>
  </div>
);
