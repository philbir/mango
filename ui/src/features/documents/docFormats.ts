import { EJSON } from "bson";
import {
  formatUuid,
  humanizeForDisplay,
  stringifyEJSON,
  type UuidRepresentation,
} from "../../api/client";

/**
 * The set of JSON "flavours" the document viewer can render a Mongo document
 * in — mirroring the export/copy formats offered by tools like Studio 3T.
 *
 *  - `shell-legacy`  → legacy mongo-shell literal syntax
 *                      (`ObjectId("…")`, `ISODate("…")`, `NumberLong("…")`),
 *                      double-quoted keys/strings.
 *  - `shell`         → modern mongosh literal syntax
 *                      (`ObjectId('…')`, `Long('…')`, `Decimal128('…')`),
 *                      unquoted identifier keys, single-quoted strings.
 *  - `simple`        → relaxed Extended JSON — numbers/strings plain, only
 *                      non-representable types (`$oid`, `$date`) wrapped.
 *  - `mongoexport`   → canonical Extended JSON, exactly what `mongoexport`
 *                      writes (`{ "$oid": … }`, `{ "$numberLong": … }`).
 *  - `pure`          → plain JSON with every BSON type unwrapped to its
 *                      natural value (hex strings, ISO dates, numbers).
 */
export type DocFormat =
  | "shell-legacy"
  | "shell"
  | "simple"
  | "mongoexport"
  | "pure";

export const DOC_FORMATS: ReadonlyArray<{ value: DocFormat; label: string }> = [
  { value: "shell-legacy", label: "JSON: Legacy Mongo Shell Format" },
  { value: "shell", label: "JSON: MongoDB Shell Format" },
  { value: "simple", label: "JSON: Simple Format" },
  { value: "mongoexport", label: "JSON: Mongoexport Format" },
  { value: "pure", label: "JSON: Pure, without MongoDB types" },
];

/** Formats that render shell literals (not valid JSON) — highlighted as JS. */
export const isShellFormat = (format: DocFormat): boolean =>
  format === "shell" || format === "shell-legacy";

/**
 * Render a document (or any value) as text in the requested format. `value` is
 * expected to hold BSON runtime instances (what `EJSON.parse(relaxed:false)`
 * produces) — the same shape everything else in the app passes around.
 */
export const formatDocument = (
  value: unknown,
  format: DocFormat,
  representation: UuidRepresentation,
): string => {
  switch (format) {
    case "mongoexport":
      return stringifyEJSON(value);
    case "simple":
      return EJSON.stringify(value as never, undefined, 2, { relaxed: true });
    case "pure":
      return JSON.stringify(
        humanizeForDisplay(value, representation),
        null,
        2,
      );
    case "shell":
      return renderShell(value, representation, false);
    case "shell-legacy":
      return renderShell(value, representation, true);
  }
};

// ── Shell literal rendering ───────────────────────────────────────────────

const INDENT = "  ";
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Serialize to canonical Extended JSON first (plain objects with `$oid`,
 * `$date`, … wrappers) so we walk well-documented shapes rather than poking at
 * BSON class internals, then re-emit as shell literals.
 */
const renderShell = (
  value: unknown,
  rep: UuidRepresentation,
  legacy: boolean,
): string => {
  const canonical = EJSON.serialize(value as never, { relaxed: false });
  return renderNode(canonical, rep, legacy, 0);
};

const renderNode = (
  node: unknown,
  rep: UuidRepresentation,
  legacy: boolean,
  depth: number,
): string => {
  if (node === null) return "null";
  if (node === undefined) return "undefined";
  const t = typeof node;
  if (t === "number" || t === "boolean") return String(node);
  if (t === "string") return quote(node as string, legacy);
  if (Array.isArray(node)) return renderArray(node, rep, legacy, depth);
  if (t === "object") {
    const wrapped = renderWrapper(node as Record<string, unknown>, rep, legacy);
    if (wrapped !== null) return wrapped;
    return renderObject(node as Record<string, unknown>, rep, legacy, depth);
  }
  return String(node);
};

