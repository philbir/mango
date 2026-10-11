import { useQuery } from "@tanstack/react-query";
import {
  IconAlertTriangle,
  IconPlus,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { useSettings } from "../../settings";
import { useActiveConnection } from "../connections/useActiveConnection";
import { useActiveDatabase } from "../connections/useActiveDatabase";
import type { FormatOptions } from "./docFormats";
import {
  coerceBuilderValue,
  formatShellValue,
  isBsonValue,
  parseFilterText,
  stringifyFilter,
} from "./filterText";

interface Props {
  collectionName: string;
  /** Filter text — JSON, Extended JSON or shell literals. */
  filterText: string;
  onChange: (text: string) => void;
  onRun?: (text: string) => void;
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

/** Sampled BSON types per field path, used to type bare values. */
type FieldTypes = Record<string, readonly string[]>;

interface Ctx {
  opts: FormatOptions;
  fieldTypes: FieldTypes;
}

/**
 * Hint for the value slot from the field's sampled types — bare ids, UUIDs and
 * ISO dates are typed automatically, so tell the user they can just paste one.
 */
const valuePlaceholder = (
  field: string,
  types: readonly string[] | undefined,
  list: boolean,
): string => {
  const t = types ?? [];
  const suffix = list ? ", comma-separated" : "";
  if (t.includes("uuid") || t.includes("binary")) return `UUID${suffix}`;
  if (t.includes("objectId") || (field === "_id" && !t.includes("string"))) {
    return `ObjectId hex${suffix}`;
  }
  if (t.includes("date")) return `ISO date, e.g. 2024-01-31${suffix}`;
  return list ? "a, b, c" : "value";
};

/** Builder value-slot text: strings unquoted, everything else as a shell literal. */
const formatValue = (raw: unknown, opts: FormatOptions): string =>
  typeof raw === "string" ? raw : formatShellValue(raw, opts);

const conditionToFilter = (
  c: Condition,
  ctx: Ctx,
): Record<string, unknown> | null => {
  if (!c.field) return null;
  const coerceValue = (raw: string) =>
    coerceBuilderValue(raw, c.field, ctx.fieldTypes[c.field], ctx.opts.uuidRepresentation);
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
  ctx: Ctx,
): Record<string, unknown> => {
  const parts = conditions
    .map((c) => conditionToFilter(c, ctx))
    .filter((p): p is Record<string, unknown> => p !== null);
  if (parts.length === 0) return {};
  if (parts.length === 1) return parts[0]!;
  return combinator === "and" ? { $and: parts } : { $or: parts };
};

const filterToText = (
  conditions: Condition[],
  combinator: "and" | "or",
  ctx: Ctx,
): string => stringifyFilter(buildFilter(conditions, combinator, ctx), ctx.opts);

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

const regexLeaf = (
  field: string,
  pattern: string,
  flags: string,
): Omit<Condition, "id"> => {
  // Detect friendly shapes that we emit, so the round-trip preserves
  // the operator the user picked.
  const inner = unescapeFriendly(pattern);
  if (inner !== null && flags === "i") {
    return { field, operator: inner.kind, value: inner.value };
  }
  const value = flags ? `/${pattern}/${flags}` : pattern;
  return { field, operator: "regex", value };
};

const isScalar = (value: unknown): boolean =>
  value === null ||
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean" ||
  isBsonValue(value);

const parseLeaf = (
  field: string,
  value: unknown,
  opts: FormatOptions,
): Omit<Condition, "id"> | null => {
  const fmt = (v: unknown) => formatValue(v, opts);
  // `{ name: /abc/i }` — also what `{ $regex, $options }` becomes after the
  // EJSON round-trip in parseFilterText.
  if (
    value !== null &&
    typeof value === "object" &&
    (value as { _bsontype?: string })._bsontype === "BSONRegExp"
  ) {
    const r = value as { pattern: string; options: string };
    return regexLeaf(field, r.pattern, r.options);
  }
  if (isScalar(value)) {
    return { field, operator: "eq", value: fmt(value) };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const v = value as Record<string, unknown>;
  const keys = Object.keys(v);
  if (keys.length === 1) {
    const k = keys[0]!;
    const arg = v[k];
    const simple: Record<string, Operator> = {
      $eq: "eq",
      $ne: "ne",
      $gt: "gt",
      $gte: "gte",
      $lt: "lt",
      $lte: "lte",
    };
    const op = simple[k];
    if (op && isScalar(arg)) return { field, operator: op, value: fmt(arg) };
    if (k === "$exists" && arg === true) return { field, operator: "exists", value: "" };
    if (k === "$in" && Array.isArray(arg) && arg.every(isScalar)) {
      return { field, operator: "in", value: arg.map(fmt).join(", ") };
    }
  }
  if (
    typeof v.$regex === "string" &&
    (keys.length === 1 || (keys.length === 2 && typeof v.$options === "string"))
  ) {
    return regexLeaf(field, v.$regex, typeof v.$options === "string" ? v.$options : "");
  }
  return null; // unsupported operator shape
};

const parseFilter = (text: string, opts: FormatOptions): ParseResult => {
  let obj: Record<string, unknown>;
  try {
    obj = parseFilterText(text, opts.uuidRepresentation);
  } catch {
    return { ...fallback(), supported: false };
  }
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
      const leaf = parseLeaf(field, pObj[field], opts);
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
    const leaf = parseLeaf(field, obj[field], opts);
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
  filterText,
  onChange,
}: Props) => {
  const { activeId } = useActiveConnection();
  const { database } = useActiveDatabase();
  const { formatOptions } = useSettings();

  const [initial] = useState(() => parseFilter(filterText, formatOptions));
  const [conditions, setConditions] = useState<Condition[]>(initial.conditions);
  const [combinator, setCombinator] = useState<"and" | "or">(initial.combinator);
  const [supported, setSupported] = useState(initial.supported);

  // Track the text we last emitted so external updates round-trip cleanly.
  const lastEmittedRef = useRef<string>(filterText);

  // Re-seed Builder when Raw changes externally (not from our own emit).
  useEffect(() => {
    if (filterText === lastEmittedRef.current) return;
    const parsed = parseFilter(filterText, formatOptions);
    setConditions(parsed.conditions);
    setCombinator(parsed.combinator);
    setSupported(parsed.supported);
    lastEmittedRef.current = filterText;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterText]);

  const { data: schema } = useQuery({
    queryKey: ["schema", activeId, database, collectionName],
    queryFn: () =>
      api.getSchema(activeId!, collectionName, 50, database ?? undefined),
    enabled: !!collectionName && !!activeId,
    staleTime: 60_000,
  });

  const fieldTypes = useMemo<FieldTypes>(
    () => Object.fromEntries((schema?.fields ?? []).map((f) => [f.path, f.types])),
    [schema],
  );

  // Push Builder edits up to Raw (only when supported). Re-runs when the
  // schema lands so bare values pick up their field's type (hex → ObjectId).
  useEffect(() => {
    if (!supported) return;
    const next = filterToText(conditions, combinator, {
      opts: formatOptions,
      fieldTypes,
    });
    if (next === lastEmittedRef.current) return;
    lastEmittedRef.current = next;
    onChange(next);
  }, [conditions, combinator, supported, onChange, formatOptions, fieldTypes]);

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
          className="btn btn-sm border-amber-400 text-amber-800 hover:bg-amber-100 dark:border-amber-700/60 dark:text-amber-200 dark:hover:bg-amber-900/30"
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
                <span className="eyebrow w-14">
                  Where
                </span>
              ) : (
                <select
                  value={combinator}
                  onChange={(e) => setCombinator(e.target.value as "and" | "or")}
                  className="h-[26px] w-14 rounded border border-slate-300 bg-white px-1 text-[11px] font-medium uppercase text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
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
                className="h-[26px] w-48 rounded border border-slate-300 bg-white px-2 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
              <select
                value={c.operator}
                onChange={(e) =>
                  updateCondition(c.id, { operator: e.target.value as Operator })
                }
                className="h-[26px] rounded border border-slate-300 bg-white px-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
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
                  placeholder={
                    op.placeholder ??
                    valuePlaceholder(c.field, fieldTypes[c.field], c.operator === "in")
                  }
                  className="h-[26px] flex-1 rounded border border-slate-300 bg-white px-2 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              )}
              <button
                type="button"
                onClick={() => removeCondition(c.id)}
                className="btn-icon btn-ghost"
                title="Remove condition"
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
          className="btn btn-sm btn-outline"
        >
          <IconPlus size={13} />
          Add condition
        </button>
        <span className="text-[11px] text-slate-400 dark:text-slate-500">
          Run with the toolbar button or <kbd>⌘</kbd> <kbd>↵</kbd>
        </span>
      </div>
    </div>
  );
};
