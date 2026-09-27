import * as monaco from "monaco-editor";
// Monaco 0.57 moved the JSON language service to a top-level `json` export
// (`monaco.languages.json` is deprecated).
const { jsonDefaults } = monaco.json;

export interface MongoCompletionConfig {
  fields?: string[];
  fieldTypes?: Record<string, string[]>;
  commandKeywords?: boolean;
}

interface OperatorSpec {
  label: string;
  detail: string;
  insertText: string;
  documentation?: string;
}

const FILTER_OPERATORS: OperatorSpec[] = [
  {
    label: "$eq",
    detail: "equals",
    insertText: '"$eq": ${1:value}',
    documentation: "Matches values that are equal to a specified value.",
  },
  { label: "$ne", detail: "not equal", insertText: '"$ne": ${1:value}' },
  { label: "$gt", detail: "greater than", insertText: '"$gt": ${1:value}' },
  { label: "$gte", detail: "greater than or equal", insertText: '"$gte": ${1:value}' },
  { label: "$lt", detail: "less than", insertText: '"$lt": ${1:value}' },
  { label: "$lte", detail: "less than or equal", insertText: '"$lte": ${1:value}' },
  { label: "$in", detail: "value in array", insertText: '"$in": [${1:values}]' },
  { label: "$nin", detail: "value not in array", insertText: '"$nin": [${1:values}]' },
  { label: "$exists", detail: "field exists", insertText: '"$exists": ${1:true}' },
  {
    label: "$regex",
    detail: "regex match",
    insertText: '"$regex": "${1:pattern}", "$options": "${2:i}"',
  },
  { label: "$type", detail: "BSON type match", insertText: '"$type": "${1:string}"' },
  { label: "$size", detail: "array length", insertText: '"$size": ${1:1}' },
  {
    label: "$elemMatch",
    detail: "match element in array",
    insertText: '"$elemMatch": { ${1} }',
  },
  { label: "$and", detail: "logical AND", insertText: '"$and": [${1}]' },
  { label: "$or", detail: "logical OR", insertText: '"$or": [${1}]' },
  { label: "$not", detail: "logical NOT", insertText: '"$not": { ${1} }' },
];

const COMMAND_SNIPPETS: OperatorSpec[] = [
  { label: "ping", detail: "ping the server", insertText: '"ping": 1' },
  { label: "buildInfo", detail: "server build info", insertText: '"buildInfo": 1' },
  { label: "dbStats", detail: "database statistics", insertText: '"dbStats": 1' },
  { label: "serverStatus", detail: "server status", insertText: '"serverStatus": 1' },
  {
    label: "listCollections",
    detail: "list all collections",
    insertText: '"listCollections": 1',
  },
  {
    label: "listIndexes",
    detail: "list indexes for a collection",
    insertText: '"listIndexes": "${1:collection}"',
  },
  {
    label: "collStats",
    detail: "collection statistics",
    insertText: '"collStats": "${1:collection}"',
  },
  {
    label: "count",
    detail: "count documents",
    insertText: '"count": "${1:collection}", "query": { ${2} }',
  },
  {
    label: "distinct",
    detail: "distinct values for a field",
    insertText:
      '"distinct": "${1:collection}", "key": "${2:field}", "query": { ${3} }',
  },
  {
    label: "find",
    detail: "find documents",
    insertText:
      '"find": "${1:collection}",\n  "filter": { ${2} },\n  "limit": ${3:50}',
  },
  {
    label: "aggregate",
    detail: "aggregation pipeline",
    insertText:
      '"aggregate": "${1:collection}",\n  "pipeline": [\n    { "$match": { ${2} } }\n  ],\n  "cursor": {}',
  },
];

const PIPELINE_STAGES: OperatorSpec[] = [
  { label: "$match", detail: "filter stage", insertText: '"$match": { ${1} }' },
  {
    label: "$group",
    detail: "group stage",
    insertText: '"$group": { "_id": ${1:null}, ${2} }',
  },
  { label: "$sort", detail: "sort stage", insertText: '"$sort": { ${1} }' },
  {
    label: "$project",
    detail: "project stage",
    insertText: '"$project": { ${1} }',
  },
  { label: "$limit", detail: "limit stage", insertText: '"$limit": ${1:10}' },
  { label: "$skip", detail: "skip stage", insertText: '"$skip": ${1:0}' },
  {
    label: "$sample",
    detail: "random sample",
    insertText: '"$sample": { "size": ${1:10} }',
  },
  {
    label: "$lookup",
    detail: "join stage",
    insertText:
      '"$lookup": {\n    "from": "${1:other}",\n    "localField": "${2}",\n    "foreignField": "${3}",\n    "as": "${4}"\n  }',
  },
  {
    label: "$unwind",
    detail: "unwind array",
    insertText: '"$unwind": "$${1:field}"',
  },
  { label: "$count", detail: "count documents", insertText: '"$count": "count"' },
  {
    label: "$addFields",
    detail: "add computed fields",
    insertText: '"$addFields": { ${1} }',
  },
];

let registered = false;
// BSON type constructors understood by features/documents/shellParse.ts.
const SHELL_CONSTRUCTORS: OperatorSpec[] = [
  { label: "ObjectId", detail: "ObjectId", insertText: 'ObjectId("${1}")' },
  { label: "ISODate", detail: "Date", insertText: 'ISODate("${1}")' },
  { label: "NumberInt", detail: "Int32", insertText: "NumberInt(${1})" },
  { label: "NumberLong", detail: "Int64", insertText: 'NumberLong("${1}")' },
  { label: "Decimal128", detail: "Decimal128", insertText: 'Decimal128("${1}")' },
  { label: "UUID", detail: "Binary subtype 4", insertText: 'UUID("${1}")' },
  { label: "BinData", detail: "Binary", insertText: 'BinData(${1:0}, "${2}")' },
  { label: "Timestamp", detail: "Timestamp", insertText: "Timestamp(${1:0}, ${2:0})" },
];

