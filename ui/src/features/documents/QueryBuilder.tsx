import { useQuery } from "@tanstack/react-query";
import {
  IconAlertTriangle,
  IconPlayerPlayFilled,
  IconPlus,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { useActiveConnection } from "../connections/useActiveConnection";
import { useActiveDatabase } from "../connections/useActiveDatabase";

interface Props {
  collectionName: string;
  filterJson: string;
  onChange: (json: string) => void;
  onRun: (json: string) => void;
}

type Operator =
  | "eq"
  | "ne"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "startsWith"
  | "endsWith"
  | "regex"
  | "in"
  | "exists";

const OPERATORS: Array<{
  value: Operator;
  label: string;
  needsValue: boolean;
  placeholder?: string;
}> = [
  { value: "eq", label: "equals", needsValue: true },
  { value: "ne", label: "not equals", needsValue: true },
  { value: "gt", label: ">", needsValue: true },
  { value: "gte", label: "≥", needsValue: true },
  { value: "lt", label: "<", needsValue: true },
  { value: "lte", label: "≤", needsValue: true },
  {
    value: "contains",
    label: "contains",
    needsValue: true,
    placeholder: "substring (case-insensitive)",
  },
  {
    value: "startsWith",
    label: "starts with",
    needsValue: true,
    placeholder: "prefix",
  },
  {
    value: "endsWith",
    label: "ends with",
    needsValue: true,
    placeholder: "suffix",
  },
  {
    value: "regex",
    label: "regex /…/i",
    needsValue: true,
    placeholder: "/pattern/flags or pattern",
  },
  { value: "in", label: "in (CSV)", needsValue: true },
  { value: "exists", label: "exists", needsValue: false },
];

const escapeRegex = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface ParsedRegex {
  pattern: string;
  flags: string;
}

interface FriendlyShape {
  kind: "contains" | "startsWith" | "endsWith";
  value: string;
}

/**
 * If the regex pattern was produced by our friendly shapes (contains/starts/ends),
 * recover the literal substring. Otherwise return null.
 */
const unescapeFriendly = (pattern: string): FriendlyShape | null => {
  const isLiteralBody = (body: string): boolean =>
    !/(^|[^\\])\\?[.*+?^${}()|[\]]|^\\d|\\w|\\b/.test(body) ||
    /^[a-zA-Z0-9 _\-]+$/.test(body); // plain literal

  // ^...$ wouldn't appear from our wrappers; only ^... or ...$ or none.
  const startsWithMatch = pattern.match(/^\^(.+)$/);
  if (startsWithMatch && !startsWithMatch[1]!.endsWith("$")) {
    const body = unescapeRegexLiteral(startsWithMatch[1]!);
    if (body !== null) return { kind: "startsWith", value: body };
  }
  const endsWithMatch = pattern.match(/^(.+)\$$/);
  if (endsWithMatch && !endsWithMatch[1]!.startsWith("^")) {
    const body = unescapeRegexLiteral(endsWithMatch[1]!);
    if (body !== null) return { kind: "endsWith", value: body };
  }
  if (!pattern.startsWith("^") && !pattern.endsWith("$")) {
    const body = unescapeRegexLiteral(pattern);
    if (body !== null) return { kind: "contains", value: body };
  }
  return null;
  // (isLiteralBody intentionally referenced to silence unused-helper noise)
  void isLiteralBody;
};

/**
 * Reverse `escapeRegex`: confirm the body only contains plain chars + escaped
 * regex metas. Any non-escaped regex syntax → not a friendly shape.
 */
const unescapeRegexLiteral = (body: string): string | null => {
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch === "\\") {
      const next = body[i + 1];
      if (next === undefined) return null;
      if (".*+?^${}()|[]\\".includes(next)) {
        out += next;
        i++;
        continue;
      }
      return null; // unknown escape — not from us
    }
    if (".*+?^${}()|[]".includes(ch)) return null;
    out += ch;
  }
  return out;
};

