import * as monaco from "monaco-editor";
import { forwardRef, useEffect, useId, useImperativeHandle, useRef } from "react";
import {
  type MongoCompletionConfig,
  clearModelMongoConfig,
  ensureMongoCompletionRegistered,
  setModelMongoConfig,
} from "../monaco-mongo";
import { useSettings } from "../settings";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: string;
  showLineNumbers?: boolean;
  wordWrap?: boolean;
  readOnly?: boolean;
  completion?: MongoCompletionConfig;
  onSubmit?: () => void;
  /**
   * Editor language. Defaults to `"json"`. Use `"javascript"` for read-only
   * shell-literal views (e.g. `ObjectId("…")`) so the built-in JSON validator
   * doesn't flag them as invalid. Only the JSON language worker is bundled
   * (see monaco-setup.ts), so `"javascript"` gives monarch highlighting with no
   * diagnostics. The language is fixed at mount — change the component `key` to
   * switch it.
   */
  language?: "json" | "javascript";
}

export interface MonacoJsonInputHandle {
  format: () => void;
}

export const MonacoJsonInput = forwardRef<MonacoJsonInputHandle, Props>(
  function MonacoJsonInput(
    {
      value,
      onChange,
      minHeight = "44px",
      showLineNumbers = false,
      wordWrap = true,
      readOnly = false,
      completion,
      onSubmit,
      language = "json",
    },
    ref,
  ) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const onSubmitRef = useRef(onSubmit);
    onSubmitRef.current = onSubmit;
    const { theme } = useSettings();
    const idHint = useId();

    useImperativeHandle(
      ref,
      () => ({
        format: () => {
          const editor = editorRef.current;
          if (!editor) return;
          const model = editor.getModel();
          if (!model) return;
          const next = formatLikeJs(model.getValue());
          if (next === null || next === model.getValue()) return;
          editor.executeEdits("format-json", [
            {
              range: model.getFullModelRange(),
              text: next,
              forceMoveMarkers: true,
            },
          ]);
        },
      }),
      [],
    );

    useEffect(() => {
      if (!hostRef.current) return;
      ensureMongoCompletionRegistered();

      const safeId = idHint.replace(/[^a-zA-Z0-9]/g, "-");
      const ext = language === "javascript" ? "js" : "json";
      const uri = monaco.Uri.parse(`inmemory://mongo-manager/${safeId}.${ext}`);
      const existing = monaco.editor.getModel(uri);
      const model =
        existing ??
        monaco.editor.createModel(value, language, uri);

      if (existing && existing.getValue() !== value) {
        existing.setValue(value);
      }

      const editor = monaco.editor.create(hostRef.current, {
        model,
        theme: theme === "dark" ? "vs-dark" : "vs",
        lineNumbers: showLineNumbers ? "on" : "off",
        lineDecorationsWidth: showLineNumbers ? 10 : 0,
        lineNumbersMinChars: showLineNumbers ? 3 : 0,
        glyphMargin: false,
        folding: showLineNumbers,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        wordWrap: wordWrap ? "on" : "off",
        fontFamily:
          "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 12.5,
        tabSize: 2,
        insertSpaces: true,
        automaticLayout: true,
        contextmenu: false,
        readOnly,
        padding: { top: 6, bottom: 6 },
        scrollbar: {
          verticalScrollbarSize: 8,
          horizontalScrollbarSize: 8,
          useShadows: false,
        },
        renderLineHighlight: showLineNumbers ? "line" : "none",
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        overviewRulerBorder: false,
        quickSuggestions: { other: true, comments: false, strings: true },
        suggestOnTriggerCharacters: true,
        acceptSuggestionOnEnter: "on",
        formatOnPaste: true,
        formatOnType: true,
      });

      editorRef.current = editor;

      const sub = editor.onDidChangeModelContent(() => {
        onChangeRef.current(editor.getValue());
      });

      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
        () => onSubmitRef.current?.(),
      );

      const triggerFormat = () => {
        const model = editor.getModel();
        if (!model) return;
        const next = formatLikeJs(model.getValue());
        if (next === null || next === model.getValue()) return;
        editor.executeEdits("format-json", [
          {
            range: model.getFullModelRange(),
            text: next,
            forceMoveMarkers: true,
          },
        ]);
      };
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF,
        triggerFormat,
      );
      editor.addCommand(
        monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF,
        triggerFormat,
      );

      return () => {
        sub.dispose();
        editor.dispose();
        if (!existing) model.dispose();
        clearModelMongoConfig(uri);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
      monaco.editor.setTheme(theme === "dark" ? "vs-dark" : "vs");
    }, [theme]);

    useEffect(() => {
      const editor = editorRef.current;
      if (!editor) return;
      if (editor.getValue() !== value) {
        editor.setValue(value);
      }
    }, [value]);

    useEffect(() => {
      const editor = editorRef.current;
      if (!editor) return;
      const model = editor.getModel();
      if (!model) return;
      setModelMongoConfig(model.uri, completion ?? {});
    }, [completion]);

    return (
      <div
        ref={hostRef}
        style={{ minHeight }}
        className="h-full w-full"
      />
    );
  },
);

