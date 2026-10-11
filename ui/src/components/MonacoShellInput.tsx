import * as monaco from "monaco-editor";
import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
} from "react";
import { api } from "../api/client";
import { useActiveConnection } from "../features/connections/useActiveConnection";
import { useActiveDatabase } from "../features/connections/useActiveDatabase";
import { formatLikeJs } from "./MonacoJsonInput";
import { useSettings } from "../settings";

interface Props {
  value: string;
  onChange: (value: string) => void;
  collections: string[];
  minHeight?: string;
  showLineNumbers?: boolean;
  onSubmit?: () => void;
}

const COLLECTION_METHODS: Array<{ name: string; snippet: string; detail: string }> = [
  { name: "find", snippet: "find(${1:{}})", detail: "Cursor over matching docs" },
  { name: "findOne", snippet: "findOne(${1:{}})", detail: "Single doc or null" },
  {
    name: "aggregate",
    snippet: "aggregate([\n  ${1:{}}\n])",
    detail: "Aggregation pipeline",
  },
  {
    name: "countDocuments",
    snippet: "countDocuments(${1:{}})",
    detail: "Exact count",
  },
  {
    name: "estimatedDocumentCount",
    snippet: "estimatedDocumentCount()",
    detail: "Fast metadata count",
  },
  { name: "distinct", snippet: 'distinct("${1:field}", ${2:{}})', detail: "Distinct values" },
  { name: "indexes", snippet: "indexes()", detail: "List indexes" },
  {
    name: "insertOne",
    snippet: "insertOne(${1:{}})",
    detail: "Insert a document",
  },
  {
    name: "insertMany",
    snippet: "insertMany([\n  ${1:{}}\n])",
    detail: "Bulk insert",
  },
  {
    name: "updateOne",
    snippet: "updateOne(${1:{}}, { $set: ${2:{}} })",
    detail: "Update one doc",
  },
  {
    name: "updateMany",
    snippet: "updateMany(${1:{}}, { $set: ${2:{}} })",
    detail: "Update many docs",
  },
  {
    name: "replaceOne",
    snippet: "replaceOne(${1:{}}, ${2:{}})",
    detail: "Replace one doc",
  },
  {
    name: "deleteOne",
    snippet: "deleteOne(${1:{}})",
    detail: "Delete one doc",
  },
  {
    name: "deleteMany",
    snippet: "deleteMany(${1:{}})",
    detail: "Delete many docs",
  },
  {
    name: "createIndex",
    snippet: "createIndex({ ${1:field}: 1 })",
    detail: "Create an index",
  },
];

const CURSOR_METHODS = ["sort", "skip", "limit", "project"];

const SHELL_FILTER_OPERATORS: Array<{
  label: string;
  detail: string;
  insertText: string;
}> = [
  { label: "$eq", detail: "equals", insertText: "$eq: ${1:value}" },
  { label: "$ne", detail: "not equal", insertText: "$ne: ${1:value}" },
  { label: "$gt", detail: "greater than", insertText: "$gt: ${1:value}" },
  { label: "$gte", detail: "greater or equal", insertText: "$gte: ${1:value}" },
  { label: "$lt", detail: "less than", insertText: "$lt: ${1:value}" },
  { label: "$lte", detail: "less or equal", insertText: "$lte: ${1:value}" },
  { label: "$in", detail: "value in array", insertText: "$in: [${1:values}]" },
  { label: "$nin", detail: "value not in array", insertText: "$nin: [${1:values}]" },
  { label: "$exists", detail: "field exists", insertText: "$exists: ${1:true}" },
  {
    label: "$regex",
    detail: "regex match",
    insertText: '$regex: "${1:pattern}", $options: "${2:i}"',
  },
  { label: "$type", detail: "BSON type", insertText: '$type: "${1:string}"' },
  { label: "$size", detail: "array length", insertText: "$size: ${1:1}" },
  { label: "$elemMatch", detail: "element match", insertText: "$elemMatch: { ${1} }" },
  { label: "$and", detail: "logical AND", insertText: "$and: [${1}]" },
  { label: "$or", detail: "logical OR", insertText: "$or: [${1}]" },
  { label: "$not", detail: "logical NOT", insertText: "$not: { ${1} }" },
];

