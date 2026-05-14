import {
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
    <div className="thin-scrollbar flex items-stretch gap-0.5 overflow-x-auto border-b border-slate-200 bg-slate-100 px-2 pt-1 dark:border-slate-800 dark:bg-slate-900/60">
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
              "group flex items-center gap-1 rounded-t border border-b-0 px-2 py-1 text-xs",
              active
                ? "border-slate-300 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                : "border-transparent text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800",
            ].join(" ")}
          >
            <button
              type="button"
              onClick={() => activate(tab.id)}
              className="flex items-center gap-1"
              title={labelFor(tab, idx)}
            >
              {tab.kind === "shell" ? (
                <IconTerminal size={12} className="text-slate-400" />
              ) : tab.kind === "console" ? (
                <IconTerminal2 size={12} className="text-slate-400" />
              ) : tab.kind === "notebook" ? (
                <IconNotebook size={12} className="text-violet-500" />
              ) : (
                <IconTable size={12} className="text-slate-400" />
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
              className="rounded p-0.5 text-slate-400 hover:bg-slate-300 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-100"
              title="Close tab"
            >
              <IconX size={11} />
            </button>
          </div>
        );
      })}
    </div>
  );
};
