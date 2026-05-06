import { IconFolder, IconX } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { ApiError } from "../../api/client";
import { ServerFolderPicker } from "./ServerFolderPicker";
import { useCreateWorkspace } from "./useWorkspaces";
import { isTauri, pickFolder } from "./tauriDialog";

interface Props {
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

/**
 * Folder-safe characters: letters, digits, space, hyphen, underscore, dot.
 * Whitelist instead of blacklist so names work the same on Linux, macOS,
 * and Windows (the latter rejects `<>:"/\|?*` plus a handful of reserved
 * device names — disallowing everything else side-steps the gotchas).
 */
const NAME_PATTERN = /^[A-Za-z0-9 _.-]*$/;

const sanitizeName = (raw: string): string =>
  raw.replace(/[^A-Za-z0-9 _.-]/g, "").replace(/\s+/g, " ").replace(/^\s+/, "");

const joinPath = (base: string, leaf: string): string => {
  // Use whichever separator the picked path already uses; fall back to "/".
  const sep = base.includes("\\") ? "\\" : "/";
  return base.replace(/[\\/]+$/, "") + sep + leaf;
};

export const NewWorkspaceDialog = ({ onClose }: Props) => {
  const [name, setName] = useState("");
  const [pickedFolder, setPickedFolder] = useState("");
  const [color, setColor] = useState<string>(COLORS[0]!);
  const [createSubfolder, setCreateSubfolder] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [serverPickerOpen, setServerPickerOpen] = useState(false);
  const create = useCreateWorkspace();
  const native = isTauri();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const applyPicked = (picked: string) => {
    setPickedFolder(picked);
    // Pre-fill name from the picked folder's basename only when we DON'T plan
    // to create a subfolder — otherwise the basename would be the parent dir,
    // which usually isn't what the user wants to name the workspace.
    setName((current) => {
      if (current) return current;
      if (createSubfolder) return current;
      const base = picked.split(/[\\/]/).filter(Boolean).pop();
      return sanitizeName(base ?? "");
    });
  };

  const onPick = async () => {
    if (native) {
      const picked = await pickFolder(pickedFolder || undefined);
      if (picked) applyPicked(picked);
      return;
    }
    setServerPickerOpen(true);
  };

  // In Tauri, fire the folder picker as soon as the dialog opens — that's the
  // whole reason the user clicked "New workspace". They can still cancel and
  // type a path manually if they want.
  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    pickFolder().then((picked) => {
      if (cancelled || !picked) return;
      applyPicked(picked);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onNameChange = (next: string) => {
    if (!NAME_PATTERN.test(next)) {
      // Keep the field constrained — silently strip the disallowed chars
      // rather than rejecting the keystroke (less janky than ignoring input).
      setName(sanitizeName(next));
      return;
    }
    setName(next);
  };

  const trimmedName = name.trim();
  const finalFolder = useMemo(() => {
    if (!pickedFolder) return "";
    if (createSubfolder && trimmedName) return joinPath(pickedFolder, trimmedName);
    return pickedFolder;
  }, [pickedFolder, createSubfolder, trimmedName]);

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
    if (!pickedFolder.trim()) {
      setError("Pick a folder.");
      return;
    }
    try {
      await create.mutateAsync({
        name: trimmedName,
        folderPath: finalFolder,
        color,
        createIfMissing: createSubfolder,
      });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  const nameInvalid = !!name && !NAME_PATTERN.test(name);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40">
      <form
        onSubmit={onSubmit}
        className="w-[460px] rounded-lg border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            New workspace
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
            placeholder="my-queries"
            className={[
              "mt-1 w-full rounded border bg-white px-2 py-1 text-sm text-slate-900 focus:outline-none dark:bg-slate-950 dark:text-slate-100",
              nameInvalid
                ? "border-red-400 focus:border-red-400"
                : "border-slate-300 focus:border-sky-400 dark:border-slate-700",
            ].join(" ")}
            autoFocus
          />
          <p className="mt-1 flex items-center gap-1 text-[10.5px] text-slate-500 dark:text-slate-400">
            Letters, digits, space, <span className="font-mono">_</span>,{" "}
            <span className="font-mono">-</span>, and{" "}
            <span className="font-mono">.</span> only.
          </p>
        </label>

        <label className="mb-2 block">
          <span className="block text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Parent folder
          </span>
          <div className="mt-1 flex gap-1">
            <div className="flex flex-1 items-center gap-1.5 rounded border border-slate-300 bg-slate-50 px-2 py-1 font-mono text-[12px] text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
              <IconFolder size={12} className="shrink-0 text-slate-400" />
              <span className="truncate">
                {pickedFolder || (
                  <span className="text-slate-400">
                    Click Browse to pick a folder
                  </span>
                )}
              </span>
            </div>
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
          {!native && (
            <p className="mt-1 text-[10.5px] text-slate-500 dark:text-slate-400">
              Browses the server filesystem (workspaces live where the Mango
              server runs).
            </p>
          )}
        </label>

        <label className="mb-3 flex items-start gap-2">
          <input
            type="checkbox"
            checked={createSubfolder}
            onChange={(e) => setCreateSubfolder(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-sky-500 focus:ring-sky-500 dark:border-slate-600 dark:bg-slate-800"
          />
          <span className="text-[12px] text-slate-700 dark:text-slate-200">
            Create{" "}
            <span className="font-mono text-[11.5px]">
              {trimmedName || "<name>"}
            </span>{" "}
            subfolder inside the picked folder.
          </span>
        </label>

        {pickedFolder && (
          <div className="mb-3 rounded border border-slate-200 bg-slate-50 p-2 text-[11px] dark:border-slate-800 dark:bg-slate-900/50">
            <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Workspace folder
            </div>
            <div className="mt-0.5 break-all font-mono text-slate-700 dark:text-slate-200">
              {finalFolder || pickedFolder}
            </div>
          </div>
        )}

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
              create.isPending || !trimmedName || !pickedFolder || nameInvalid
            }
            className="rounded bg-sky-500 px-3 py-1 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50"
          >
            {create.isPending ? "Adding…" : "Add"}
          </button>
        </div>
      </form>

      {serverPickerOpen && (
        <ServerFolderPicker
          initialPath={pickedFolder || undefined}
          onPick={(folder) => {
            applyPicked(folder);
            setServerPickerOpen(false);
          }}
          onCancel={() => setServerPickerOpen(false)}
        />
      )}
    </div>
  );
};
