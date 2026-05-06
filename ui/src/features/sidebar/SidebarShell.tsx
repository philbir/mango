import { IconLeaf, IconTable } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { CollectionsPane } from "../collections/CollectionsPane";
import { ConnectionPicker } from "../connections/ConnectionPicker";
import { useServerConfig } from "../connections/useServerConfig";
import { SettingsMenu } from "../../components/SettingsMenu";
import { useResize } from "../../components/useResize";
import { WorkspacesPane } from "../workspaces/WorkspacesPane";

type Mode = "collections" | "workspaces";

const STORAGE_KEY = "mango:sidebar-mode:v1";

const loadMode = (): Mode => {
  if (typeof window === "undefined") return "collections";
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === "workspaces" ? "workspaces" : "collections";
};

export const SidebarShell = () => {
  const docsUrl =
    import.meta.env.VITE_MANGO_DOCS_URL ?? "https://philbir.github.io/mango/";
  const version = import.meta.env.VITE_MANGO_VERSION ?? "v0.1.0";
  const config = useServerConfig();
  const [mode, setMode] = useState<Mode>(() => loadMode());

  // Force back to collections if workspaces get disabled at runtime (mode switch).
  useEffect(() => {
    if (!config.workspacesEnabled && mode === "workspaces") {
      setMode("collections");
    }
  }, [config.workspacesEnabled, mode]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* ignore */
    }
  }, [mode]);

  const { size: sidebarWidth, onMouseDown: onResizeStart } = useResize({
    storageKey: "mango:sidebar-width",
    axis: "x",
    initial: 256,
    min: 200,
    max: 520,
  });

  return (
    <aside
      className="relative flex h-full flex-shrink-0 flex-col border-r border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/60"
      style={{ width: sidebarWidth }}
    >
      <div className="flex items-center gap-1.5 border-b border-slate-200 px-2 py-2 dark:border-slate-800">
        <div className="flex-1">
          <ConnectionPicker />
        </div>
        <SettingsMenu />
      </div>

      {mode === "collections" ? <CollectionsPane /> : <WorkspacesPane />}

      {config.workspacesEnabled && (
        <div className="grid grid-cols-2 border-t border-slate-200 dark:border-slate-800">
          <ModeButton
            label="Collections"
            icon={<IconTable size={12} />}
            active={mode === "collections"}
            onClick={() => setMode("collections")}
          />
          <ModeButton
            label="Workspaces"
            icon={<IconLeaf size={12} />}
            active={mode === "workspaces"}
            onClick={() => setMode("workspaces")}
          />
        </div>
      )}

      <a
        href={docsUrl}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-2 border-t border-slate-200 px-3 py-1.5 text-[10px] text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:border-slate-800 dark:text-slate-500 dark:hover:bg-slate-800/70 dark:hover:text-slate-300"
        title="Open Mango docs"
      >
        <img
          src="/assets/mango-mark.svg"
          alt=""
          className="h-4 w-4 shrink-0 dark:hidden"
          draggable={false}
        />
        <img
          src="/assets/mango-mark-dark.svg"
          alt=""
          className="hidden h-4 w-4 shrink-0 dark:block"
          draggable={false}
        />
        <span>Mango · {version}</span>
      </a>
      <div
        onMouseDown={onResizeStart}
        className="absolute -right-0.5 top-0 z-10 h-full w-1 cursor-col-resize hover:bg-sky-500/40"
        title="Drag to resize"
      />
    </aside>
  );
};

const ModeButton = ({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={[
      "flex items-center justify-center gap-1.5 px-2 py-1.5 text-[11px] font-medium",
      active
        ? "bg-white text-sky-700 dark:bg-slate-950 dark:text-sky-300"
        : "text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200",
    ].join(" ")}
  >
    {icon}
    {label}
  </button>
);