const renderArray = (
  arr: unknown[],
  rep: UuidRepresentation,
  legacy: boolean,
  depth: number,
): string => {
  if (arr.length === 0) return "[]";
  const pad = INDENT.repeat(depth + 1);
  const close = INDENT.repeat(depth);
  const lines = arr.map(
    (v) => `${pad}${renderNode(v, rep, legacy, depth + 1)}`,
  );
  return `[\n${lines.join(",\n")}\n${close}]`;
};

const renderObject = (
  obj: Record<string, unknown>,
  rep: UuidRepresentation,
  legacy: boolean,
  depth: number,
): string => {
  const keys = Object.keys(obj);
  if (keys.length === 0) return "{}";
  const pad = INDENT.repeat(depth + 1);
  const close = INDENT.repeat(depth);
  const lines = keys.map((k) => {
    const key = legacy
      ? `"${k}"`
      : IDENTIFIER.test(k)
        ? k
        : `'${k.replace(/'/g, "\\'")}'`;
    return `${pad}${key}: ${renderNode(obj[k], rep, legacy, depth + 1)}`;
  });
  return `{\n${lines.join(",\n")}\n${close}}`;
};

/**
 * Map a canonical Extended JSON type wrapper to a shell constructor. Returns
 * null when `obj` isn't a recognized `$`-wrapper, so it falls through to plain
 * object rendering (which also covers DBRef `{ $ref, $id }`).
 */
const renderWrapper = (
  obj: Record<string, unknown>,
  rep: UuidRepresentation,
  legacy: boolean,
): string | null => {
  const q = legacy ? '"' : "'";

  if ("$oid" in obj) return `ObjectId(${q}${obj.$oid}${q})`;

  if ("$date" in obj) return `ISODate(${q}${isoDate(obj.$date)}${q})`;

  if ("$numberInt" in obj) {
    return legacy ? `NumberInt(${obj.$numberInt})` : String(obj.$numberInt);
  }
  if ("$numberLong" in obj) {
    return legacy
      ? `NumberLong(${q}${obj.$numberLong}${q})`
      : `Long(${q}${obj.$numberLong}${q})`;
  }
  if ("$numberDouble" in obj) {
    const s = String(obj.$numberDouble);
    // Infinity / NaN aren't bare literals in either shell — keep the wrapper.
    if (s === "Infinity" || s === "-Infinity" || s === "NaN") {
      return `${q}${s}${q}`;
    }
    return s;
  }
  if ("$numberDecimal" in obj) {
    return legacy
      ? `NumberDecimal(${q}${obj.$numberDecimal}${q})`
      : `Decimal128(${q}${obj.$numberDecimal}${q})`;
  }

  if ("$binary" in obj) {
    const uuid = formatUuid(obj, rep);
    if (uuid) return `UUID(${q}${uuid}${q})`;
    const bin = obj.$binary as { base64: string; subType: string };
    const sub = parseInt(bin.subType, 16);
    return legacy
      ? `BinData(${sub}, ${q}${bin.base64}${q})`
      : `Binary.createFromBase64(${q}${bin.base64}${q}, ${sub})`;
  }

  if ("$timestamp" in obj) {
    const ts = obj.$timestamp as { t: number; i: number };
    return legacy
      ? `Timestamp(${ts.t}, ${ts.i})`
      : `Timestamp({ t: ${ts.t}, i: ${ts.i} })`;
  }

  if ("$regularExpression" in obj) {
    const r = obj.$regularExpression as { pattern: string; options?: string };
    return `/${r.pattern}/${r.options ?? ""}`;
  }

  if ("$minKey" in obj) return "MinKey()";
  if ("$maxKey" in obj) return "MaxKey()";
  if ("$undefined" in obj) return "undefined";
  if ("$symbol" in obj) return quote(String(obj.$symbol), legacy);
  if ("$code" in obj && !("$scope" in obj)) {
    return `Code(${quote(String(obj.$code), legacy)})`;
  }

  return null;
};

const isoDate = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "$numberLong" in value) {
    const ms = Number((value as { $numberLong: string }).$numberLong);
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  return String(value);
};

const quote = (s: string, legacy: boolean): string => {
  if (legacy) return JSON.stringify(s);
  return `'${s
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")}'`;
};
