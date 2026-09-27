import {
  IconDatabase,
  IconFiles,
  IconNotebook,
  IconTable,
  IconTerminal,
  IconTerminal2,
  IconX,
} from "@tabler/icons-react";
import { mangoFileDisplayName } from "../workspaces/markdownDoc";
import { type Tab, useTabs } from "./TabsContext";

const labelFor = (tab: Tab, index: number): string => {
  if (tab.kind === "collection") return tab.collection ?? "(collection)";
  if (tab.kind === "console") return `console ${index}`;
  if (tab.kind === "notebook") {
    const base = (tab.workspaceFilePath ?? "").split("/").pop() ?? "(file)";
    return mangoFileDisplayName(base);
  }
  if (tab.kind === "database") return tab.database ?? "(database)";
  if (tab.kind === "gridfs") return tab.bucket ? `${tab.bucket} files` : "(gridfs)";
  return `shell ${index}`;
};

export const TabBar = () => {
  const { tabs, activeId, activate, closeTab } = useTabs();
  if (tabs.length === 0) return null;

  const consoleIndices: Record<string, number> = {};
  const shellIndices: Record<string, number> = {};
  let consoleN = 0;
  let shellN = 0;
  for (const t of tabs) {
    if (t.kind === "console") consoleIndices[t.id] = ++consoleN;
    else if (t.kind === "shell") shellIndices[t.id] = ++shellN;
  }

  return (
    <div className="thin-scrollbar flex h-10 flex-shrink-0 items-end gap-0.5 overflow-x-auto overflow-y-hidden border-b border-slate-200 bg-slate-100 px-2 dark:border-slate-800 dark:bg-slate-900/60">
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        const idx =
          tab.kind === "console"
            ? consoleIndices[tab.id] ?? 0
            : tab.kind === "shell"
              ? shellIndices[tab.id] ?? 0
              : 0;
        return (
          <div
            key={tab.id}
            className={[
              "group -mb-px flex h-[33px] flex-shrink-0 items-center gap-1 rounded-t border border-b-0 pl-2 pr-1 text-[12px]",
              active
                ? "border-slate-300 bg-white text-slate-900 shadow-[inset_0_2px_0_var(--color-sky-500)] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                : "border-transparent text-slate-600 hover:bg-slate-200 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100",
            ].join(" ")}
          >
            <button
              type="button"
              onClick={() => activate(tab.id)}
              onAuxClick={(e) => {
                if (e.button === 1) closeTab(tab.id);
              }}
              className="flex h-full items-center gap-1.5"
              title={labelFor(tab, idx)}
            >
              {tab.kind === "shell" ? (
                <IconTerminal size={13} className="text-slate-500" />
              ) : tab.kind === "console" ? (
                <IconTerminal2 size={13} className="text-slate-500" />
              ) : tab.kind === "notebook" ? (
                <IconNotebook size={13} className="text-violet-500" />
              ) : tab.kind === "database" ? (
                <IconDatabase size={13} className="text-amber-500" />
              ) : tab.kind === "gridfs" ? (
                <IconFiles size={13} className="text-emerald-500" />
              ) : (
                <IconTable size={13} className="text-sky-500" />
              )}
              <span className="max-w-[180px] truncate font-mono">
                {labelFor(tab, idx)}
              </span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                closeTab(tab.id);
              }}
              className={[
                "btn-icon min-h-[20px] min-w-[20px] text-slate-500 hover:bg-slate-300 hover:text-slate-900 dark:hover:bg-slate-700 dark:hover:text-slate-100",
                active ? "" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100",
              ].join(" ")}
              title="Close tab"
            >
              <IconX size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
};
