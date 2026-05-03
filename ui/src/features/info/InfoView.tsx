import { IconBolt, IconChartBar, IconKey } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { type IndexInfo } from "../../api/client";
import { useAssistantContextProvider } from "../assistant/useAssistantContextProvider";
import { IndexesPanel, renderIndexesForPrompt } from "./IndexesPanel";
import { PlaygroundPanel } from "./PlaygroundPanel";
import { StatsPanel } from "./StatsPanel";

type SubTab = "stats" | "indexes" | "playground";

interface Props {
  cid: string;
  database: string | null;
  collection: string;
  /** Stable key for the assistant message thread when this view is active. */
  threadKey: string;
}

export const InfoView = ({ cid, database, collection, threadKey }: Props) => {
  const [tab, setTab] = useState<SubTab>("stats");

  // The InfoView feeds the assistant a context payload with the latest index
  // list and explain output so the LLM can reason about optimization. We keep
  // both bits of state here and hand them to the binding hook.
  const [indexes, setIndexes] = useState<IndexInfo[] | null>(null);
  const [explainText, setExplainText] = useState<string | null>(null);

  const indexesText = indexes ? renderIndexesForPrompt(indexes) : null;

  useAssistantContextProvider({
    key: threadKey,
    mode: "indexes",
    collection,
    context: {
      indexes: indexesText,
      explain: explainText,
    },
  });

  useEffect(() => {
    // When switching collections, drop stale state so the assistant doesn't
    // see indexes from the previous collection on the first chat turn.
    setIndexes(null);
    setExplainText(null);
  }, [collection]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-shrink-0 items-center gap-1 border-b border-slate-200 bg-slate-50/60 px-4 py-1.5 text-xs dark:border-slate-800 dark:bg-slate-900/30">
        <SubTabButton
          icon={<IconChartBar size={12} />}
          label="Stats"
          active={tab === "stats"}
          onClick={() => setTab("stats")}
        />
        <SubTabButton
          icon={<IconKey size={12} />}
          label="Indexes"
          active={tab === "indexes"}
          onClick={() => setTab("indexes")}
        />
        <SubTabButton
          icon={<IconBolt size={12} />}
          label="Playground"
          active={tab === "playground"}
          onClick={() => setTab("playground")}
        />
      </div>

      <div className="flex-1 overflow-auto">
        {tab === "stats" && (
          <StatsPanel
            cid={cid}
            database={database}
            collection={collection}
          />
        )}
        {tab === "indexes" && (
          <IndexesPanel
            cid={cid}
            database={database}
            collection={collection}
            onIndexesChange={setIndexes}
          />
        )}
        {tab === "playground" && (
          <PlaygroundPanel
            cid={cid}
            database={database}
            collection={collection}
            onExplainResult={setExplainText}
          />
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
}

const SubTabButton = ({ icon, label, active, onClick }: TabBtnProps) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex items-center gap-1 rounded px-2 py-1 ${
      active
        ? "bg-violet-500/15 text-violet-700 dark:bg-violet-500/20 dark:text-violet-200"
        : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
    }`}
  >
    {icon}
    {label}
  </button>
);
