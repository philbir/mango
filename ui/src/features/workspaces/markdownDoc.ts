/**
 * Tiny parser/serializer for Mango workspace `.md` files.
 *
 * Format:
 *
 *   ---
 *   mango:
 *     collection: users
 *     connection: prod                      # display name (informational)
 *     connectionId: 4f3e1a-…                # opaque id; used for routing on open
 *     database: app                         # database name; also used to suggest
 *                                           # a connection when connectionId no
 *                                           # longer matches anything.
 *     fields: _id, name                     # projection fields (query files only)
 *   ---
 *
 *   Free-form Markdown description.
 *
 *   ```mongo
 *   <body — filter JSON for query, full command for console, freeform for notebook>
 *   ```
 *
 * The script lives in a ```mongo fenced code block so the file renders as a
 * normal Markdown document — pasting raw Mongo into the fence in any editor
 * Just Works.
 *
 * The file's *kind* (query / console / notebook) is determined entirely by
 * the on-disk extension (`.mnq.md` / `.mnc.md` / `.mnn.md`) — the frontmatter
 * deliberately does not carry it. Extension is authoritative.
 *
 * Hand-rolled because the YAML subset we accept is trivial. Avoids a
 * multi-MB `gray-matter` + `js-yaml` dep tree.
 */

export type MangoKind = "query" | "console" | "notebook";

export interface MangoFrontmatter {
  collection: string | null;
  /** Display name of the connection — informational; may be stale. */
  connection: string | null;
  /** Stable id of the connection that produced this file. Routes opens. */
  connectionId: string | null;
  /** Database the script was run against. Used as a fallback match. */
  database: string | null;
  /**
   * Selected projection field names for query files. Stored in frontmatter
   * (as a comma-separated YAML string) rather than the script body so the
   * runnable filter JSON in `` ```mongo `` stays focused on what changes
   * most often. Null = no explicit projection (return whole documents).
   */
  fields: string[] | null;
}

export interface ParsedMd {
  frontmatter: MangoFrontmatter;
  /** Markdown body above the script sentinel. */
  description: string;
  /** Raw script body below the sentinel. */
  script: string;
  /** True iff the file had a ```mongo fence. */
  hasScript: boolean;
}

const SCRIPT_LANGS = new Set(["mongo", "mongodb", "mongo-shell"]);

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
      if (!/^\s/.test(line)) inMango = false;
      continue;
    }
    const key = m[1]!;
    const val = stripQuotes(m[2] ?? "");
    if (key === "collection") {
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
    // Unknown keys (including legacy `kind`) are ignored — extension is the
    // source of truth for kind now.
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
    const scriptLines = lines.slice(i + 1);
    const start = lines.slice(0, i).reduce((acc, l) => acc + l.length + 1, 0);
    return { lang, script: scriptLines.join("\n"), start, end: body.length };
  }
  return null;
};

export const parseMd = (raw: string): ParsedMd => {
  let frontmatter: MangoFrontmatter = {
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
 * Per-kind extensions on disk. Each ends with `.md` so external Markdown
 * tooling renders the file as a normal document; the `.mnX` infix is what
 * Mango filters on in the workspace tree and uses for kind dispatch.
 */
export const MANGO_QUERY_EXT = ".mnq.md";
export const MANGO_CONSOLE_EXT = ".mnc.md";
export const MANGO_NOTEBOOK_EXT = ".mnn.md";
export const MANGO_EXTS = [
  MANGO_QUERY_EXT,
  MANGO_CONSOLE_EXT,
  MANGO_NOTEBOOK_EXT,
] as const;

export const extForKind = (kind: MangoKind): string => {
  switch (kind) {
    case "query":
      return MANGO_QUERY_EXT;
    case "console":
      return MANGO_CONSOLE_EXT;
    case "notebook":
      return MANGO_NOTEBOOK_EXT;
  }
};

/**
 * Derive the kind from a file's name (or full path). Returns null for any
 * file that isn't one of the three Mango kinds — those are non-Mango files
 * that just happen to live in the workspace tree.
 */
export const kindFromFilename = (name: string): MangoKind | null => {
  const lower = name.toLowerCase();
  if (lower.endsWith(MANGO_QUERY_EXT)) return "query";
  if (lower.endsWith(MANGO_CONSOLE_EXT)) return "console";
  if (lower.endsWith(MANGO_NOTEBOOK_EXT)) return "notebook";
  return null;
};

/** True if `name` is one of the three Mango workspace file kinds. */
export const isMangoFile = (name: string): boolean =>
  kindFromFilename(name) !== null;

/**
 * Append the kind-appropriate extension to a user-provided filename when
 * it's not already there. Strips a stray trailing `.md` first so
 * "users-find.md" → "users-find.mnq.md" instead of "users-find.md.mnq.md".
 */
export const ensureMangoFileExt = (name: string, kind: MangoKind): string => {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  const ext = extForKind(kind);
  if (trimmed.toLowerCase().endsWith(ext)) return trimmed;
  // If they typed a different Mango ext, swap it for the requested one.
  for (const other of MANGO_EXTS) {
    if (trimmed.toLowerCase().endsWith(other)) {
      return trimmed.slice(0, -other.length) + ext;
    }
  }
  const stripped = trimmed.replace(/\.md$/i, "");
  return `${stripped}${ext}`;
};

/**
 * Strip whichever Mango extension matches for display in the workspace tree.
 * The extension is an implementation detail; users see just the stem.
 */
export const mangoFileDisplayName = (name: string): string => {
  for (const ext of MANGO_EXTS) {
    if (name.toLowerCase().endsWith(ext)) return name.slice(0, -ext.length);
  }
  return name;
};

/**
 * Suggest a filename from a Mongo command. Strips `db.<col>.`, picks the
 * first verb, and appends the kind-appropriate extension.
 */
export const suggestFilenameFromScript = (
  script: string,
  kind: MangoKind,
): string => {
  const ext = extForKind(kind);
  const m = /\bdb\.([\w$]+)\.(\w+)/.exec(script);
  if (m) {
    const col = m[1]!;
    const verb = m[2]!;
    return `${col}-${verb}${ext}`;
  }
  return `untitled${ext}`;
};

/** Pull the inferred collection out of a `db.<col>.<verb>(…)` command. */
export const inferCollectionFromScript = (script: string): string | null => {
  const m = /\bdb\.([\w$]+)\b/.exec(script);
  return m?.[1] ?? null;
};