let collectionsRef: string[] = [];
let schemasRef: Record<string, string[]> = {};
let registered = false;

const findEnclosingDbMethodCall = (
  text: string,
): { collection: string; method: string } | null => {
  let depth = 0;
  let parenIdx = -1;
  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === ")") depth++;
    else if (ch === "(") {
      if (depth === 0) {
        parenIdx = i;
        break;
      }
      depth--;
    }
  }
  if (parenIdx === -1) return null;
  const before = text.slice(0, parenIdx);
  const m = before.match(/\bdb\.([\w$]+)\.([\w$]+)\s*$/);
  if (!m || !m[1] || !m[2]) return null;
  return { collection: m[1], method: m[2] };
};

/**
 * Offline suggestions from a fixed method list plus the sampled schema. Only
 * used when the server's mongosh autocompleter can't answer (console disabled,
 * API unreachable).
 */
const staticCompletions = (
  model: monaco.editor.ITextModel,
  position: monaco.Position,
): monaco.languages.CompletionList => {
  const lineUpToCursor = model
    .getValueInRange({
      startLineNumber: position.lineNumber,
      startColumn: 1,
      endLineNumber: position.lineNumber,
      endColumn: position.column,
    })
    .trimStart();

  const word = model.getWordUntilPosition(position);
  const range: monaco.IRange = {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    endColumn: word.endColumn,
  };

  // db.<col>.<method> — suggest methods on collection
  const dbColDotMatch = lineUpToCursor.match(/\bdb\.([\w$]+)\.([\w$]*)$/);
  if (dbColDotMatch) {
    const partial = dbColDotMatch[2] ?? "";
    const items: monaco.languages.CompletionItem[] = [];
    for (const m of COLLECTION_METHODS) {
      if (partial && !m.name.startsWith(partial)) continue;
      items.push({
        label: m.name,
        kind: monaco.languages.CompletionItemKind.Method,
        insertText: m.snippet,
        insertTextRules:
          monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        detail: m.detail,
        range,
      });
    }
    for (const m of CURSOR_METHODS) {
      if (partial && !m.startsWith(partial)) continue;
      items.push({
        label: m,
        kind: monaco.languages.CompletionItemKind.Method,
        insertText: `${m}(\${1:{}})`,
        insertTextRules:
          monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        detail: "Cursor method",
        range,
      });
    }
    return { suggestions: items };
  }

  // db.<partial> — suggest collection names
  const dbDotMatch = lineUpToCursor.match(/\bdb\.([\w$]*)$/);
  if (dbDotMatch) {
    const partial = dbDotMatch[1] ?? "";
    const items: monaco.languages.CompletionItem[] = collectionsRef
      .filter((c) => !partial || c.startsWith(partial))
      .map((c) => ({
        label: c,
        kind: monaco.languages.CompletionItemKind.Class,
        insertText: c,
        detail: "collection",
        range,
      }));
    return { suggestions: items };
  }

  // Cursor inside db.<col>.<method>(…) — suggest fields from the
  // collection's schema plus filter operators.
  const fullPrefix = model.getValueInRange({
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  });
  const enclosing = findEnclosingDbMethodCall(fullPrefix);
  if (enclosing) {
    const fields = schemasRef[enclosing.collection] ?? [];
    const items: monaco.languages.CompletionItem[] = [];
    for (const f of fields) {
      items.push({
        label: f,
        kind: monaco.languages.CompletionItemKind.Field,
        insertText: f,
        detail: "field",
        range,
      });
    }
    for (const op of SHELL_FILTER_OPERATORS) {
      items.push({
        label: op.label,
        kind: monaco.languages.CompletionItemKind.Function,
        detail: op.detail,
        insertText: op.insertText,
        insertTextRules:
          monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        range,
      });
    }
    if (items.length > 0) return { suggestions: items };
  }

  // Top-level helpers
  const topLevel = [
    { label: "db", insertText: "db" },
    { label: "ObjectId", insertText: 'ObjectId("$1")' },
    { label: "UUID", insertText: 'UUID("$1")' },
    { label: "ISODate", insertText: 'ISODate("$1")' },
    { label: "NumberDecimal", insertText: 'NumberDecimal("$1")' },
  ];
  const items = topLevel
    .filter((t) => !word.word || t.label.startsWith(word.word))
    .map<monaco.languages.CompletionItem>((t) => ({
      label: t.label,
      kind: monaco.languages.CompletionItemKind.Variable,
      insertText: t.insertText,
      insertTextRules: t.insertText.includes("$1")
        ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
        : monaco.languages.CompletionItemInsertTextRule.KeepWhitespace,
      range,
    }));
  return { suggestions: items };
};

