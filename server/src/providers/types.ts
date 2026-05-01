export interface AiQueryInput {
  collection: string;
  prompt: string;
  schemaText: string;
  model?: string;
}

export interface AiQueryResult {
  filter: Record<string, unknown>;
  explanation: string;
  model: string;
}

export interface ModelOption {
  id: string;
  name?: string;
  description?: string;
  vendor?: string;
}

export type AiProviderName = "openai" | "copilot";

export interface AiProvider {
  name: AiProviderName;
  configured: boolean;
  model: string;
  baseUrl?: string;
  setupHint: string;
  query(input: AiQueryInput): Promise<AiQueryResult>;
  listModels(): Promise<ModelOption[]>;
}

export const buildSystemPrompt = (
  collection: string,
  schemaText: string,
): string =>
  `You are a MongoDB query assistant. Convert a user's natural-language description into a MongoDB filter document for the find() operation on the collection "${collection}".

You have a sampled view of the collection's shape:

${schemaText}

Rules:
- Output a valid JSON object matching MongoDB's filter syntax.
- Use only fields that appear in the schema above (or _id).
- Use the operators: $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $exists, $regex, $type, $size, $elemMatch, $and, $or, $not.
- For dates use Extended JSON: {"$date": "YYYY-MM-DDThh:mm:ssZ"}.
- For ObjectIds use Extended JSON: {"$oid": "..."}.
- For UUIDs use Extended JSON: {"$binary": {"base64": "...", "subType": "04"}}.
- Prefer case-insensitive regex for free-text searches: {"$regex": "...", "$options": "i"}.
- An empty filter ({}) means "match everything"; only emit that if the user clearly asked for all documents.
- Return the simplest filter that captures the user's intent.

You MUST call the propose_filter tool with the proposed filter and a one-sentence explanation. Do not reply in plain text.`;
