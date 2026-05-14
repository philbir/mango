import {
  IconBolt,
  IconChartBar,
  IconDatabase,
  IconTransfer,
} from "@tabler/icons-react";
import { useState } from "react";
import { useServerConfig } from "../connections/useServerConfig";
import { DevToolsTab } from "./DevToolsTab";
import { ImportExportTab } from "./ImportExportTab";
import { StatsTab } from "./StatsTab";

type SubTab = "stats" | "devtools" | "tools";

interface Props {
  cid: string;
  database: string;
}

export const DatabaseView = ({ cid, database }: Props) => {
  const { devMode, dbToolsAvailable } = useServerConfig();
  const [tab, setTab] = useState<SubTab>("stats");

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-slate-200 bg-slate-50/60 px-4 py-1.5 text-xs dark:border-slate-800 dark:bg-slate-900/30">
        <div className="flex items-center gap-1 pr-2 text-[11px] text-slate-500 dark:text-slate-400">
          <IconDatabase size={12} className="text-amber-500" />
          <span className="font-mono text-slate-700 dark:text-slate-200">
            {database}
          </span>
        </div>
        <SubTabButton
          icon={<IconChartBar size={12} />}
          label="Stats"
          active={tab === "stats"}
          onClick={() => setTab("stats")}
        />
        {dbToolsAvailable && (
          <SubTabButton
            icon={<IconTransfer size={12} />}
            label="Import / export"
            active={tab === "tools"}
            onClick={() => setTab("tools")}
          />
        )}
        {devMode && (
          <SubTabButton
            icon={<IconBolt size={12} />}
            label="Dev tools"
            active={tab === "devtools"}
            onClick={() => setTab("devtools")}
            accent="red"
          />
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {tab === "stats" && <StatsTab cid={cid} database={database} />}
        {tab === "tools" && dbToolsAvailable && (
          <ImportExportTab cid={cid} database={database} />
        )}
        {tab === "devtools" && devMode && (
          <DevToolsTab cid={cid} database={database} />
        )}
      </div>
    </div>
  );
};

interface TabBtnProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  accent?: "red";
}

const SubTabButton = ({ icon, label, active, onClick, accent }: TabBtnProps) => {
  const activeClass =
    accent === "red"
      ? "bg-red-500/15 text-red-700 dark:bg-red-500/20 dark:text-red-300"
      : "bg-violet-500/15 text-violet-700 dark:bg-violet-500/20 dark:text-violet-200";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 rounded px-2 py-1 ${
        active
          ? activeClass
          : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
      }`}
    >
      {icon}
      {label}
    </button>
  );
};
