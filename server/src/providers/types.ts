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

export interface AiCommandInput {
  prompt: string;
  schemaText: string;
  model?: string;
}

export interface AiCommandResult {
  command: string;
  explanation: string;
  model: string;
}

export interface ModelOption {
  id: string;
  name?: string;
  description?: string;
  vendor?: string;
}

export type AiProviderName = "openai" | "copilot" | "claude-code";

export interface AiProvider {
  name: AiProviderName;
  configured: boolean;
  model: string;
  baseUrl?: string;
  setupHint: string;
  query(input: AiQueryInput): Promise<AiQueryResult>;
  generateCommand(input: AiCommandInput): Promise<AiCommandResult>;
  listModels(): Promise<ModelOption[]>;
}

export const buildCommandSystemPrompt = (schemaText: string): string =>
  `You are a MongoDB shell assistant. Convert a user's natural-language request into a single JavaScript expression using the mongo shell API.

You have a schema of every collection in the active database:

${schemaText}

Rules:
- Output a single JavaScript expression of the form db.<collection>.<method>(args).
- Available collection methods: find, findOne, aggregate, countDocuments, estimatedDocumentCount, distinct, indexes, listIndexes, insertOne, insertMany, updateOne, updateMany, replaceOne, deleteOne, deleteMany.
- For find/aggregate, you MAY chain .sort(), .skip(), .limit(). Do NOT call .toArray() — the harness handles cursors automatically.
- Use these helpers only: ObjectId("..."), UUID("..."), ISODate("YYYY-MM-DDTHH:mm:ssZ"), NumberDecimal("...").
- Reference only collections that appear in the schema above.
- Prefer case-insensitive regex for free-text searches: /pattern/i
- Be conservative with destructive operations: prefer updateOne/deleteOne over updateMany/deleteMany unless the user clearly asked for many.

You MUST call the propose_command tool with the command and a one-sentence explanation. Do not reply in plain text.`;

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