export { formatLikeJs };

/**
 * Pretty-print a piece of JSON-or-JS-object source. We can't rely on
 * JSON.parse because users (and the AI) often paste shell-style snippets with
 * unquoted keys like `{ Type: "PublicHoliday" }`. Instead we tokenize the
 * input, preserving string/regex/comment runs verbatim, and re-emit
 * structural punctuation with consistent indentation. This works for any
 * JS-style object/array literal as well as strict JSON.
 *
 * Returns null if the source can't be normalized (mismatched delimiters or
 * unterminated string).
 */
function formatLikeJs(src: string): string | null {
  const tokens = tokenize(src);
  if (!tokens) return null;
  const sig = tokens.filter((t) => t.kind !== "ws");
  const tree = parseTree(sig);
  if (!tree) return null;

  const INDENT = "  ";
  const MAX_INLINE = 80;

  const indent = (depth: number) => INDENT.repeat(Math.max(0, depth));

  // Render a node strictly inline — never any newlines.
  const renderInline = (node: Node): string => {
    if (node.kind === "leaf") return joinLeaves(node.tokens);
    if (node.kind === "expr") return node.parts.map(renderInline).join("");
    if (node.children.length === 0) {
      return node.kind === "object"
        ? "{}"
        : node.kind === "array"
          ? "[]"
          : "()";
    }
    const inner = node.children.map(renderInline).join(", ");
    if (node.kind === "object") return `{ ${inner} }`;
    return node.kind === "array" ? `[${inner}]` : `(${inner})`;
  };

  const render = (node: Node, depth: number): string => {
    if (node.kind === "leaf") return joinLeaves(node.tokens);

    if (node.kind === "expr") {
      const inline = renderInline(node);
      if (inline.length + indent(depth).length <= MAX_INLINE) return inline;
      // Multi-line expression: render each part. Leaves and short groups stay
      // inline; groups that don't fit expand. We accumulate output linearly so
      // the indent of an expanded group is the *current* depth.
      let out = "";
      for (const part of node.parts) out += render(part, depth);
      return out;
    }

    // Group ({}, [], or ())
    if (node.children.length === 0) {
      return node.kind === "object"
        ? "{}"
        : node.kind === "array"
          ? "[]"
          : "()";
    }

    const inline = renderInline(node);
    if (inline.length + indent(depth).length <= MAX_INLINE) return inline;

    const open = node.kind === "object" ? "{" : node.kind === "array" ? "[" : "(";
    const close = node.kind === "object" ? "}" : node.kind === "array" ? "]" : ")";

    // Hug: a `(…)` containing a single object/array argument renders as
    // `({…})` / `([…])` so the lone delimiter doesn't waste a line.
    if (
      node.kind === "paren" &&
      node.children.length === 1 &&
      (node.children[0]!.kind === "object" || node.children[0]!.kind === "array")
    ) {
      const inner = node.children[0] as GroupNode;
      const innerOpen = inner.kind === "object" ? "{" : "[";
      const innerClose = inner.kind === "object" ? "}" : "]";
      if (inner.children.length === 0) {
        return open + innerOpen + innerClose + close;
      }
      const childIndent = indent(depth + 1);
      const closerIndent = indent(depth);
      const lines = inner.children.map(
        (c) => childIndent + render(c, depth + 1),
      );
      return (
        open +
        innerOpen +
        "\n" +
        lines.join(",\n") +
        "\n" +
        closerIndent +
        innerClose +
        close
      );
    }

    const childIndent = indent(depth + 1);
    const closerIndent = indent(depth);
    const lines = node.children.map(
      (c) => childIndent + render(c, depth + 1),
    );
    return open + "\n" + lines.join(",\n") + "\n" + closerIndent + close;
  };

  const out = render(tree, 0);
  return out.replace(/[ \t]+\n/g, "\n").trimEnd() + (src.endsWith("\n") ? "\n" : "");
}

