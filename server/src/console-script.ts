import { type Node, parse } from "acorn";

/**
 * Rewrites a console script so it runs as the body of an async function with
 * mongosh-like ergonomics:
 *
 *  - the value of the last top-level expression statement is returned, so
 *    `const n = 5; db.users.find({ age: { $gt: n } })` yields the cursor;
 *  - every call chain is implicitly awaited (`const n =
 *    db.users.countDocuments()`, `posts.find().toArray()` on an aliased
 *    collection), so scripts pasted from mongosh work without sprinkling
 *    `await` everywhere.
 *
 * Implicit awaits are only inserted where `await` is legal: at the top level
 * of the script or inside async functions — callbacks passed to e.g.
 * `Array.prototype.map` still need to be `async` and awaited explicitly.
 * Awaiting a non-promise (e.g. a FindCursor) is a no-op, so wrapping is safe.
 */
export const prepareConsoleScript = (code: string): string => {
  let ast: Node;
  try {
    ast = parse(code, {
      ecmaVersion: "latest",
      sourceType: "script",
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
    });
  } catch (e) {
    throw new SyntaxError(e instanceof Error ? e.message : String(e));
  }

  const wraps: Wrap[] = [];

  const body = (ast as unknown as { body: AnyNode[] }).body;
  const last = body[body.length - 1];
  if (last?.type === "ExpressionStatement") {
    // Wrap the whole statement (not just the expression) so a parenthesized
    // statement like `({ a: 1 })` keeps balanced parens; drop the trailing `;`.
    const end = code[last.end - 1] === ";" ? last.end - 1 : last.end;
    wraps.push({ start: last.start, end, open: "return (", close: ")", rank: 1 });
  }

  walk(ast as unknown as AnyNode, null, [], (node, parent, asyncStack) => {
    if (node.type !== "CallExpression") return;
    const canAwait = asyncStack.length === 0 || asyncStack[asyncStack.length - 1];
    if (!canAwait) return;
    if (parent?.type === "AwaitExpression") return;
    // Only wrap the outermost call of a chain: `db.x.find().limit(5)` is
    // awaited as a whole, not at `db.x.find()`.
    if (parent?.type === "MemberExpression" && parent.object === node) return;
    if (parent?.type === "CallExpression" && parent.callee === node) return;
    wraps.push({ start: node.start, end: node.end, open: "(await ", close: ")", rank: 0 });
  });

  return applyWraps(code, wraps);
};

interface AnyNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

interface Wrap {
  start: number;
  end: number;
  open: string;
  close: string;
  /** Tie-breaker for identical ranges — higher rank ends up outermost. */
  rank: number;
}

const isNode = (v: unknown): v is AnyNode =>
  !!v && typeof v === "object" && typeof (v as AnyNode).type === "string";

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

const walk = (
  node: AnyNode,
  parent: AnyNode | null,
  asyncStack: boolean[],
  visit: (node: AnyNode, parent: AnyNode | null, asyncStack: boolean[]) => void,
): void => {
  visit(node, parent, asyncStack);
  const stack = FUNCTION_TYPES.has(node.type)
    ? [...asyncStack, node.async === true]
    : asyncStack;
  for (const key of Object.keys(node)) {
    const child = node[key];
    if (Array.isArray(child)) {
      for (const c of child) if (isNode(c)) walk(c, node, stack, visit);
    } else if (isNode(child)) {
      walk(child, node, stack, visit);
    }
  }
};

// Wraps are properly nested or disjoint (they come from AST ranges), so we
// can emit them as open/close events sorted by position.
const applyWraps = (code: string, wraps: Wrap[]): string => {
  type Ev = { pos: number; open: boolean; text: string; len: number; rank: number };
  const events: Ev[] = [];
  for (const w of wraps) {
    const len = w.end - w.start;
    events.push({ pos: w.start, open: true, text: w.open, len, rank: w.rank });
    events.push({ pos: w.end, open: false, text: w.close, len, rank: w.rank });
  }
  events.sort((a, b) => {
    if (a.pos !== b.pos) return a.pos - b.pos;
    if (a.open !== b.open) return a.open ? 1 : -1; // closes first
    // Opens: outermost first. Closes: innermost first.
    const outer = b.len - a.len || b.rank - a.rank;
    return a.open ? outer : -outer;
  });
  let out = "";
  let cursor = 0;
  for (const ev of events) {
    out += code.slice(cursor, ev.pos) + ev.text;
    cursor = ev.pos;
  }
  return out + code.slice(cursor);
};