// Connection + database each console editor completes against, by model uri.
const contextByUri = new Map<string, { cid: string; database: string | null }>();

// mongosh's autocompleter returns bare strings; pick an icon from where the
// word sits so the list stays scannable.
const kindFor = (
  item: string,
  before: string,
): monaco.languages.CompletionItemKind => {
  const K = monaco.languages.CompletionItemKind;
  if (item.startsWith("$")) return K.Operator;
  if (/^\s*(use|show)\s+$/.test(before.slice(before.lastIndexOf("\n") + 1))) return K.Value;
  if (/\bdb\.$/.test(before) && collectionsRef.includes(item)) return K.Module;
  if (before.endsWith(".")) return K.Method;
  if (/[{,]\s*$/.test(before)) return K.Field;
  return K.Variable;
};

const ensureMongoShellCompletionRegistered = () => {
  if (registered) return;
  registered = true;

  // Monaco's built-in JavaScript features call a TypeScript worker that isn't
  // bundled (see monaco-setup.ts) and fail with "Missing requestHandler".
  // Completions come from mongosh below; keep only the syntax highlighting.
  monaco.typescript.javascriptDefaults.setModeConfiguration({
    completionItems: false,
    hovers: false,
    documentSymbols: false,
    definitions: false,
    references: false,
    documentHighlights: false,
    rename: false,
    diagnostics: false,
    documentRangeFormattingEdits: false,
    signatureHelp: false,
    onTypeFormattingEdits: false,
    codeActions: false,
    inlayHints: false,
  });

  monaco.languages.registerCompletionItemProvider("javascript", {
    triggerCharacters: [".", "$", " "],
    async provideCompletionItems(model, position, context, token) {
      const code = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
      const line = code.slice(code.lastIndexOf("\n") + 1);
      // A space only opens the list for `use <db>` / `show <what>`.
      if (
        context.triggerKind === monaco.languages.CompletionTriggerKind.TriggerCharacter &&
        context.triggerCharacter === " " &&
        !/^\s*(use|show)\s+$/.test(line)
      ) {
        return { suggestions: [] };
      }

      const target = contextByUri.get(model.uri.toString());
      if (!target) return staticCompletions(model, position);

      const controller = new AbortController();
      const sub = token.onCancellationRequested(() => controller.abort());
      try {
        const { replaceLength, items } = await api.completeConsole({
          cid: target.cid,
          database: target.database ?? undefined,
          code,
          signal: controller.signal,
        });
        const range: monaco.IRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: position.column - replaceLength,
          endColumn: position.column,
        };
        const before = code.slice(0, code.length - replaceLength);
        return {
          suggestions: items.map((item, i) => {
            const kind = kindFor(item, before);
            // Keep mongosh's ranking, but list collections before the
            // ~70 database methods after `db.`.
            const group = kind === monaco.languages.CompletionItemKind.Module ? "0" : "1";
            return {
              label: item,
              kind,
              insertText: item,
              sortText: `${group}${String(i).padStart(5, "0")}`,
              range,
            };
          }),
        };
      } catch {
        if (token.isCancellationRequested) return { suggestions: [] };
        return staticCompletions(model, position);
      } finally {
        sub.dispose();
      }
    },
  });
};

export const setMongoShellCollections = (cols: string[]) => {
  collectionsRef = cols;
};

export const setMongoShellSchemas = (
  byCollection: Record<string, string[]>,
) => {
  schemasRef = byCollection;
};

