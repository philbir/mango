import { EJSON } from "bson";
import {
  formatUuid,
  parseEJSON,
  stringifyEJSON,
  type UuidRepresentation,
} from "../../api/client";
import { parseShellDocument } from "./shellParse";

/**
 * The JSON "flavours" documents are rendered in — one global choice (Settings →
 * Configure formats) shared by the result list, the document viewer and the
 * update editor so the same document always reads the same way.
 *
 *  - `shell`     → mongo shell literal syntax, the SQLBooster / Robo 3T look:
 *                  `"key" : ObjectId("…")`, `ISODate("…")`, `Decimal128("…")`,
 *                  tab-indented. Parsed back by `shellParse.ts` on save.
 *  - `canonical` → canonical Extended JSON v2 (`{ "$oid": … }`,
 *                  `{ "$numberInt": … }`) — lossless, what the API speaks.
 *  - `relaxed`   → relaxed Extended JSON v2 — plain numbers, only
 *                  non-representable types (`$oid`, `$date`) wrapped.
 *  - `json`      → plain JSON with every BSON type unwrapped to its natural
 *                  value. Display only — editing falls back to `shell`.
 */
export type JsonViewFormat = "shell" | "canonical" | "relaxed" | "json";

/** How dates are rendered: local wall-clock time with offset, or UTC (`Z`). */
export type DateDisplay = "local" | "utc";

export interface FormatOptions {
  uuidRepresentation: UuidRepresentation;
  dateDisplay: DateDisplay;
}

export const JSON_VIEW_FORMATS: ReadonlyArray<{
  value: JsonViewFormat;
  label: string;
  hint: string;
}> = [
  {
    value: "shell",
    label: "MongoDB Shell Format (JavaScript)",
    hint: 'ObjectId("…"), ISODate("…"), Decimal128("…")',
  },
  {
    value: "canonical",
    label: "MongoDB Extended JSON (v2) Canonical (EJSON)",
    hint: 'Lossless: { "$oid": … }, { "$numberInt": … }',
  },
  {
    value: "relaxed",
    label: "MongoDB Extended JSON (v2) Relaxed (EJSON)",
    hint: 'Plain numbers, { "$oid": … }, { "$date": … }',
  },
  {
    value: "json",
    label: "Plain JSON Text (JSON)",
    hint: "BSON types unwrapped to strings / numbers — view only",
  },
];

/** Formats that render shell literals (not valid JSON) — use the mongo-shell editor language. */
export const isShellFormat = (format: JsonViewFormat): boolean =>
  format === "shell";

/**
 * The format the update editor uses for a given view format. Plain JSON drops
 * type information, so editing falls back to the shell format, which
 * round-trips.
 */
export const editFormatFor = (format: JsonViewFormat): JsonViewFormat =>
  format === "json" ? "shell" : format;

/**
 * Render a document (or any value) as text in the requested format. `value` is
 * expected to hold BSON runtime instances (what `EJSON.parse(relaxed:false)`
 * produces) — the same shape everything else in the app passes around.
 */
export const formatDocument = (
  value: unknown,
  format: JsonViewFormat,
  opts: FormatOptions,
): string => {
  switch (format) {
    case "canonical":
      return stringifyEJSON(value);
    case "relaxed":
      return EJSON.stringify(value as never, undefined, 2, { relaxed: true });
    case "json":
      return JSON.stringify(toPlain(value, opts), null, 2);
    case "shell":
      return renderShell(value, opts);
  }
};

/**
 * Render a list of documents. Shell format separates them SQLBooster-style
 * with `/* n *\/` markers; the JSON formats emit one array so the text stays
 * valid JSON.
 */
export const formatDocumentList = (
  docs: unknown[],
  format: JsonViewFormat,
  opts: FormatOptions,
): string => {
  if (format !== "shell") return formatDocument(docs, format, opts);
  return docs
    .map((d, i) => `/* ${i + 1} */\n${renderShell(d, opts)}`)
    .join("\n\n");
};

/**
 * Parse editor text written in `format` back into BSON runtime values. Throws
 * with a readable message on syntax errors.
 */
export const parseDocument = (
  text: string,
  format: JsonViewFormat,
  opts: FormatOptions,
): unknown => {
  switch (format) {
    case "canonical":
      return parseEJSON(text);
    case "relaxed":
      return EJSON.parse(text, { relaxed: true });
    case "json":
    case "shell":
      return parseShellDocument(text, opts.uuidRepresentation);
  }
};

