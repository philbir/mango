import { Binary, Decimal128, ObjectId, UUID } from "bson";
import type { Db } from "mongodb";

export interface FieldInfo {
  path: string;
  types: string[];
  examples: unknown[];
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
): Promise<{ docs: number; fields: FieldInfo[] }> => {
  const docs = await db.collection(name).aggregate([{ $sample: { size } }]).toArray();
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
      return `- ${f.path}: ${types}${examples ? `   e.g. ${examples}` : ""}`;
    })
    .join("\n");
};
