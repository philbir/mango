import { IconChevronDown, IconFolderPlus } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import type { Workspace } from "../../api/client";

interface Props {
  workspaces: Workspace[];
  active: Workspace | null;
  onPick: (id: string) => void;
  onNew: () => void;
}

export const WorkspaceSelector = ({
  workspaces,
  active,
  onPick,
  onNew,
}: Props) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative flex-1 min-w-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-slate-200 dark:hover:bg-slate-800"
      >
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: active?.color ?? "#94a3b8" }}
        />
        <span className="flex-1 truncate text-[11.5px] font-medium text-slate-700 dark:text-slate-200">
          {active?.name ?? (workspaces.length === 0 ? "No workspaces" : "Pick a workspace")}
        </span>
        <IconChevronDown size={12} className="text-slate-400" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 rounded-md border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <ul className="max-h-64 overflow-y-auto py-1">
            {workspaces.length === 0 && (
              <li className="px-3 py-2 text-[11.5px] text-slate-500">
                No workspaces yet.
              </li>
            )}
            {workspaces.map((w) => (
              <li
                key={w.id}
                className={`flex items-center gap-2 px-3 py-1.5 text-[12.5px] hover:bg-slate-100 dark:hover:bg-slate-800 ${
                  active?.id === w.id ? "bg-sky-500/10 dark:bg-sky-500/15" : ""
                }`}
              >
                <button
                  type="button"
                  className="flex flex-1 items-center gap-2 text-left"
                  onClick={() => {
                    onPick(w.id);
                    setOpen(false);
                  }}
                  title={w.folderPath}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: w.color ?? "#94a3b8" }}
                  />
                  <span className="flex-1 truncate text-slate-900 dark:text-slate-100">
                    {w.name}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-slate-200 p-1 dark:border-slate-800">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onNew();
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12.5px] text-sky-700 hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-500/15"
            >
              <IconFolderPlus size={12} />
              New workspace
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
