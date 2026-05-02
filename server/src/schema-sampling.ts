import { Binary, Decimal128, ObjectId, UUID } from "bson";
import type { Db } from "mongodb";

export interface FieldInfo {
  path: string;
  types: string[];
  examples: unknown[];
  distinctValues?: unknown[];
}

const detectType = (value: unknown): string => {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "array";
  if (value instanceof Date) return "date";
  if (value instanceof UUID) return "uuid";
  if (value instanceof ObjectId) return "objectId";
  if (value instanceof Decimal128) return "decimal";
  if (value instanceof Binary) return "binary";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "object") return "object";
  return typeof value;
};

const truncatedExample = (value: unknown): unknown => {
  if (typeof value === "string" && value.length > 60) {
    return `${value.slice(0, 57)}…`;
  }
  if (value instanceof UUID) return value.toString();
  if (value instanceof ObjectId) return value.toHexString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value && typeof value === "object") {
    const ctor = (value as { constructor?: { name?: string } }).constructor?.name;
    return `[${ctor ?? "object"}]`;
  }
  return value;
};

export const sampleCollectionSchema = async (
  db: Db,
  name: string,
  size = 50,
  opts: { maxTimeMS?: number } = {},
): Promise<{ docs: number; fields: FieldInfo[] }> => {
  const docs = await db
    .collection(name)
    .aggregate([{ $sample: { size } }], { maxTimeMS: opts.maxTimeMS })
    .toArray();
  const fieldMap = new Map<string, FieldInfo>();
  for (const doc of docs) {
    for (const [key, value] of Object.entries(doc)) {
      const existing = fieldMap.get(key) ?? {
        path: key,
        types: [],
        examples: [],
      };
      const t = detectType(value);
      if (!existing.types.includes(t)) existing.types.push(t);
      if (existing.examples.length < 3) {
        existing.examples.push(truncatedExample(value));
      }
      fieldMap.set(key, existing);
    }
  }
  const fields = Array.from(fieldMap.values()).sort((a, b) =>
    a.path.localeCompare(b.path),
  );
  return { docs: docs.length, fields };
};

export const renderSchemaForPrompt = (fields: FieldInfo[]): string => {
  return fields
    .map((f) => {
      const types = f.types.join(" | ");
      const examples = f.examples
        .map((e) => JSON.stringify(e))
        .filter((e) => e && e.length < 80)
        .slice(0, 2)
        .join(", ");
      const distinct = f.distinctValues
        ?.map((v) => JSON.stringify(v))
        .filter((v) => v && v.length < 80)
        .join(", ");
      const examplePart = examples ? `   e.g. ${examples}` : "";
      const distinctPart = distinct ? `   values: [${distinct}]` : "";
      return `- ${f.path}: ${types}${examplePart}${distinctPart}`;
    })
    .join("\n");
};

/**
 * Sample every collection in the database and render a compact, multi-
 * collection schema for use in AI prompts. Bounded by maxCollections and
 * docsPerCollection so the prompt stays manageable.
 */
export const sampleDatabaseSchema = async (
  db: Db,
  opts: { maxCollections?: number; docsPerCollection?: number; maxTimeMS?: number } = {},
): Promise<string> => {
  const maxCollections = opts.maxCollections ?? 25;
  const docsPerCollection = opts.docsPerCollection ?? 10;
  const cols = await db
    .listCollections({}, { nameOnly: true })
    .toArray();
  const names = cols
    .map((c) => c.name)
    .filter((n) => !n.startsWith("system."))
    .slice(0, maxCollections);

  const sections = await Promise.all(
    names.map(async (name) => {
      try {
        const schema = await sampleCollectionSchema(db, name, docsPerCollection, {
          maxTimeMS: opts.maxTimeMS,
        });
        const fieldsLines = schema.fields
          .slice(0, 20)
          .map((f) => `    - ${f.path}: ${f.types.join(" | ")}`)
          .join("\n");
        return `Collection "${name}":\n${fieldsLines}`;
      } catch (e) {
        return `Collection "${name}": (could not sample — ${
          e instanceof Error ? e.message : String(e)
        })`;
      }
    }),
  );
  return sections.join("\n\n");
};

/**
 * For low-cardinality string/boolean fields, fetch the full set of distinct
 * values and stash them on the schema. Bounded so we never run more than a
 * handful of queries or wait too long.
 */
export const enrichWithDistinctValues = async (
  db: Db,
  collection: string,
  fields: FieldInfo[],
  opts: {
    maxFields?: number;
    maxValues?: number;
    maxTimeMS?: number;
  } = {},
): Promise<void> => {
  const maxFields = opts.maxFields ?? 8;
  const maxValues = opts.maxValues ?? 25;
  const maxTimeMS = opts.maxTimeMS ?? 1500;

  const candidates = fields
    .filter((f) => f.path !== "_id")
    .filter((f) => {
      if (f.types.length !== 1) return false;
      const t = f.types[0];
      return t === "string" || t === "boolean";
    })
    .slice(0, maxFields);

  await Promise.all(
    candidates.map(async (f) => {
      try {
        const values = await db
          .collection(collection)
          .distinct(f.path, {}, { maxTimeMS });
        if (values.length === 0 || values.length > maxValues) return;
        f.distinctValues = values
          .map((v) => truncatedExample(v))
          .slice(0, maxValues);
      } catch {
        /* ignore — distinct can fail on indexed/sharded paths */
      }
    }),
  );
};