interface LeafNode {
  kind: "leaf";
  tokens: Token[];
}
interface GroupNode {
  kind: "object" | "array" | "paren";
  children: Node[];
}
interface ExprNode {
  kind: "expr";
  parts: Node[];
}
type Node = LeafNode | GroupNode | ExprNode;

/**
 * Parse a flat token stream into a tree of expressions and groups. Top-level
 * (and group-internal) entries are split by commas. Each entry may contain a
 * sequence of leaves and groups, which we wrap in an `expr` node so the
 * renderer can decide independently whether to keep that sequence inline or
 * expand it.
 */
function parseTree(tokens: Token[]): Node | null {
  let pos = 0;

  const parseList = (closer: string | null): Node[] | null => {
    const entries: Node[] = [];
    let parts: Node[] = [];
    let leafTokens: Token[] = [];

    const flushLeaf = () => {
      if (leafTokens.length > 0) {
        parts.push({ kind: "leaf", tokens: leafTokens });
        leafTokens = [];
      }
    };
    const flushEntry = () => {
      flushLeaf();
      if (parts.length === 0) return;
      if (parts.length === 1) entries.push(parts[0]!);
      else entries.push({ kind: "expr", parts });
      parts = [];
    };

    while (pos < tokens.length) {
      const t = tokens[pos]!;
      if (t.kind === "punct") {
        if (closer && t.value === closer) {
          pos++;
          flushEntry();
          return entries;
        }
        if (t.value === "{" || t.value === "[" || t.value === "(") {
          flushLeaf();
          pos++;
          const sub = parseList(
            t.value === "{" ? "}" : t.value === "[" ? "]" : ")",
          );
          if (sub === null) return null;
          parts.push({
            kind:
              t.value === "{"
                ? "object"
                : t.value === "["
                  ? "array"
                  : "paren",
            children: sub,
          });
          continue;
        }
        if (t.value === "}" || t.value === "]" || t.value === ")") {
          return null;
        }
        if (t.value === "," && closer !== null) {
          flushEntry();
          pos++;
          continue;
        }
      }
      leafTokens.push(t);
      pos++;
    }
    if (closer !== null) return null;
    flushEntry();
    return entries;
  };

  const top = parseList(null);
  if (top === null) return null;
  if (top.length === 0) return { kind: "leaf", tokens: [] };
  if (top.length === 1) return top[0]!;
  // Multiple top-level entries (e.g. comma-separated statements). Wrap them
  // back as an expr with comma-leaves interleaved so they round-trip cleanly.
  const parts: Node[] = [];
  top.forEach((n, i) => {
    if (i > 0) parts.push({ kind: "leaf", tokens: [{ kind: "punct", value: "," }, { kind: "ws", value: " " }] });
    parts.push(n);
  });
  return { kind: "expr", parts };
}

function joinLeaves(tokens: Token[]): string {
  let out = "";
  for (const t of tokens) {
    if (t.kind === "punct") {
      if (t.value === ":") {
        out = out.replace(/\s+$/, "");
        out += ": ";
        continue;
      }
      if (t.value === ".") {
        out = out.replace(/\s+$/, "");
        out += ".";
        continue;
      }
      out += t.value;
      continue;
    }
    if (out && needsSpaceBetween(out[out.length - 1] ?? "", t.value[0] ?? "")) {
      out += " ";
    }
    out += t.value;
  }
  return out;
}

