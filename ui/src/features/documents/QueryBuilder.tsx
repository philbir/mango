import { useQuery } from "@tanstack/react-query";
import { IconPlayerPlayFilled, IconPlus, IconX } from "@tabler/icons-react";
import { useState } from "react";
import { api } from "../../api/client";
import { useActiveConnection } from "../connections/useActiveConnection";

interface Props {
  collectionName: string;
  initialJson: string;
  onRun: (json: string) => void;
}

type Operator =
  | "eq"
  | "ne"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "regex"
  | "in"
  | "exists";

const OPERATORS: Array<{ value: Operator; label: string; needsValue: boolean }> = [
  { value: "eq", label: "equals", needsValue: true },
  { value: "ne", label: "not equals", needsValue: true },
  { value: "gt", label: ">", needsValue: true },
  { value: "gte", label: "≥", needsValue: true },
  { value: "lt", label: "<", needsValue: true },
  { value: "lte", label: "≤", needsValue: true },
  { value: "regex", label: "matches /…/", needsValue: true },
  { value: "in", label: "in (CSV)", needsValue: true },
  { value: "exists", label: "exists", needsValue: false },
];

interface Condition {
  id: number;
  field: string;
  operator: Operator;
  value: string;
}

let nextId = 1;
const newCondition = (): Condition => ({
  id: nextId++,
  field: "",
  operator: "eq",
  value: "",
});

const coerceValue = (raw: string): unknown => {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  if (/^-?\d+\.\d+$/.test(trimmed)) return Number(trimmed);
  return trimmed;
};

const conditionToFilter = (c: Condition): Record<string, unknown> | null => {
  if (!c.field) return null;
  switch (c.operator) {
    case "eq":
      return { [c.field]: coerceValue(c.value) };
    case "ne":
      return { [c.field]: { $ne: coerceValue(c.value) } };
    case "gt":
      return { [c.field]: { $gt: coerceValue(c.value) } };
    case "gte":
      return { [c.field]: { $gte: coerceValue(c.value) } };
    case "lt":
      return { [c.field]: { $lt: coerceValue(c.value) } };
    case "lte":
      return { [c.field]: { $lte: coerceValue(c.value) } };
    case "regex":
      return { [c.field]: { $regex: c.value, $options: "i" } };
    case "in":
      return {
        [c.field]: {
          $in: c.value
            .split(",")
            .map((v) => coerceValue(v.trim()))
            .filter((v) => v !== ""),
        },
      };
    case "exists":
      return { [c.field]: { $exists: true } };
    default:
      return null;
  }
};

const buildFilter = (
  conditions: Condition[],
  combinator: "and" | "or",
): Record<string, unknown> => {
  const parts = conditions
    .map(conditionToFilter)
    .filter((p): p is Record<string, unknown> => p !== null);
  if (parts.length === 0) return {};
  if (parts.length === 1) return parts[0]!;
  return combinator === "and" ? { $and: parts } : { $or: parts };
};

export const QueryBuilder = ({ collectionName, onRun }: Props) => {
  const { activeId } = useActiveConnection();
  const [conditions, setConditions] = useState<Condition[]>([newCondition()]);
  const [combinator, setCombinator] = useState<"and" | "or">("and");

  const { data: schema } = useQuery({
    queryKey: ["schema", activeId, collectionName],
    queryFn: () => api.getSchema(activeId!, collectionName, 50),
    enabled: !!collectionName && !!activeId,
    staleTime: 60_000,
  });

  const fieldNames = schema?.fields.map((f) => f.path) ?? [];

  const updateCondition = (id: number, patch: Partial<Condition>) => {
    setConditions((arr) =>
      arr.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    );
  };

  const removeCondition = (id: number) => {
    setConditions((arr) => arr.filter((c) => c.id !== id));
  };

  const addCondition = () => {
    setConditions((arr) => [...arr, newCondition()]);
  };

  const onRunClicked = () => {
    const filter = buildFilter(conditions, combinator);
    onRun(Object.keys(filter).length === 0 ? "" : JSON.stringify(filter, null, 2));
  };

  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        {conditions.map((c, idx) => {
          const op = OPERATORS.find((o) => o.value === c.operator)!;
          return (
            <div key={c.id} className="flex flex-wrap items-center gap-1.5">
              {idx === 0 ? (
                <span className="w-12 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-500">
                  Where
                </span>
              ) : (
                <select
                  value={combinator}
                  onChange={(e) => setCombinator(e.target.value as "and" | "or")}
                  className="w-12 rounded border border-slate-300 bg-white px-1 py-1 text-[11px] uppercase text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  <option value="and">AND</option>
                  <option value="or">OR</option>
                </select>
              )}
              <input
                list={`fields-${collectionName}`}
                value={c.field}
                onChange={(e) => updateCondition(c.id, { field: e.target.value })}
                placeholder="field"
                className="w-44 rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
              <select
                value={c.operator}
                onChange={(e) =>
                  updateCondition(c.id, { operator: e.target.value as Operator })
                }
                className="rounded border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                {OPERATORS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {op.needsValue && (
                <input
                  value={c.value}
                  onChange={(e) => updateCondition(c.id, { value: e.target.value })}
                  placeholder="value"
                  className="flex-1 rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              )}
              <button
                type="button"
                onClick={() => removeCondition(c.id)}
                className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <IconX size={14} />
              </button>
            </div>
          );
        })}
        <datalist id={`fields-${collectionName}`}>
          {fieldNames.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      </div>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={addCondition}
          className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <IconPlus size={12} />
          Add condition
        </button>
        <button
          type="button"
          onClick={onRunClicked}
          className="flex items-center gap-1.5 rounded bg-sky-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-400"
        >
          <IconPlayerPlayFilled size={14} />
          Run
        </button>
      </div>
    </div>
  );
};