/**
 * Single-line text for a table cell: scalars as their plain string value
 * (hex ObjectId, ISO date, decimal digits, UUID), sub-documents / arrays as
 * compact plain JSON.
 */
export const formatCellValue = (
  value: unknown,
  opts: FormatOptions,
): string => {
  if (value === null || value === undefined) return "—";
  const plain = toPlain(value, opts);
  if (plain === null || plain === undefined) return "—";
  if (typeof plain !== "object") return String(plain);
  const s = JSON.stringify(plain);
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
};

// ── Dates ─────────────────────────────────────────────────────────────────

const pad = (n: number, len = 2) => String(n).padStart(len, "0");

/** ISO-8601 string in local time with offset, or UTC with `Z`. */
export const formatDate = (d: Date, display: DateDisplay): string => {
  if (Number.isNaN(d.getTime())) return String(d);
  const year = display === "utc" ? d.getUTCFullYear() : d.getFullYear();
  // Outside 0000–9999 the ISO form needs expanded years; let the
  // runtime handle that edge.
  if (display === "utc" || year < 0 || year > 9999) return d.toISOString();
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return (
    `${pad(year, 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `.${pad(d.getMilliseconds(), 3)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
};

const canonicalDate = (value: unknown): Date | null => {
  if (typeof value === "string") return new Date(value);
  if (value && typeof value === "object" && "$numberLong" in value) {
    const ms = Number((value as { $numberLong: string }).$numberLong);
    if (Number.isFinite(ms)) return new Date(ms);
  }
  return null;
};

// ── Canonical-EJSON walk ──────────────────────────────────────────────────
//
// Both renderers serialize to canonical Extended JSON first (plain objects
// with `$oid`, `$date`, … wrappers) so we walk well-documented shapes rather
// than poking at BSON class internals.

const toCanonical = (value: unknown): unknown =>
  EJSON.serialize(value as never, { relaxed: false });

type Wrapper = Record<string, unknown>;

// ── Plain JSON ────────────────────────────────────────────────────────────

const toPlain = (value: unknown, opts: FormatOptions): unknown =>
  plainNode(toCanonical(value), opts);

const plainNode = (node: unknown, opts: FormatOptions): unknown => {
  if (node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map((v) => plainNode(v, opts));
  const obj = node as Wrapper;
  const scalar = plainScalar(obj, opts);
  if (scalar !== undefined) return scalar;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = plainNode(v, opts);
  return out;
};

/** Unwrap a canonical type wrapper; undefined when `obj` isn't one. */
const plainScalar = (obj: Wrapper, opts: FormatOptions): unknown => {
  if ("$oid" in obj) return String(obj.$oid);
  if ("$date" in obj) {
    const d = canonicalDate(obj.$date);
    return d ? formatDate(d, opts.dateDisplay) : String(obj.$date);
  }
  if ("$numberInt" in obj) return Number(obj.$numberInt);
  if ("$numberLong" in obj) {
    const n = Number(obj.$numberLong);
    return Number.isSafeInteger(n) ? n : String(obj.$numberLong);
  }
  if ("$numberDouble" in obj) {
    const n = Number(obj.$numberDouble);
    return Number.isFinite(n) ? n : String(obj.$numberDouble);
  }
  if ("$numberDecimal" in obj) return String(obj.$numberDecimal);
  if ("$binary" in obj) {
    const uuid = formatUuid(obj, opts.uuidRepresentation);
    if (uuid) return uuid;
    return (obj.$binary as { base64: string }).base64;
  }
  if ("$timestamp" in obj) {
    const ts = obj.$timestamp as { t: number; i: number };
    return `Timestamp(${ts.t}, ${ts.i})`;
  }
  if ("$regularExpression" in obj) {
    const r = obj.$regularExpression as { pattern: string; options?: string };
    return `/${r.pattern}/${r.options ?? ""}`;
  }
  if ("$minKey" in obj) return "MinKey()";
  if ("$maxKey" in obj) return "MaxKey()";
  if ("$undefined" in obj) return null;
  if ("$symbol" in obj) return String(obj.$symbol);
  if ("$code" in obj && !("$scope" in obj)) return String(obj.$code);
  return undefined;
};

// ── Shell literal rendering ───────────────────────────────────────────────

const INDENT = "\t";

const renderShell = (value: unknown, opts: FormatOptions): string =>
  renderNode(toCanonical(value), opts, 0);

const renderNode = (node: unknown, opts: FormatOptions, depth: number): string => {
  if (node === null) return "null";
  if (node === undefined) return "undefined";
  const t = typeof node;
  if (t === "number" || t === "boolean") return String(node);
  if (t === "string") return JSON.stringify(node);
  if (Array.isArray(node)) return renderArray(node, opts, depth);
  if (t === "object") {
    const wrapped = renderWrapper(node as Wrapper, opts);
    if (wrapped !== null) return wrapped;
    return renderObject(node as Wrapper, opts, depth);
  }
  return String(node);
};

const renderArray = (arr: unknown[], opts: FormatOptions, depth: number): string => {
  if (arr.length === 0) return "[ ]";
  const pad = INDENT.repeat(depth + 1);
  const close = INDENT.repeat(depth);
  const lines = arr.map((v) => `${pad}${renderNode(v, opts, depth + 1)}`);
  return `[\n${lines.join(",\n")}\n${close}]`;
};

const renderObject = (obj: Wrapper, opts: FormatOptions, depth: number): string => {
  const keys = Object.keys(obj);
  if (keys.length === 0) return "{ }";
  const pad = INDENT.repeat(depth + 1);
  const close = INDENT.repeat(depth);
  const lines = keys.map(
    (k) => `${pad}${JSON.stringify(k)} : ${renderNode(obj[k], opts, depth + 1)}`,
  );
  return `{\n${lines.join(",\n")}\n${close}}`;
};

const legacyUuidMarker = (rep: UuidRepresentation): string | null => {
  switch (rep) {
    case "csharpLegacy":
      return "CSUUID";
    case "javaLegacy":
      return "JUUID";
    case "pythonLegacy":
      return "PYUUID";
    default:
      return null;
  }
};

/**
 * Map a canonical Extended JSON type wrapper to a shell constructor. Returns
 * null when `obj` isn't a recognized `$`-wrapper, so it falls through to plain
 * object rendering (which also covers DBRef `{ $ref, $id }`). Every literal
 * emitted here is understood by `parseShellDocument`, so edits round-trip.
 */
const renderWrapper = (obj: Wrapper, opts: FormatOptions): string | null => {
  const q = (s: unknown) => JSON.stringify(String(s));

  if ("$oid" in obj) return `ObjectId(${q(obj.$oid)})`;

  if ("$date" in obj) {
    const d = canonicalDate(obj.$date);
    return `ISODate(${q(d ? formatDate(d, opts.dateDisplay) : obj.$date)})`;
  }

  if ("$numberInt" in obj) return String(obj.$numberInt);
  if ("$numberLong" in obj) return `NumberLong(${q(obj.$numberLong)})`;
  if ("$numberDouble" in obj) {
    const s = String(obj.$numberDouble);
    if (s === "Infinity" || s === "-Infinity" || s === "NaN") return s;
    // Keep a decimal point on integral doubles so they don't come back as
    // Int32 after an edit.
    return /[.eE]/.test(s) ? s : `${s}.0`;
  }
  if ("$numberDecimal" in obj) return `Decimal128(${q(obj.$numberDecimal)})`;

  if ("$binary" in obj) {
    const bin = obj.$binary as { base64: string; subType: string };
    const sub = parseInt(bin.subType, 16);
    const uuid = formatUuid(obj, opts.uuidRepresentation);
    if (uuid && sub === 4) return `UUID(${q(uuid)})`;
    if (uuid && sub === 3) {
      const marker = legacyUuidMarker(opts.uuidRepresentation);
      if (marker) return `${marker}(${q(uuid)})`;
    }
    return `BinData(${sub}, ${q(bin.base64)})`;
  }

  if ("$timestamp" in obj) {
    const ts = obj.$timestamp as { t: number; i: number };
    return `Timestamp(${ts.t}, ${ts.i})`;
  }

  if ("$regularExpression" in obj) {
    const r = obj.$regularExpression as { pattern: string; options?: string };
    const pattern = r.pattern.replace(/(^|[^\\])\//g, "$1\\/") || "(?:)";
    return `/${pattern}/${r.options ?? ""}`;
  }

  if ("$minKey" in obj) return "MinKey()";
  if ("$maxKey" in obj) return "MaxKey()";
  if ("$undefined" in obj) return "undefined";
  if ("$symbol" in obj) return q(obj.$symbol);
  if ("$code" in obj && !("$scope" in obj)) return `Code(${q(obj.$code)})`;

  return null;
};
