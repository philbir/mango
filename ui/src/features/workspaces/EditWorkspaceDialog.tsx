import { IconFolder, IconX } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { ApiError, type Workspace } from "../../api/client";
import { ServerFolderPicker } from "./ServerFolderPicker";
import { useUpdateWorkspace } from "./useWorkspaces";
import { isTauri, pickFolder } from "./tauriDialog";

interface Props {
  workspace: Workspace;
  onClose: () => void;
}

const COLORS = [
  "#38bdf8",
  "#a78bfa",
  "#f472b6",
  "#34d399",
  "#fbbf24",
  "#fb7185",
];

const NAME_PATTERN = /^[A-Za-z0-9 _.-]*$/;

const sanitizeName = (raw: string): string =>
  raw.replace(/[^A-Za-z0-9 _.-]/g, "").replace(/\s+/g, " ").replace(/^\s+/, "");

export const EditWorkspaceDialog = ({ workspace, onClose }: Props) => {
  const [name, setName] = useState(workspace.name);
  const [folderPath, setFolderPath] = useState(workspace.folderPath);
  const [color, setColor] = useState<string>(workspace.color ?? COLORS[0]!);
  const [error, setError] = useState<string | null>(null);
  const [serverPickerOpen, setServerPickerOpen] = useState(false);
  const update = useUpdateWorkspace();
  const native = isTauri();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onPick = async () => {
    if (native) {
      const picked = await pickFolder(folderPath || undefined);
      if (picked) setFolderPath(picked);
      return;
    }
    setServerPickerOpen(true);
  };

  const onNameChange = (next: string) => {
    if (!NAME_PATTERN.test(next)) {
      setName(sanitizeName(next));
      return;
    }
    setName(next);
  };

  const trimmedName = name.trim();
  const trimmedFolder = folderPath.trim();
  const nameInvalid = !!name && !NAME_PATTERN.test(name);

  const diff = useMemo(() => {
    const out: { name?: string; color?: string | null; folderPath?: string } =
      {};
    if (trimmedName !== workspace.name) out.name = trimmedName;
    if ((color ?? null) !== (workspace.color ?? null)) out.color = color;
    if (trimmedFolder !== workspace.folderPath) out.folderPath = trimmedFolder;
    return out;
  }, [trimmedName, color, trimmedFolder, workspace]);

  const hasChanges = Object.keys(diff).length > 0;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!trimmedName) {
      setError("Name is required.");
      return;
    }
    if (!NAME_PATTERN.test(trimmedName)) {
      setError("Name may only contain letters, digits, space, _, -, and dot.");
      return;
    }
    if (!trimmedFolder) {
      setError("Folder is required.");
      return;
    }
    if (!hasChanges) {
      onClose();
      return;
    }
    try {
      await update.mutateAsync({ id: workspace.id, ...diff });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40">
      <form
        onSubmit={onSubmit}
        className="w-[460px] rounded-lg border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Edit workspace
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
          >
            <IconX size={14} />
          </button>
        </div>

        <label className="mb-2 block">
          <span className="block text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Name
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            className={[
              "mt-1 w-full rounded border bg-white px-2 py-1 text-sm text-slate-900 focus:outline-none dark:bg-slate-950 dark:text-slate-100",
              nameInvalid
                ? "border-red-400 focus:border-red-400"
                : "border-slate-300 focus:border-sky-400 dark:border-slate-700",
            ].join(" ")}
            autoFocus
          />
        </label>

        <label className="mb-3 block">
          <span className="block text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Folder
          </span>
          <div className="mt-1 flex gap-1">
            <input
              type="text"
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
              className="flex-1 rounded border border-slate-300 bg-slate-50 px-2 py-1 font-mono text-[12px] text-slate-700 focus:border-sky-400 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
            />
            <button
              type="button"
              onClick={onPick}
              className="flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[12px] hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700"
              title={native ? "Pick folder" : "Browse server filesystem"}
            >
              <IconFolder size={12} />
              Browse
            </button>
          </div>
          {trimmedFolder !== workspace.folderPath && (
            <p className="mt-1 text-[10.5px] text-amber-600 dark:text-amber-400">
              Changing the folder re-points the workspace. Open files from the
              previous folder will need to be reopened.
            </p>
          )}
        </label>

        <label className="mb-3 block">
          <span className="block text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Color
          </span>
          <div className="mt-1 flex gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={[
                  "h-5 w-5 rounded-full border-2",
                  color === c
                    ? "border-slate-900 dark:border-slate-100"
                    : "border-transparent",
                ].join(" ")}
                style={{ background: c }}
              />
            ))}
          </div>
        </label>

        {error && (
          <div className="mb-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-[11.5px] text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={
              update.isPending || !trimmedName || !trimmedFolder || nameInvalid
            }
            className="rounded bg-sky-500 px-3 py-1 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50"
          >
            {update.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>

      {serverPickerOpen && (
        <ServerFolderPicker
          initialPath={folderPath || undefined}
          onPick={(folder) => {
            setFolderPath(folder);
            setServerPickerOpen(false);
          }}
          onCancel={() => setServerPickerOpen(false)}
        />
      )}
    </div>
  );
};