function needsSpaceBetween(a: string, b: string): boolean {
  const wordy = (c: string) => /[\w$"'`]/.test(c);
  return wordy(a) && wordy(b);
}


interface Token {
  kind: "punct" | "string" | "number" | "word" | "regex" | "comment" | "ws";
  value: string;
}

const PUNCT = new Set([
  "{",
  "}",
  "[",
  "]",
  "(",
  ")",
  ",",
  ":",
  ";",
  ".",
  "?",
  "+",
  "-",
  "*",
  "/",
  "%",
  "=",
  "<",
  ">",
  "!",
  "&",
  "|",
  "^",
  "~",
]);

function tokenize(src: string): Token[] | null {
  const out: Token[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i]!;
    // Whitespace run
    if (/\s/.test(ch)) {
      let j = i;
      while (j < n && /\s/.test(src[j] ?? "")) j++;
      out.push({ kind: "ws", value: src.slice(i, j) });
      i = j;
      continue;
    }
    // Line comment
    if (ch === "/" && src[i + 1] === "/") {
      let j = i;
      while (j < n && src[j] !== "\n") j++;
      out.push({ kind: "comment", value: src.slice(i, j) });
      i = j;
      continue;
    }
    // Block comment
    if (ch === "/" && src[i + 1] === "*") {
      let j = i + 2;
      while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++;
      if (j >= n) return null;
      j += 2;
      out.push({ kind: "comment", value: src.slice(i, j) });
      i = j;
      continue;
    }
    // String
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      let j = i + 1;
      while (j < n) {
        const c = src[j];
        if (c === "\\") {
          j += 2;
          continue;
        }
        if (c === quote) {
          j++;
          break;
        }
        j++;
      }
      if (j > n) return null;
      out.push({ kind: "string", value: src.slice(i, j) });
      i = j;
      continue;
    }
    // Regex literal — heuristic: '/' that follows an opener / operator / start
    if (ch === "/") {
      const last = lastNonWs(out);
      const prefersRegex =
        !last ||
        (last.kind === "punct" &&
          (last.value === "(" ||
            last.value === "[" ||
            last.value === "{" ||
            last.value === "," ||
            last.value === ":" ||
            last.value === "=" ||
            last.value === "!" ||
            last.value === "&" ||
            last.value === "|" ||
            last.value === "?"));
      if (prefersRegex) {
        let j = i + 1;
        let inClass = false;
        while (j < n) {
          const c = src[j];
          if (c === "\\") {
            j += 2;
            continue;
          }
          if (c === "[") inClass = true;
          else if (c === "]") inClass = false;
          else if (c === "/" && !inClass) {
            j++;
            break;
          } else if (c === "\n") return null;
          j++;
        }
        // optional flags
        while (j < n && /[a-z]/.test(src[j] ?? "")) j++;
        out.push({ kind: "regex", value: src.slice(i, j) });
        i = j;
        continue;
      }
    }
    // Number
    if (/[0-9]/.test(ch) || (ch === "-" && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i;
      if (ch === "-") j++;
      while (j < n && /[0-9.eE+\-]/.test(src[j] ?? "")) j++;
      out.push({ kind: "number", value: src.slice(i, j) });
      i = j;
      continue;
    }
    // Word (identifier / keyword)
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < n && /[\w$]/.test(src[j] ?? "")) j++;
      out.push({ kind: "word", value: src.slice(i, j) });
      i = j;
      continue;
    }
    // Punctuation
    if (PUNCT.has(ch)) {
      out.push({ kind: "punct", value: ch });
      i++;
      continue;
    }
    // Unknown char — preserve and continue
    out.push({ kind: "word", value: ch });
    i++;
  }
  return out;
}

function lastNonWs(tokens: Token[]): Token | null {
  for (let j = tokens.length - 1; j >= 0; j--) {
    const t = tokens[j]!;
    if (t.kind !== "ws") return t;
  }
  return null;
}
