import { useMutation } from "@tanstack/react-query";
import {
  IconAlertCircle,
  IconBolt,
  IconCheck,
  IconLoader2,
  IconPlayerPlayFilled,
  IconSparkles,
  IconX,
} from "@tabler/icons-react";
import { useMemo, useRef, useState } from "react";
import { ApiError, api, stringifyEJSON } from "../../api/client";
import { InteractiveJsonView } from "../../components/JsonView";
import {
  MonacoJsonInput,
  type MonacoJsonInputHandle,
} from "../../components/MonacoJsonInput";
import { useAssistant } from "../assistant/AssistantContext";

interface Props {
  cid: string;
  database: string | null;
  collection: string;
  /** Called when an explain runs successfully so the parent can stash its
   * rendered text for the assistant. */
  onExplainResult?: (text: string | null) => void;
}

type Mode = "find" | "aggregate";

export const PlaygroundPanel = ({
  cid,
  database,
  collection,
  onExplainResult,
}: Props) => {
  const { setOpen: setAssistantOpen } = useAssistant();
  const [mode, setMode] = useState<Mode>("find");
  const [filter, setFilter] = useState("{\n  \n}");
  const [sort, setSort] = useState("");
  const [pipeline, setPipeline] = useState(
    '[\n  { "$match": { } }\n]',
  );
  const [verbosity, setVerbosity] =
    useState<"queryPlanner" | "executionStats" | "allPlansExecution">(
      "executionStats",
    );

  const filterRef = useRef<MonacoJsonInputHandle | null>(null);
  const sortRef = useRef<MonacoJsonInputHandle | null>(null);
  const pipelineRef = useRef<MonacoJsonInputHandle | null>(null);

  const explain = useMutation({
    mutationFn: () =>
      api.runExplain({
        cid,
        name: collection,
        database: database ?? undefined,
        verbosity,
        ...(mode === "aggregate"
          ? { pipeline }
          : { filter, sort: sort.trim() || undefined }),
      }),
    onSuccess: (r) => {
      // Hand a compact rendered version to the parent so it can pass it as
      // assistant context.
      onExplainResult?.(renderExplainSummary(r.explain));
    },
    onError: () => onExplainResult?.(null),
  });

  const summary = useMemo(
    () => (explain.data ? extractKeyMetrics(explain.data.explain) : null),
    [explain.data],
  );

  const errorMessage =
    explain.error instanceof ApiError
      ? explain.error.message
      : explain.error instanceof Error
        ? explain.error.message
        : null;

  return (
    <div className="flex h-full flex-col p-5">
      <header className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
            <IconBolt size={16} className="text-amber-500 dark:text-amber-300" />
            Query playground
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Run <span className="font-mono">explain()</span> to inspect the
            plan, then ask the assistant for optimization tips.
          </p>
        </div>
        <div className="flex rounded border border-slate-300 bg-white p-0.5 text-xs dark:border-slate-700 dark:bg-slate-900">
          <button
            type="button"
            onClick={() => setMode("find")}
            className={`rounded px-2 py-1 ${
              mode === "find"
                ? "bg-sky-500/15 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200"
                : "text-slate-600 dark:text-slate-300"
            }`}
          >
            find
          </button>
          <button
            type="button"
            onClick={() => setMode("aggregate")}
            className={`rounded px-2 py-1 ${
              mode === "aggregate"
                ? "bg-sky-500/15 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200"
                : "text-slate-600 dark:text-slate-300"
            }`}
          >
            aggregate
          </button>
        </div>
      </header>

      <div className="grid flex-shrink-0 gap-3 md:grid-cols-2">
        {mode === "find" ? (
          <>
            <FieldGroup
              label="Filter"
              onFormat={() => filterRef.current?.format()}
            >
              <div className="h-32 overflow-hidden rounded border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900">
                <MonacoJsonInput
                  ref={filterRef}
                  value={filter}
                  onChange={setFilter}
                  minHeight="128px"
                  showLineNumbers
                  onSubmit={() => explain.mutate()}
                />
              </div>
            </FieldGroup>
            <FieldGroup
              label="Sort (optional)"
              onFormat={() => sortRef.current?.format()}
            >
              <div className="h-32 overflow-hidden rounded border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900">
                <MonacoJsonInput
                  ref={sortRef}
                  value={sort}
                  onChange={setSort}
                  minHeight="128px"
                  showLineNumbers
                  onSubmit={() => explain.mutate()}
                />
              </div>
            </FieldGroup>
          </>
        ) : (
          <FieldGroup
            label="Pipeline"
            onFormat={() => pipelineRef.current?.format()}
            full
          >
            <div className="h-48 overflow-hidden rounded border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900">
              <MonacoJsonInput
                ref={pipelineRef}
                value={pipeline}
                onChange={setPipeline}
                minHeight="192px"
                showLineNumbers
                onSubmit={() => explain.mutate()}
              />
            </div>
          </FieldGroup>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-500">
          Verbosity
        </span>
        <select
          value={verbosity}
          onChange={(e) => setVerbosity(e.target.value as typeof verbosity)}
          className="rounded border border-slate-300 bg-white px-2 py-0.5 font-mono text-[11px] text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          <option value="queryPlanner">queryPlanner</option>
          <option value="executionStats">executionStats</option>
          <option value="allPlansExecution">allPlansExecution</option>
        </select>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => explain.mutate()}
          disabled={explain.isPending}
          className="flex items-center gap-1.5 rounded bg-sky-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50"
        >
          {explain.isPending ? (
            <>
              <IconLoader2 size={14} className="animate-spin" />
              Explaining…
            </>
          ) : (
            <>
              <IconPlayerPlayFilled size={14} />
              Explain
            </>
          )}
        </button>
        <button
          type="button"
          onClick={() => setAssistantOpen(true)}
          disabled={!explain.data}
          className="flex items-center gap-1.5 rounded border border-violet-300 bg-violet-50 px-3 py-1.5 text-sm font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-50 dark:border-violet-500/40 dark:bg-violet-900/20 dark:text-violet-200 dark:hover:bg-violet-900/30"
          title="Ask the assistant to optimize this query"
        >
          <IconSparkles size={14} />
          Optimize with AI
        </button>
      </div>

      {errorMessage && (
        <div className="mt-3 flex items-start gap-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
          <IconAlertCircle size={14} className="mt-0.5 flex-shrink-0" />
          <div>{errorMessage}</div>
        </div>
      )}

      {summary && <SummaryRow summary={summary} />}

      {explain.data && (
        <section className="mt-3 flex-1 min-h-0 overflow-auto rounded border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/40">
          <InteractiveJsonView value={explain.data.explain} collapsed={2} />
        </section>
      )}
    </div>
  );
};

const FieldGroup = ({
  label,
  onFormat,
  full,
  children,
}: {
  label: string;
  onFormat: () => void;
  full?: boolean;
  children: React.ReactNode;
}) => (
  <div className={full ? "md:col-span-2" : ""}>
    <div className="mb-1 flex items-center justify-between">
      <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-500">
        {label}
      </span>
      <button
        type="button"
        onClick={onFormat}
        className="text-[10px] text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
      >
        Format
      </button>
    </div>
    {children}
  </div>
);

interface ExplainMetrics {
  stage: string;
  indexName: string | null;
  isCollScan: boolean;
  nReturned: number | null;
  totalKeysExamined: number | null;
  totalDocsExamined: number | null;
  executionTimeMillis: number | null;
}

const extractKeyMetrics = (explain: unknown): ExplainMetrics => {
  const winning = digWinningPlan(explain);
  const exec = (explain as { executionStats?: Record<string, unknown> })
    .executionStats;
  return {
    stage: (winning?.stage as string) ?? "?",
    indexName: (winning?.indexName as string) ?? null,
    isCollScan: containsStage(winning, "COLLSCAN"),
    nReturned:
      typeof exec?.nReturned === "number" ? (exec.nReturned as number) : null,
    totalKeysExamined:
      typeof exec?.totalKeysExamined === "number"
        ? (exec.totalKeysExamined as number)
        : null,
    totalDocsExamined:
      typeof exec?.totalDocsExamined === "number"
        ? (exec.totalDocsExamined as number)
        : null,
    executionTimeMillis:
      typeof exec?.executionTimeMillis === "number"
        ? (exec.executionTimeMillis as number)
        : null,
  };
};

const digWinningPlan = (explain: unknown): Record<string, unknown> | null => {
  const root = explain as Record<string, unknown>;
  if (!root) return null;
  const qp = root.queryPlanner as Record<string, unknown> | undefined;
  if (qp?.winningPlan) return qp.winningPlan as Record<string, unknown>;
  if (Array.isArray(root.stages) && root.stages.length > 0) {
    const first = root.stages[0] as Record<string, unknown>;
    return (first?.["$cursor"] as Record<string, unknown>)?.queryPlanner as
      | Record<string, unknown>
      | null;
  }
  return null;
};

const containsStage = (
  plan: Record<string, unknown> | null | undefined,
  stage: string,
): boolean => {
  if (!plan) return false;
  if (plan.stage === stage) return true;
  const inner = plan.inputStage as Record<string, unknown> | undefined;
  if (inner) return containsStage(inner, stage);
  const inputs = plan.inputStages as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(inputs)) {
    return inputs.some((s) => containsStage(s, stage));
  }
  return false;
};

