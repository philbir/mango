import {
  IconBolt,
  IconChartBar,
  IconDatabase,
  IconPlugConnected,
  IconTransfer,
} from "@tabler/icons-react";
import { useState } from "react";
import { useServerConfig } from "../connections/useServerConfig";
import { ConnectionTab } from "./ConnectionTab";
import { DevToolsTab } from "./DevToolsTab";
import { ImportExportTab } from "./ImportExportTab";
import { StatsTab } from "./StatsTab";

type SubTab = "stats" | "connection" | "devtools" | "tools";

interface Props {
  cid: string;
  database: string;
}

export const DatabaseView = ({ cid, database }: Props) => {
  const { devMode, dbToolsAvailable } = useServerConfig();
  const [tab, setTab] = useState<SubTab>("stats");

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex h-10 flex-shrink-0 items-center gap-3 border-b border-slate-200 bg-slate-50 pl-4 pr-12 dark:border-slate-800 dark:bg-slate-900/40">
        <IconDatabase size={16} className="flex-shrink-0 text-amber-500" />
        <span className="min-w-[3rem] truncate font-mono text-[14px] font-medium text-slate-900 dark:text-slate-100">
          {database}
        </span>
        <div className="flex-1" />
        <div className="seg">
        <SubTabButton
          icon={<IconChartBar size={13} />}
          label="Stats"
          active={tab === "stats"}
          onClick={() => setTab("stats")}
        />
        <SubTabButton
          icon={<IconPlugConnected size={13} />}
          label="Connection"
          active={tab === "connection"}
          onClick={() => setTab("connection")}
        />
        {dbToolsAvailable && (
          <SubTabButton
            icon={<IconTransfer size={13} />}
            label="Import / export"
            active={tab === "tools"}
            onClick={() => setTab("tools")}
          />
        )}
        {devMode && (
          <SubTabButton
            icon={<IconBolt size={13} />}
            label="Dev tools"
            active={tab === "devtools"}
            onClick={() => setTab("devtools")}
            accent="red"
          />
        )}
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        {tab === "stats" && <StatsTab cid={cid} database={database} />}
        {tab === "connection" && <ConnectionTab cid={cid} />}
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
      ? "data-[active=true]:bg-red-500/15 data-[active=true]:text-red-700 dark:data-[active=true]:bg-red-500/20 dark:data-[active=true]:text-red-300"
      : "data-[active=true]:bg-violet-500/15 data-[active=true]:text-violet-700 dark:data-[active=true]:bg-violet-500/20 dark:data-[active=true]:text-violet-200";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`seg-item ${activeClass}`}
      data-active={active}
    >
      {icon}
      {label}
    </button>
  );
};