const configByUri = new Map<string, MongoCompletionConfig>();

export const setModelMongoConfig = (
  uri: monaco.Uri,
  config: MongoCompletionConfig,
) => {
  configByUri.set(uri.toString(), config);
};

export const clearModelMongoConfig = (uri: monaco.Uri) => {
  configByUri.delete(uri.toString());
};

/**
 * Language id for documents in mongo-shell literal syntax (`ObjectId("…")`,
 * `ISODate("…")`). Highlighting only — Monaco's built-in "javascript" mode
 * would pull in the TypeScript worker (not bundled, see monaco-setup.ts) and
 * flag a bare `{ … }` document as a syntax error.
 */
export const MONGO_SHELL_LANGUAGE = "mongo-shell";

const registerMongoShellLanguage = () => {
  monaco.languages.register({ id: MONGO_SHELL_LANGUAGE });
  monaco.languages.setLanguageConfiguration(MONGO_SHELL_LANGUAGE, {
    comments: { lineComment: "//", blockComment: ["/*", "*/"] },
    brackets: [
      ["{", "}"],
      ["[", "]"],
      ["(", ")"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"', notIn: ["string"] },
      { open: "'", close: "'", notIn: ["string"] },
    ],
  });
  monaco.languages.setMonarchTokensProvider(MONGO_SHELL_LANGUAGE, {
    tokenizer: {
      root: [
        [/\/\/.*$/, "comment"],
        [/\/\*/, "comment", "@comment"],
        [/"(?:[^"\\]|\\.)*"(?=\s*:)/, "string.key.json"],
        [/'(?:[^'\\]|\\.)*'(?=\s*:)/, "string.key.json"],
        [/"(?:[^"\\]|\\.)*"/, "string"],
        [/'(?:[^'\\]|\\.)*'/, "string"],
        [/\b(?:true|false|null|undefined|new)\b/, "keyword"],
        [/[A-Za-z_$][\w$]*(?=\s*\()/, "type.identifier"],
        [/[A-Za-z_$][\w$]*(?=\s*:)/, "string.key.json"],
        [/-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|-?Infinity\b|NaN\b/, "number"],
        [/\/(?:[^/\\\n]|\\.)+\/[a-z]*/, "regexp"],
        [/[{}()[\]]/, "@brackets"],
        [/[,:.]/, "delimiter"],
      ],
      comment: [
        [/[^*]+/, "comment"],
        [/\*\//, "comment", "@pop"],
        [/\*/, "comment"],
      ],
    },
  });
};

export const ensureMongoCompletionRegistered = () => {
  if (registered) return;
  registered = true;

  registerMongoShellLanguage();

  jsonDefaults.setDiagnosticsOptions({
    validate: true,
    allowComments: false,
    schemas: [],
    enableSchemaRequest: false,
  });

  const provider: monaco.languages.CompletionItemProvider = {
    triggerCharacters: ['"', "$", " ", ":"],
    provideCompletionItems: (model, position) => {
      const cfg = configByUri.get(model.uri.toString()) ?? {};
      const word = model.getWordUntilPosition(position);
      const range: monaco.IRange = {
        startLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endLineNumber: position.lineNumber,
        endColumn: word.endColumn,
      };

      const suggestions: monaco.languages.CompletionItem[] = [];

      for (const f of cfg.fields ?? []) {
        const types = cfg.fieldTypes?.[f]?.join(" | ");
        suggestions.push({
          label: f,
          kind: monaco.languages.CompletionItemKind.Field,
          detail: types ?? "field",
          insertText: f,
          range,
        });
      }

      for (const op of FILTER_OPERATORS) {
        suggestions.push({
          label: op.label,
          kind: monaco.languages.CompletionItemKind.Function,
          detail: op.detail,
          documentation: op.documentation,
          insertText: op.insertText,
          insertTextRules:
            monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
        });
      }

      for (const stage of PIPELINE_STAGES) {
        suggestions.push({
          label: stage.label,
          kind: monaco.languages.CompletionItemKind.Method,
          detail: stage.detail,
          insertText: stage.insertText,
          insertTextRules:
            monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
        });
      }

      if (cfg.commandKeywords) {
        for (const cmd of COMMAND_SNIPPETS) {
          suggestions.push({
            label: cmd.label,
            kind: monaco.languages.CompletionItemKind.Keyword,
            detail: cmd.detail,
            insertText: cmd.insertText,
            insertTextRules:
              monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
          });
        }
      }

      if (model.getLanguageId() === MONGO_SHELL_LANGUAGE) {
        for (const ctor of SHELL_CONSTRUCTORS) {
          suggestions.push({
            label: ctor.label,
            kind: monaco.languages.CompletionItemKind.Constructor,
            detail: ctor.detail,
            insertText: ctor.insertText,
            insertTextRules:
              monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
          });
        }
      }

      return { suggestions };
    },
  };

  monaco.languages.registerCompletionItemProvider("json", provider);
  monaco.languages.registerCompletionItemProvider(MONGO_SHELL_LANGUAGE, provider);
};