const SummaryRow = ({ summary }: { summary: ExplainMetrics }) => {
  const verdict =
    summary.isCollScan ? "warn" : summary.indexName ? "ok" : "neutral";
  const badge =
    verdict === "warn"
      ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200"
      : verdict === "ok"
        ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700/40 dark:bg-emerald-900/20 dark:text-emerald-200"
        : "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200";
  const icon = verdict === "warn" ? <IconX size={12} /> : <IconCheck size={12} />;

  return (
    <div className={`mt-3 rounded border px-3 py-2 text-[12px] ${badge}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-1 font-medium">
          {icon}
          {summary.isCollScan
            ? "Collection scan"
            : summary.indexName
              ? `Using index ${summary.indexName}`
              : `Stage: ${summary.stage}`}
        </span>
        {summary.nReturned !== null && (
          <Stat label="returned" value={summary.nReturned.toLocaleString()} />
        )}
        {summary.totalKeysExamined !== null && (
          <Stat
            label="keys"
            value={summary.totalKeysExamined.toLocaleString()}
          />
        )}
        {summary.totalDocsExamined !== null && (
          <Stat
            label="docs scanned"
            value={summary.totalDocsExamined.toLocaleString()}
          />
        )}
        {summary.executionTimeMillis !== null && (
          <Stat label="time" value={`${summary.executionTimeMillis} ms`} />
        )}
      </div>
    </div>
  );
};

const Stat = ({ label, value }: { label: string; value: string }) => (
  <span className="text-[11.5px]">
    <span className="opacity-70">{label}:</span>{" "}
    <span className="font-mono font-medium">{value}</span>
  </span>
);

/** Compact human-readable summary used as assistant context. */
const renderExplainSummary = (explain: Record<string, unknown>): string => {
  // Cap the JSON to ~6KB so we don't blow the prompt budget on huge plans.
  const json = stringifyEJSON(explain, true);
  if (json.length <= 6000) return json;
  return `${json.slice(0, 6000)}\n…(truncated)`;
};
