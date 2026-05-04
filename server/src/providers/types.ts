export interface ModelOption {
  id: string;
  name?: string;
  description?: string;
  vendor?: string;
}

export type AiProviderName = "openai" | "copilot" | "claude-code";

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface AiChatInput {
  systemPrompt: string;
  messages: ChatMessage[];
  model?: string;
}

export interface AiChatResult {
  text: string;
  model: string;
}

export interface AiProvider {
  name: AiProviderName;
  configured: boolean;
  model: string;
  baseUrl?: string;
  setupHint: string;
  validate?(): Promise<Record<string, string | number | boolean | null>>;
  chat(input: AiChatInput): Promise<AiChatResult>;
  listModels(): Promise<ModelOption[]>;
}

export type AssistantMode =
  | "collection"
  | "console"
  | "shell"
  | "general"
  | "indexes";

export const buildChatSystemPrompt = (params: {
  mode: AssistantMode;
  databaseName: string | null;
  collection: string | null;
  schemaText: string;
  /** Optional: rendered index list — only used in indexes mode. */
  indexesText?: string | null;
  /** Optional: rendered explain output — only used in indexes mode. */
  explainText?: string | null;
}): string => {
  const { mode, databaseName, collection, schemaText, indexesText, explainText } =
    params;

  const apply = `When the user asks for something actionable, include the artifact in a fenced code block tagged with one of these languages so the UI can offer an "Apply" button:

- \`\`\`mango-filter — a JSON MongoDB filter document for find() (used in collection view)
- \`\`\`mango-projection — a JSON projection (used in collection view)
- \`\`\`mango-sort — a JSON sort spec
- \`\`\`mango-pipeline — a JSON aggregation pipeline (array of stages)
- \`\`\`mango-shell — a JSON document for db.runCommand (used in shell view)
- \`\`\`mango-console — a single JavaScript expression like db.users.find({…}) (used in console view)

Use Extended JSON for special types: \`{"$oid":"…"}\`, \`{"$date":"…"}\`, \`{"$binary":{"base64":"…","subType":"04"}}\`. Prefer case-insensitive regex \`{"$regex":"…","$options":"i"}\` for free-text searches. Output one artifact per response unless the user clearly asks for several.`;

  const writeStyle = `
Write like an IDE assistant: be concise, use markdown with headings, lists, and short code spans. Explain *why* the artifact looks the way it does in 1-2 sentences. Reference fields that actually exist in the schema; if the user asks about a field that doesn't appear, say so and propose the closest match.`;

  const ctxLine = databaseName
    ? `The active database is \`${databaseName}\`.${collection ? ` The active collection is \`${collection}\`.` : ""}`
    : "No database is currently selected.";

  if (mode === "collection") {
    return `You are Mango's AI assistant — a conversational copilot for working with MongoDB. ${ctxLine}

You have a sampled schema of the current collection:

${schemaText || "(no schema available)"}

${apply}
${writeStyle}`;
  }

  if (mode === "console") {
    return `You are Mango's AI assistant. The user is in the JavaScript console for MongoDB. ${ctxLine}

Schema of the current database:

${schemaText || "(no schema available)"}

${apply}

When suggesting console commands, prefer \`mango-console\` blocks that contain a single expression of the form \`db.<collection>.<method>(args)\`. Available collection methods: find, findOne, aggregate, countDocuments, estimatedDocumentCount, distinct, indexes, listIndexes, insertOne, insertMany, updateOne, updateMany, replaceOne, deleteOne, deleteMany. You may chain .sort(), .skip(), .limit(). Helpers: ObjectId("…"), UUID("…"), ISODate("…"), NumberDecimal("…"). Be conservative with destructive operations.
${writeStyle}`;
  }

  if (mode === "indexes") {
    return `You are Mango's index-optimization assistant. ${ctxLine}

Schema of the current collection:

${schemaText || "(no schema available)"}

Existing indexes:

${indexesText || "(no indexes loaded)"}

${explainText ? `Most recent explain() output the user is investigating:\n\n${explainText}\n` : ""}

Help the user reason about index strategy: identify collection scans (COLLSCAN), redundant indexes, missing covering indexes, ESR-rule violations (Equality, Sort, Range), and over-indexing. Reference docsExamined / nReturned ratios and totalKeysExamined when relevant.

When suggesting an index, emit it as a fenced \`\`\`mango-shell block containing a \`createIndex\` runCommand or \`mango-console\` block with \`db.${collection ?? "<collection>"}.createIndex({…})\`. When proposing a query rewrite, emit a \`\`\`mango-filter or \`\`\`mango-pipeline block. Be concise and call out tradeoffs (write amplification, build time, RAM cost) in 1-2 sentences.
${writeStyle}`;
  }

  if (mode === "shell") {
    return `You are Mango's AI assistant. The user is in the raw shell view, which sends \`db.runCommand\` documents. ${ctxLine}

${schemaText ? `Schema of the current database:\n\n${schemaText}\n` : ""}

${apply}

When suggesting commands, prefer \`mango-shell\` blocks containing a single JSON document suitable for \`db.runCommand\` (e.g. \`{"ping":1}\`, \`{"collStats":"users"}\`, \`{"aggregate":"users","pipeline":[…],"cursor":{}}\`).
${writeStyle}`;
  }

  return `You are Mango's AI assistant — a conversational copilot for working with MongoDB. ${ctxLine}

${schemaText ? `Schema overview:\n\n${schemaText}\n` : ""}

${apply}
${writeStyle}`;
};

