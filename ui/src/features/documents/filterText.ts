import { EJSON, ObjectId } from "bson";
import { formatLikeJs } from "../../components/MonacoJsonInput";
import { stringifyEJSON, type UuidRepresentation } from "../../api/client";
import { formatDocument, type FormatOptions } from "./docFormats";
import { parseShellDocument } from "./shellParse";

/**
 * Filter text as typed in the Raw editor, the Builder, or an assistant
 * "Apply filter". Accepts any mix of plain JSON, Extended JSON wrappers
 * (`{"$oid": "…"}`) and shell literals (`ObjectId("…")`, `UUID("…")`,
 * `ISODate("…")`, bare keys) — the shell parser is a superset of JSON.
 */

const parseObject = (text: string, rep: UuidRepresentation): Record<string, unknown> => {
  const value = parseShellDocument(text, rep);
  if (!value || typeof value !== "object" || Array.isArray(value) || isBsonValue(value)) {
    throw new Error('Filter must be an object, e.g. { status: "active" }.');
  }
  return value as Record<string, unknown>;
};

/**
 * Convert filter text to the canonical EJSON the server speaks. Empty text →
 * `""` (no filter). Throws `ShellParseError` with line/column on bad syntax.
 */
export const filterTextToEJSON = (text: string, rep: UuidRepresentation): string => {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return stringifyEJSON(parseObject(trimmed, rep), false);
};

/**
 * Parse filter text into a plain object holding BSON values. Round-tripping
 * through EJSON turns JSON-spelled wrappers (`{"$oid": …}`) into real
 * `ObjectId`s and shell numbers (`Int32`/`Double`) into JS numbers, so callers
 * see one shape no matter how the filter was written.
 */
export const parseFilterText = (
  text: string,
  rep: UuidRepresentation,
): Record<string, unknown> => {
  const trimmed = text.trim();
  if (!trimmed) return {};
  const raw = parseObject(trimmed, rep);
  return EJSON.deserialize(EJSON.serialize(raw, { relaxed: false }), {
    relaxed: true,
  }) as Record<string, unknown>;
};

/** A BSON runtime value (ObjectId, Binary, Decimal128, BSONRegExp, …) or a Date. */
export const isBsonValue = (value: unknown): boolean =>
  value instanceof Date ||
  (value !== null && typeof value === "object" && "_bsontype" in value);

/** One value as shell literal text: `"a"`, `5`, `ObjectId("…")`, `UUID("…")`. */
export const formatShellValue = (value: unknown, opts: FormatOptions): string => {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => formatShellValue(v, opts)).join(", ")}]`;
  }
  if (isBsonValue(value)) return formatDocument(value, "shell", opts);
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    const inner = entries
      .map(([k, v]) => `${JSON.stringify(k)}: ${formatShellValue(v, opts)}`)
      .join(", ");
    return `{ ${inner} }`;
  }
  return String(value);
};

/**
 * Render a filter object as shell-literal text for the Raw editor, wrapped
 * past 80 columns. Empty filter → `""`.
 */
export const stringifyFilter = (
  filter: Record<string, unknown>,
  opts: FormatOptions,
): string => {
  if (Object.keys(filter).length === 0) return "";
  const text = formatShellValue(filter, opts);
  return formatLikeJs(text) ?? text;
};

const HEX24 = /^[0-9a-f]{24}$/i;
const UUID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const CONSTRUCTOR_CALL = /^(?:new\s+)?[A-Za-z_$][\w$.]*\s*\([\s\S]*\)$/;

/**
 * Turn what a user typed into one Builder value slot into a BSON value:
 *
 *  - explicit literals — `ObjectId("…")`, `UUID("…")`, `ISODate("…")`,
 *    `NumberLong("…")`, `Decimal128("…")` — via the shell parser;
 *  - bare text, typed by the sampled field types: a 24-hex string on an
 *    `objectId` field (or `_id` unless sampled as string) becomes an
 *    ObjectId, a UUID string on a `uuid`/`binary` field a UUID, an ISO date
 *    on a `date` field a Date — so `_id equals 6acb7ef0…` just matches;
 *  - `true` / `false` / `null` / numbers as before, otherwise a string.
 */
export const coerceBuilderValue = (
  raw: string,
  field: string,
  fieldTypes: readonly string[] | undefined,
  rep: UuidRepresentation,
): unknown => {
  const v = raw.trim();
  if (v === "") return "";
  if (CONSTRUCTOR_CALL.test(v)) {
    try {
      return parseShellDocument(v, rep);
    } catch {
      return v;
    }
  }
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(v)) return Number(v);

  const types = fieldTypes ?? [];
  const isIdLike =
    types.includes("objectId") || (field === "_id" && !types.includes("string"));
  if (isIdLike && HEX24.test(v)) return new ObjectId(v);
  if ((types.includes("uuid") || types.includes("binary")) && UUID_RE.test(v)) {
    // Legacy representations store subtype 3 with a driver-specific byte
    // order; LUUID honors the configured one.
    const ctor = rep.endsWith("Legacy") ? "LUUID" : "UUID";
    return parseShellDocument(`${ctor}(${JSON.stringify(v)})`, rep);
  }
  if (types.includes("date") && ISO_DATE.test(v)) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return v;
};