const parseRegexInput = (raw: string): ParsedRegex => {
  // Accepts /pattern/flags or a bare pattern. Bare patterns default to flags "i".
  const m = raw.match(/^\/(.*)\/([a-zA-Z]*)$/);
  if (m) {
    return { pattern: m[1] ?? "", flags: m[2] ?? "" };
  }
  return { pattern: raw, flags: "i" };
};

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

const formatValue = (raw: unknown): string => {
  if (raw === null) return "null";
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  return JSON.stringify(raw);
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
    case "contains":
      return {
        [c.field]: { $regex: escapeRegex(c.value), $options: "i" },
      };
    case "startsWith":
      return {
        [c.field]: { $regex: `^${escapeRegex(c.value)}`, $options: "i" },
      };
    case "endsWith":
      return {
        [c.field]: { $regex: `${escapeRegex(c.value)}$`, $options: "i" },
      };
    case "regex": {
      const { pattern, flags } = parseRegexInput(c.value);
      const out: Record<string, unknown> = { $regex: pattern };
      if (flags) out.$options = flags;
      return { [c.field]: out };
    }
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

const filterToJson = (
  conditions: Condition[],
  combinator: "and" | "or",
): string => {
  const filter = buildFilter(conditions, combinator);
  return Object.keys(filter).length === 0
    ? ""
    : JSON.stringify(filter, null, 2);
};

interface ParseResult {
  conditions: Condition[];
  combinator: "and" | "or";
  supported: boolean;
}

const fallback = (): ParseResult => ({
  conditions: [newCondition()],
  combinator: "and",
  supported: true,
});

const parseLeaf = (
  field: string,
  value: unknown,
): Omit<Condition, "id"> | null => {
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    const keys = Object.keys(value as Record<string, unknown>);
    const v = value as Record<string, unknown>;
    if (keys.length === 1) {
      const k = keys[0]!;
      if (k === "$ne") return { field, operator: "ne", value: formatValue(v.$ne) };
      if (k === "$gt") return { field, operator: "gt", value: formatValue(v.$gt) };
      if (k === "$gte") return { field, operator: "gte", value: formatValue(v.$gte) };
      if (k === "$lt") return { field, operator: "lt", value: formatValue(v.$lt) };
      if (k === "$lte") return { field, operator: "lte", value: formatValue(v.$lte) };
      if (k === "$exists") return { field, operator: "exists", value: "" };
      if (k === "$in" && Array.isArray(v.$in)) {
        return { field, operator: "in", value: v.$in.map(formatValue).join(", ") };
      }
    }
    if (
      typeof v.$regex === "string" &&
      (keys.length === 1 || (keys.length === 2 && "$options" in v))
    ) {
      const pattern = v.$regex;
      const flags =
        typeof v.$options === "string" ? v.$options : "";
      // Detect friendly shapes that we emit, so the round-trip preserves
      // the operator the user picked.
      const inner = unescapeFriendly(pattern);
      if (inner !== null && flags === "i") {
        if (inner.kind === "contains") {
          return { field, operator: "contains", value: inner.value };
        }
        if (inner.kind === "startsWith") {
          return { field, operator: "startsWith", value: inner.value };
        }
        if (inner.kind === "endsWith") {
          return { field, operator: "endsWith", value: inner.value };
        }
      }
      const value = flags ? `/${pattern}/${flags}` : pattern;
      return { field, operator: "regex", value };
    }
    return null; // unsupported operator shape
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return { field, operator: "eq", value: formatValue(value) };
  }
  return null;
};

