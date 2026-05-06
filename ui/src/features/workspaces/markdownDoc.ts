/**
 * Tiny parser/serializer for Mango workspace `.md` files.
 *
 * Format:
 *
 *   ---
 *   mango:
 *     kind: console                         # query | console | shell | aggregation
 *     collection: users
 *     connection: prod                      # display name (informational)
 *     connectionId: 4f3e1a-…                # opaque id; used for routing on open
 *     database: app                         # database name; also used to suggest
 *                                           # a connection when connectionId no
 *                                           # longer matches anything.
 *   ---
 *
 *   Free-form Markdown description.
 *
 *   ```mongo
 *   db.users.find({ ... })
 *   ```
 *
 * The script lives in a ```mongo fenced code block so the file renders as a
 * normal Markdown document — pasting raw Mongo into the fence in any editor
 * Just Works. The Mango UI hides the fence markers from the user; only the
 * inner content is shown in the script editor.
 *
 * Hand-rolled because the YAML subset we accept is trivial (one nested map
 * with up to five string keys). Avoids a multi-MB `gray-matter` + `js-yaml`
 * dep tree.
 */

export type MangoKind =
  | "query"
  | "console"
  | "shell"
  | "aggregation"
  /**
   * Free-form Markdown notebook: raw `.md` shown in a Monaco editor with
   * Code Lens "Run" actions on every ```mongo fence. No single bound
   * script — the user authors arbitrary text + many runnable code blocks.
   */
  | "notebook";

export interface MangoFrontmatter {
  kind: MangoKind | null;
  collection: string | null;
  /** Display name of the connection — informational; may be stale. */
  connection: string | null;
  /** Stable id of the connection that produced this file. Routes opens. */
  connectionId: string | null;
  /** Database the script was run against. Used as a fallback match. */
  database: string | null;
  /**
   * Selected projection field names for `kind: query` files. Stored in
   * frontmatter (as a comma-separated YAML string) rather than the script
   * itself so the runnable `db.coll.find({…})` body stays focused on the
   * filter. Null = no explicit projection (return whole documents).
   */
  fields: string[] | null;
}

export interface ParsedMd {
  frontmatter: MangoFrontmatter;
  /** Markdown body above the script sentinel. */
  description: string;
  /** Raw script body below the sentinel. */
  script: string;
  /** True iff the file had a `<!-- mango:script -->` sentinel. */
  hasScript: boolean;
}

const SCRIPT_LANGS = new Set(["mongo", "mongodb", "mongo-shell"]);
const KNOWN_KINDS: ReadonlySet<MangoKind> = new Set([
  "query",
  "console",
  "shell",
  "aggregation",
  "notebook",
]);

const stripQuotes = (v: string): string => {
  const t = v.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1);
  }
  return t;
};

const parseFrontmatter = (block: string): MangoFrontmatter => {
  const out: MangoFrontmatter = {
    kind: null,
    collection: null,
    connection: null,
    connectionId: null,
    database: null,
    fields: null,
  };
  const lines = block.split(/\r?\n/);
  let inMango = false;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (/^mango\s*:\s*$/.test(line)) {
      inMango = true;
      continue;
    }
    if (!inMango) continue;
    const m = /^\s+([\w-]+)\s*:\s*(.*?)\s*$/.exec(line);
    if (!m) {
      // Indentation broke — assume we left the mango block.
      if (!/^\s/.test(line)) inMango = false;
      continue;
    }
    const key = m[1]!;
    const val = stripQuotes(m[2] ?? "");
    if (key === "kind") {
      const k = val.toLowerCase() as MangoKind;
      if (KNOWN_KINDS.has(k)) out.kind = k;
    } else if (key === "collection") {
      out.collection = val || null;
    } else if (key === "connection") {
      out.connection = val || null;
    } else if (key === "connectionId") {
      out.connectionId = val || null;
    } else if (key === "database") {
      out.database = val || null;
    } else if (key === "fields") {
      const list = val
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      out.fields = list.length > 0 ? list : null;
    }
  }
  return out;
};

/**
 * Find the first ```mongo / ```mongodb / ```mongo-shell fence in the body.
 * Returns the inner script and the byte offsets of the fence so the caller
 * can splice the description out around it. An unclosed fence is treated as
 * "rest of file is the script" — matches Markdown rendering behavior.
 */
const findFirstScriptFence = (
  body: string,
): { lang: string; script: string; start: number; end: number } | null => {
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const m = /^```([\w-]+)\s*$/.exec(line);
    if (!m) continue;
    const lang = (m[1] ?? "").toLowerCase();
    if (!SCRIPT_LANGS.has(lang)) continue;
    for (let j = i + 1; j < lines.length; j++) {
      if ((lines[j] ?? "") === "```") {
        const scriptLines = lines.slice(i + 1, j);
        const start =
          lines.slice(0, i).reduce((acc, l) => acc + l.length + 1, 0);
        const end =
          lines.slice(0, j + 1).reduce((acc, l) => acc + l.length + 1, 0);
        return { lang, script: scriptLines.join("\n"), start, end };
      }
    }
    // Unclosed fence — rest of the file is the script.
    const scriptLines = lines.slice(i + 1);
    const start = lines.slice(0, i).reduce((acc, l) => acc + l.length + 1, 0);
    return { lang, script: scriptLines.join("\n"), start, end: body.length };
  }
  return null;
};