export interface MonacoShellInputHandle {
  format: () => void;
  /** Currently selected text, or "" if the selection is empty. */
  getSelectedText: () => string;
  /** Move keyboard focus into the editor. */
  focus: () => void;
}

export const MonacoShellInput = forwardRef<MonacoShellInputHandle, Props>(
  function MonacoShellInput(
    {
      value,
      onChange,
      collections,
      minHeight = "200px",
      showLineNumbers = true,
      onSubmit,
    },
    ref,
  ) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const onSubmitRef = useRef(onSubmit);
    onSubmitRef.current = onSubmit;
    const { resolvedTheme: theme } = useSettings();
    const { activeId } = useActiveConnection();
    const { database } = useActiveDatabase();
    const idHint = useId();
    const safeId = idHint.replace(/[^a-zA-Z0-9]/g, "-");
    const uri = monaco.Uri.parse(`inmemory://mango-shell/${safeId}.js`);

    // Keep collections list current for the global completion provider.
    setMongoShellCollections(collections);

    useImperativeHandle(
      ref,
      () => ({
        format: () => {
          const editor = editorRef.current;
          if (!editor) return;
          formatShellExpression(editor);
        },
        getSelectedText: () => {
          const editor = editorRef.current;
          if (!editor) return "";
          const sel = editor.getSelection();
          const model = editor.getModel();
          if (!sel || !model || sel.isEmpty()) return "";
          return model.getValueInRange(sel);
        },
        focus: () => editorRef.current?.focus(),
      }),
      [],
    );

    useEffect(() => {
      if (!hostRef.current) return;
      ensureMongoShellCompletionRegistered();

      const existing = monaco.editor.getModel(uri);
      const model =
        existing ?? monaco.editor.createModel(value, "javascript", uri);
      if (existing && existing.getValue() !== value) {
        existing.setValue(value);
      }

      const editor = monaco.editor.create(hostRef.current, {
        model,
        theme: theme === "dark" ? "vs-dark" : "vs",
        lineNumbers: showLineNumbers ? "on" : "off",
        minimap: { enabled: false },
        automaticLayout: true,
        scrollBeyondLastLine: false,
        tabSize: 2,
        wordWrap: "on",
        fontSize: 13,
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        formatOnPaste: true,
      });
      editorRef.current = editor;

      const sub = model.onDidChangeContent(() => {
        onChangeRef.current(model.getValue());
      });

      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
        () => onSubmitRef.current?.(),
      );

      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF,
        () => formatShellExpression(editor),
      );
      editor.addCommand(
        monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF,
        () => formatShellExpression(editor),
      );

      return () => {
        sub.dispose();
        editor.dispose();
        // Don't dispose the model — Monaco may reuse it for the same uri.
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Completions run against the active connection + database.
    useEffect(() => {
      const key = uri.toString();
      if (activeId) contextByUri.set(key, { cid: activeId, database });
      else contextByUri.delete(key);
      return () => {
        contextByUri.delete(key);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeId, database, safeId]);

    // Theme + value sync.
    useEffect(() => {
      monaco.editor.setTheme(theme === "dark" ? "vs-dark" : "vs");
    }, [theme]);

    useEffect(() => {
      const editor = editorRef.current;
      if (!editor) return;
      if (editor.getValue() !== value) editor.setValue(value);
    }, [value]);

    return <div ref={hostRef} style={{ minHeight, height: "100%" }} />;
  },
);

/**
 * Pretty-print a mongo-shell expression. Uses the same JS-aware tokenizing
 * formatter as the JSON editor, so it handles unquoted keys, helpers like
 * `ObjectId("…")`, regex literals, and template strings without choking the
 * way `JSON.parse` does.
 */
const formatShellExpression = (
  editor: monaco.editor.IStandaloneCodeEditor,
) => {
  const model = editor.getModel();
  if (!model) return;
  const text = model.getValue();
  const formatted = formatLikeJs(text);
  if (formatted === null || formatted === text) return;
  editor.executeEdits("format-shell", [
    {
      range: model.getFullModelRange(),
      text: formatted,
      forceMoveMarkers: true,
    },
  ]);
};
