import { type Node, parse } from "acorn";

/**
 * Preprocessing for console scripts before they reach the mongosh evaluator.
 * mongosh's REPL feeds input one line at a time, so a pasted multi-line
 * script loses two things that work interactively; this module restores them.
 */

// mongosh's line-level shell commands: `use <db>`, `show dbs`, `show log global`.
const SHELL_COMMAND = /^\s*(?:use|show)\s+[^\s;]+(?:\s+[^\s;]+)?\s*;?\s*$/;

const parses = (code: string): boolean => {
  try {
    parse(code, {
      ecmaVersion: "latest",
      sourceType: "script",
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
    });
    return true;
  } catch {
    return false;
  }
};

export interface ScriptStep {
  code: string;
  /** A `use` / `show` line — its result is printed when it isn't the last step. */
  shellCommand: boolean;
}

/**
 * Split a script at `use` / `show` lines so they run as their own steps, the
 * way the REPL would see them. A line only counts when it isn't valid
 * JavaScript by itself (`use + 1` is an expression, `use admin` isn't) and the
 * code before it is a complete program — `show` inside a template string or
 * an unfinished expression stays put.
 */
export const splitScript = (code: string): ScriptStep[] => {
  const steps: ScriptStep[] = [];
  let chunk: string[] = [];
  const flush = () => {
    const text = chunk.join("\n");
    if (text.trim()) steps.push({ code: text, shellCommand: false });
    chunk = [];
  };
  for (const line of code.split("\n")) {
    if (SHELL_COMMAND.test(line) && !parses(line) && parses(chunk.join("\n"))) {
      flush();
      steps.push({ code: line.trim().replace(/;$/, "").trim(), shellCommand: true });
    } else {
      chunk.push(line);
    }
  }
  flush();
  return steps;
};

interface AnyNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

const isNode = (v: unknown): v is AnyNode =>
  !!v && typeof v === "object" && typeof (v as AnyNode).type === "string";

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

const hasTopLevelAwait = (node: AnyNode): boolean => {
  if (FUNCTION_TYPES.has(node.type)) return false;
  if (node.type === "AwaitExpression") return true;
  if (node.type === "ForOfStatement" && node.await === true) return true;
  for (const key of Object.keys(node)) {
    const child = node[key];
    if (Array.isArray(child)) {
      if (child.some((c) => isNode(c) && hasTopLevelAwait(c))) return true;
    } else if (isNode(child) && hasTopLevelAwait(child)) {
      return true;
    }
  }
  return false;
};

/**
 * mongosh awaits database calls on its own, so its async rewriter rejects a
 * top-level `await`. Scripts written for Node or the old console use it
 * anyway: wrap those in an async function whose last expression statement is
 * returned, which the rewriter accepts. Code without top-level await, or that
 * doesn't parse (mongosh reports the error), is returned unchanged.
 */
export const allowTopLevelAwait = (code: string): string => {
  let ast: Node;
  try {
    ast = parse(code, {
      ecmaVersion: "latest",
      sourceType: "script",
      allowAwaitOutsideFunction: true,
    });
  } catch {
    return code;
  }
  if (!hasTopLevelAwait(ast as unknown as AnyNode)) return code;

  const body = (ast as unknown as { body: AnyNode[] }).body;
  const last = body[body.length - 1];
  let wrapped = code;
  if (last?.type === "ExpressionStatement") {
    const end = code[last.end - 1] === ";" ? last.end - 1 : last.end;
    wrapped = `${code.slice(0, last.start)}return (${code.slice(last.start, end)});${code.slice(last.end)}`;
  }
  return `(async () => {\n${wrapped}\n})()`;
};