export const parseMd = (raw: string): ParsedMd => {
  let frontmatter: MangoFrontmatter = {
    kind: null,
    collection: null,
    connection: null,
    connectionId: null,
    database: null,
    fields: null,
  };
  let body = raw;
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (fmMatch) {
    frontmatter = parseFrontmatter(fmMatch[1] ?? "");
    body = raw.slice(fmMatch[0].length);
  }
  // The script lives in a ```mongo fence. The description is everything
  // outside that block.
  const fence = findFirstScriptFence(body);
  if (!fence) {
    return {
      frontmatter,
      description: body.replace(/\n{3,}/g, "\n\n").trim(),
      script: "",
      hasScript: false,
    };
  }
  const description = body.slice(0, fence.start) + body.slice(fence.end);
  return {
    frontmatter,
    description: description.replace(/\n{3,}/g, "\n\n").trim(),
    script: fence.script,
    hasScript: true,
  };
};

export interface SerializeInput {
  frontmatter: MangoFrontmatter;
  description: string;
  script: string;
}

const escapeYamlValue = (v: string): string => {
  if (/^[\w./@:-]+$/.test(v)) return v;
  return `"${v.replace(/"/g, '\\"')}"`;
};

export const serializeMd = (input: SerializeInput): string => {
  const lines: string[] = [];
  lines.push("---");
  lines.push("mango:");
  if (input.frontmatter.kind) lines.push(`  kind: ${input.frontmatter.kind}`);
  if (input.frontmatter.collection) {
    lines.push(`  collection: ${escapeYamlValue(input.frontmatter.collection)}`);
  }
  if (input.frontmatter.connection) {
    lines.push(`  connection: ${escapeYamlValue(input.frontmatter.connection)}`);
  }
  if (input.frontmatter.connectionId) {
    lines.push(`  connectionId: ${escapeYamlValue(input.frontmatter.connectionId)}`);
  }
  if (input.frontmatter.database) {
    lines.push(`  database: ${escapeYamlValue(input.frontmatter.database)}`);
  }
  if (input.frontmatter.fields && input.frontmatter.fields.length > 0) {
    lines.push(
      `  fields: ${escapeYamlValue(input.frontmatter.fields.join(","))}`,
    );
  }
  lines.push("---");
  lines.push("");
  const description = input.description.trim();
  if (description) {
    lines.push(description);
    lines.push("");
  }
  lines.push("```mongo");
  lines.push(input.script.replace(/\n+$/, ""));
  lines.push("```");
  lines.push("");
  return lines.join("\n");
};

/**
 * The extension every Mango workspace file uses on disk. Doubled so external
 * tools still treat the file as Markdown (`.md`) while we get an unambiguous
 * sub-extension to filter on in the workspace tree (`*.mng.md`).
 */
export const MANGO_FILE_EXT = ".mng.md";

/** True if `name` is a Mango workspace file. Case-insensitive. */
export const isMangoFile = (name: string): boolean =>
  name.toLowerCase().endsWith(MANGO_FILE_EXT);

/**
 * Append `.mng.md` to a user-provided filename when it's not already there.
 * Strips a stray trailing `.md` first so "users-find.md" → "users-find.mng.md"
 * instead of "users-find.md.mng.md".
 */
export const ensureMangoFileExt = (name: string): string => {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  if (isMangoFile(trimmed)) return trimmed;
  const stripped = trimmed.replace(/\.md$/i, "");
  return `${stripped}${MANGO_FILE_EXT}`;
};

/**
 * Strip the `.mng.md` extension for display in the workspace tree. The
 * extension is a Mango implementation detail; users see just the stem.
 */
export const mangoFileDisplayName = (name: string): string =>
  isMangoFile(name) ? name.slice(0, -MANGO_FILE_EXT.length) : name;

/** Suggest a filename from a Mongo command — strips `db.<col>.`, picks first verb. */
export const suggestFilenameFromScript = (script: string): string => {
  const m = /\bdb\.([\w$]+)\.(\w+)/.exec(script);
  if (m) {
    const col = m[1]!;
    const verb = m[2]!;
    return `${col}-${verb}${MANGO_FILE_EXT}`;
  }
  return `untitled${MANGO_FILE_EXT}`;
};

/** Pull the inferred collection out of a `db.<col>.<verb>(…)` command. */
export const inferCollectionFromScript = (script: string): string | null => {
  const m = /\bdb\.([\w$]+)\b/.exec(script);
  return m?.[1] ?? null;
};