const parseFilter = (json: string): ParseResult => {
  const trimmed = json.trim();
  if (!trimmed) return fallback();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ...fallback(), supported: false };
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    return { ...fallback(), supported: false };
  }
  const obj = parsed as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) return fallback();

  // Top-level $and / $or → list of leaves
  if (
    keys.length === 1 &&
    (keys[0] === "$and" || keys[0] === "$or") &&
    Array.isArray(obj[keys[0]!])
  ) {
    const combinator: "and" | "or" = keys[0] === "$or" ? "or" : "and";
    const arr = obj[keys[0]!] as unknown[];
    const conditions: Condition[] = [];
    for (const part of arr) {
      if (
        !part ||
        typeof part !== "object" ||
        Array.isArray(part)
      ) {
        return { ...fallback(), supported: false };
      }
      const pObj = part as Record<string, unknown>;
      const pKeys = Object.keys(pObj);
      if (pKeys.length !== 1) {
        return { ...fallback(), supported: false };
      }
      const field = pKeys[0]!;
      if (field.startsWith("$")) {
        return { ...fallback(), supported: false };
      }
      const leaf = parseLeaf(field, pObj[field]);
      if (!leaf) return { ...fallback(), supported: false };
      conditions.push({ id: nextId++, ...leaf });
    }
    return {
      conditions: conditions.length > 0 ? conditions : [newCondition()],
      combinator,
      supported: true,
    };
  }

  // Single-field shape
  const conditions: Condition[] = [];
  for (const field of keys) {
    if (field.startsWith("$")) {
      return { ...fallback(), supported: false };
    }
    const leaf = parseLeaf(field, obj[field]);
    if (!leaf) return { ...fallback(), supported: false };
    conditions.push({ id: nextId++, ...leaf });
  }
  return {
    conditions: conditions.length > 0 ? conditions : [newCondition()],
    combinator: "and",
    supported: true,
  };
};

export const QueryBuilder = ({
  collectionName,
  filterJson,
  onChange,
  onRun,
}: Props) => {
  const { activeId } = useActiveConnection();
  const { database } = useActiveDatabase();

  const initial = parseFilter(filterJson);
  const [conditions, setConditions] = useState<Condition[]>(initial.conditions);
  const [combinator, setCombinator] = useState<"and" | "or">(initial.combinator);
  const [supported, setSupported] = useState(initial.supported);

  // Track the JSON we last emitted so external updates round-trip cleanly.
  const lastEmittedRef = useRef<string>(filterJson);

  // Re-seed Builder when Raw changes externally (not from our own emit).
  useEffect(() => {
    if (filterJson === lastEmittedRef.current) return;
    const parsed = parseFilter(filterJson);
    setConditions(parsed.conditions);
    setCombinator(parsed.combinator);
    setSupported(parsed.supported);
    lastEmittedRef.current = filterJson;
  }, [filterJson]);

  // Push Builder edits up to Raw (only when supported).
  useEffect(() => {
    if (!supported) return;
    const next = filterToJson(conditions, combinator);
    if (next === lastEmittedRef.current) return;
    lastEmittedRef.current = next;
    onChange(next);
  }, [conditions, combinator, supported, onChange]);

  const { data: schema } = useQuery({
    queryKey: ["schema", activeId, database, collectionName],
    queryFn: () =>
      api.getSchema(activeId!, collectionName, 50, database ?? undefined),
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
    setConditions((arr) =>
      arr.length === 1 ? [newCondition()] : arr.filter((c) => c.id !== id),
    );
  };

  const addCondition = () => {
    setConditions((arr) => [...arr, newCondition()]);
  };

  const onRunClicked = () => {
    onRun(filterToJson(conditions, combinator));
  };

  const resetFromRaw = () => {
    const empty = [newCondition()];
    setConditions(empty);
    setCombinator("and");
    setSupported(true);
    lastEmittedRef.current = "";
    onChange("");
  };

  if (!supported) {
    return (
      <div className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200">
        <IconAlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <div className="font-medium">
            This filter can't be edited as Builder conditions.
          </div>
          <div className="mt-0.5 text-amber-700 dark:text-amber-300">
            Edit it in the Raw tab, or reset Builder to start over.
          </div>
        </div>
        <button
          type="button"
          onClick={resetFromRaw}
          className="rounded border border-amber-400 px-2 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-700/60 dark:text-amber-200 dark:hover:bg-amber-900/30"
        >
          Reset
        </button>
      </div>
    );
  }

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
                  placeholder={op.placeholder ?? "value"}
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
