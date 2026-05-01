import { EJSON } from "bson";

export const toEJSON = (value: unknown): unknown =>
  EJSON.parse(EJSON.stringify(value, { relaxed: false }), { relaxed: false });

export const stringifyEJSON = (value: unknown): string =>
  EJSON.stringify(value, { relaxed: false });

export const parseEJSON = (text: string): unknown =>
  EJSON.parse(text, { relaxed: false });

export class FilterParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FilterParseError";
  }
}

export const parseFilter = (text: string | undefined | null): Record<string, unknown> => {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return {};
  let parsed: unknown;
  try {
    parsed = EJSON.parse(trimmed, { relaxed: true });
  } catch (e) {
    throw new FilterParseError(
      `Invalid filter JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new FilterParseError("Filter must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
};
