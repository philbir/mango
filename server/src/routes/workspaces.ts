import { Hono } from "hono";
import { existsSync, statSync } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { probeGit } from "../git/probe.js";
import { resolveServerConfig } from "../mode.js";
import {
  type Workspace,
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  listWorkspaces,
  touchWorkspace,
  updateWorkspace,
  validateWorkspaceFolder,
} from "../store/workspaces.js";

export const workspacesRoute = new Hono();

const disabledError = () => ({
  error: "Workspaces are disabled in this mode",
});

const isEnabled = () => resolveServerConfig().workspacesEnabled;

interface ResolvedPath {
  root: string;
  abs: string;
  rel: string;
}

/**
 * Resolve a request path against a workspace root, with symlink-escape
 * protection. Returns null on traversal/escape; the caller turns that into a
 * 400. Path is allowed to point at a non-existent target (used for "create
 * file" / "create folder") — caller handles the existence check.
 */
const resolveSafe = async (
  ws: Workspace,
  requested: string,
): Promise<ResolvedPath | null> => {
  if (typeof requested !== "string") return null;
  // Reject absolute paths up-front (Windows drive letters, leading slashes).
  // The empty string is the workspace root itself.
  if (path.isAbsolute(requested) || /^[a-zA-Z]:[\\/]/.test(requested)) return null;
  if (requested.startsWith("/") || requested.startsWith("\\")) return null;
  const cleaned = requested;

  let root: string;
  try {
    root = await realpath(ws.folderPath);
  } catch {
    return null;
  }
  const joined = path.resolve(root, cleaned);

  // If the target exists, resolve symlinks; otherwise walk up until we find
  // an existing ancestor and rebuild the path under its real form. This lets
  // callers refer to nested non-existent paths ("queries/users.md") which the
  // PUT/folder handlers will then mkdir -p.
  let resolved: string;
  if (existsSync(joined)) {
    try {
      resolved = await realpath(joined);
    } catch {
      return null;
    }
  } else {
    let walk = joined;
    const tail: string[] = [];
    while (!existsSync(walk)) {
      const parent = path.dirname(walk);
      if (parent === walk) return null; // walked off the filesystem
      tail.unshift(path.basename(walk));
      walk = parent;
    }
    let ancestorReal: string;
    try {
      ancestorReal = await realpath(walk);
    } catch {
      return null;
    }
    resolved = path.join(ancestorReal, ...tail);
  }

  const rel = path.relative(root, resolved);
  if (rel === "") return { root, abs: resolved, rel: "" };
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  // Block .git internals at any depth.
  const parts = rel.split(path.sep);
  if (parts.includes(".git") && parts[0] !== ".git") return null;
  if (parts[0] === ".git" && parts.length > 1) return null;
  return { root, abs: resolved, rel };
};

const sanitizeName = (s: unknown): string =>
  typeof s === "string" ? s.trim() : "";

const ensureWorkspace = (id: string): Workspace | null => getWorkspace(id);

// ─── CRUD ──────────────────────────────────────────────────────────────────

const createBody = z.object({
  name: z.string().min(1).max(120),
  folderPath: z.string().min(1),
  color: z.string().nullable().optional(),
  /**
   * When true, mkdir the folder (recursive) before validating. Used by the
   * "Create <name> subfolder" affordance in the New Workspace dialog so the
   * user doesn't have to pre-create the directory in Finder/Explorer.
   */
  createIfMissing: z.boolean().optional(),
});

const updateBody = z
  .object({
    name: z.string().min(1).max(120),
    color: z.string().nullable(),
    folderPath: z.string().min(1),
  })
  .partial();

workspacesRoute.get("/", (c) => {
  // List is allowed even when disabled, so the UI can render an empty/disabled
  // state. Mutations are gated.
  return c.json({
    enabled: isEnabled(),
    workspaces: listWorkspaces(),
  });
});

/**
 * Server-side folder picker for browser/Aspire deployments where the Tauri
 * native dialog isn't available. Returns directory entries (no files) plus
 * the parent so the client can render a navigable list.
 *
 * Gated by `workspacesEnabled` so it can't leak filesystem layout in
 * standalone/Docker mode where workspaces are off.
 */
workspacesRoute.get("/fs", async (c) => {
  if (!isEnabled()) return c.json(disabledError(), 403);
  const requested = c.req.query("path") ?? "";
  const target = requested ? path.resolve(requested) : os.homedir();
  if (!existsSync(target)) {
    return c.json({ error: `Folder does not exist: ${target}` }, 404);
  }
  let st;
  try {
    st = statSync(target);
  } catch (e) {
    return c.json(
      { error: `Could not stat folder: ${e instanceof Error ? e.message : String(e)}` },
      400,
    );
  }
  if (!st.isDirectory()) {
    return c.json({ error: `Not a directory: ${target}` }, 400);
  }
  let names: string[] = [];
  try {
    names = await readdir(target);
  } catch (e) {
    return c.json(
      {
        path: target,
        parent: path.dirname(target) === target ? null : path.dirname(target),
        home: os.homedir(),
        entries: [],
        readError: e instanceof Error ? e.message : String(e),
      },
      200,
    );
  }
  const entries = await Promise.all(
    names.map(async (name) => {
      const full = path.join(target, name);
      try {
        const childSt = statSync(full);
        if (!childSt.isDirectory()) return null;
        return { name, hidden: name.startsWith(".") };
      } catch {
        return null;
      }
    }),
  );
  const dirs = entries
    .filter((e): e is { name: string; hidden: boolean } => e !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
  return c.json({
    path: target,
    parent: path.dirname(target) === target ? null : path.dirname(target),
    home: os.homedir(),
    entries: dirs,
    readError: null,
  });
});

workspacesRoute.post("/", async (c) => {
  if (!isEnabled()) return c.json(disabledError(), 403);
  const parsed = createBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Bad input" }, 400);
  }
  // Resolve to canonical form so downstream resolveSafe works against a stable
  // root; the user's `~/foo` is up to the client to expand (Tauri picker
  // returns absolute paths already).
  const folderPath = path.resolve(parsed.data.folderPath);
  if (parsed.data.createIfMissing && !existsSync(folderPath)) {
    try {
      await mkdir(folderPath, { recursive: true });
    } catch (e) {
      return c.json(
        { error: `Could not create folder: ${e instanceof Error ? e.message : String(e)}` },
        400,
      );
    }
  }
  try {
    await validateWorkspaceFolder(folderPath);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
  const created = createWorkspace({
    name: sanitizeName(parsed.data.name),
    folderPath,
    color: parsed.data.color ?? null,
  });
  return c.json(created, 201);
});

workspacesRoute.patch("/:id", async (c) => {
  if (!isEnabled()) return c.json(disabledError(), 403);
  const id = c.req.param("id");
  const parsed = updateBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Bad input" }, 400);
  }
  const input = { ...parsed.data };
  if (input.folderPath !== undefined) {
    input.folderPath = path.resolve(input.folderPath);
    try {
      await validateWorkspaceFolder(input.folderPath);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  }
  const updated = updateWorkspace(id, input);
  if (!updated) return c.json({ error: "Workspace not found" }, 404);
  return c.json(updated);
});

workspacesRoute.delete("/:id", (c) => {
  if (!isEnabled()) return c.json(disabledError(), 403);
  const id = c.req.param("id");
  const removed = deleteWorkspace(id);
  if (!removed) return c.json({ error: "Workspace not found" }, 404);
  return c.body(null, 204);
});

// ─── Tree ──────────────────────────────────────────────────────────────────

workspacesRoute.get("/:id/tree", async (c) => {
  const ws = ensureWorkspace(c.req.param("id"));
  if (!ws) return c.json({ error: "Workspace not found" }, 404);
  const requested = c.req.query("path") ?? "";
  const resolved = await resolveSafe(ws, requested);
  if (!resolved) return c.json({ error: "Invalid path" }, 400);
  if (!existsSync(resolved.abs)) {
    return c.json({ error: "Path does not exist" }, 404);
  }
  const st = statSync(resolved.abs);
  if (!st.isDirectory()) {
    return c.json({ error: "Not a directory" }, 400);
  }
  const dirents = await readdir(resolved.abs, { withFileTypes: true });
  const entries = dirents
    .map((d) => {
      const childAbs = path.join(resolved.abs, d.name);
      let kind: "file" | "dir" | "other" = "other";
      let size: number | null = null;
      let mtime: number | null = null;
      try {
        const cs = statSync(childAbs);
        if (cs.isDirectory()) {
          kind = "dir";
          mtime = cs.mtimeMs;
        } else if (cs.isFile()) {
          kind = "file";
          size = cs.size;
          mtime = cs.mtimeMs;
        }
      } catch {
        // unreadable child — skip
      }
      return { name: d.name, kind, size, mtime };
    })
    // Surface only Mango files (one of the three kind extensions) and
    // directories. The workspace folder may live alongside `.git`,
    // `README.md`, scratch files, etc. — we don't want to clutter the
    // sidebar with anything Mango can't open. Hidden dotfiles are also
    // filtered.
    .filter((e) => {
      if (e.kind === "other") return false;
      if (e.name.startsWith(".")) return false;
      if (e.kind === "dir") return true;
      const lower = e.name.toLowerCase();
      return (
        lower.endsWith(".mnq.md") ||
        lower.endsWith(".mnc.md") ||
        lower.endsWith(".mnn.md")
      );
    })
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  return c.json({ path: resolved.rel, entries });
});

// ─── File read/write ───────────────────────────────────────────────────────

const writeBody = z.object({
  raw: z.string(),
  expectedMtime: z.number().nullable().optional(),
});

workspacesRoute.get("/:id/file", async (c) => {
  const ws = ensureWorkspace(c.req.param("id"));
  if (!ws) return c.json({ error: "Workspace not found" }, 404);
  const requested = c.req.query("path") ?? "";
  if (!requested) return c.json({ error: "path is required" }, 400);
  const resolved = await resolveSafe(ws, requested);
  if (!resolved) return c.json({ error: "Invalid path" }, 400);
  if (!existsSync(resolved.abs)) {
    return c.json({ error: "File does not exist" }, 404);
  }
  const st = statSync(resolved.abs);
  if (!st.isFile()) return c.json({ error: "Not a file" }, 400);
  const raw = await readFile(resolved.abs, "utf8");
  return c.json({ path: resolved.rel, raw, mtime: st.mtimeMs, size: st.size });
});

workspacesRoute.put("/:id/file", async (c) => {
  if (!isEnabled()) return c.json(disabledError(), 403);
  const ws = ensureWorkspace(c.req.param("id"));
  if (!ws) return c.json({ error: "Workspace not found" }, 404);
  const requested = c.req.query("path") ?? "";
  if (!requested) return c.json({ error: "path is required" }, 400);
  const resolved = await resolveSafe(ws, requested);
  if (!resolved) return c.json({ error: "Invalid path" }, 400);
  const parsed = writeBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Bad input" }, 400);
  }
  // Concurrent-edit guard: if the caller provided the mtime they last read,
  // refuse to overwrite a newer on-disk version.
  if (existsSync(resolved.abs)) {
    const st = statSync(resolved.abs);
    if (!st.isFile()) return c.json({ error: "Not a file" }, 400);
    if (
      parsed.data.expectedMtime != null &&
      Math.abs(st.mtimeMs - parsed.data.expectedMtime) > 1
    ) {
      return c.json(
        {
          error: "File changed on disk",
          actualMtime: st.mtimeMs,
          expectedMtime: parsed.data.expectedMtime,
        },
        409,
      );
    }
  } else {
    await mkdir(path.dirname(resolved.abs), { recursive: true });
  }
  await writeFile(resolved.abs, parsed.data.raw, "utf8");
  const st = statSync(resolved.abs);
  touchWorkspace(ws.id);
  return c.json({ path: resolved.rel, mtime: st.mtimeMs, size: st.size });
});

workspacesRoute.delete("/:id/file", async (c) => {
  if (!isEnabled()) return c.json(disabledError(), 403);
  const ws = ensureWorkspace(c.req.param("id"));
  if (!ws) return c.json({ error: "Workspace not found" }, 404);
  const requested = c.req.query("path") ?? "";
  if (!requested) return c.json({ error: "path is required" }, 400);
  const resolved = await resolveSafe(ws, requested);
  if (!resolved) return c.json({ error: "Invalid path" }, 400);
  if (resolved.rel === "") {
    return c.json({ error: "Cannot delete workspace root" }, 400);
  }
  if (!existsSync(resolved.abs)) {
    return c.json({ error: "Path does not exist" }, 404);
  }
  const st = statSync(resolved.abs);
  if (st.isDirectory()) {
    const entries = await readdir(resolved.abs);
    if (entries.length > 0) {
      return c.json({ error: "Folder is not empty" }, 400);
    }
    await rm(resolved.abs, { recursive: false });
  } else {
    await rm(resolved.abs);
  }
  return c.body(null, 204);
});

// ─── Folder create ─────────────────────────────────────────────────────────

workspacesRoute.post("/:id/folder", async (c) => {
  if (!isEnabled()) return c.json(disabledError(), 403);
  const ws = ensureWorkspace(c.req.param("id"));
  if (!ws) return c.json({ error: "Workspace not found" }, 404);
  const requested = c.req.query("path") ?? "";
  if (!requested) return c.json({ error: "path is required" }, 400);
  const resolved = await resolveSafe(ws, requested);
  if (!resolved) return c.json({ error: "Invalid path" }, 400);
  if (existsSync(resolved.abs)) {
    return c.json({ error: "Path already exists" }, 409);
  }
  await mkdir(resolved.abs, { recursive: true });
  return c.json({ path: resolved.rel }, 201);
});

// ─── Move / rename ─────────────────────────────────────────────────────────

const moveBody = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});

workspacesRoute.post("/:id/move", async (c) => {
  if (!isEnabled()) return c.json(disabledError(), 403);
  const ws = ensureWorkspace(c.req.param("id"));
  if (!ws) return c.json({ error: "Workspace not found" }, 404);
  const parsed = moveBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Bad input" }, 400);
  }
  const from = await resolveSafe(ws, parsed.data.from);
  const to = await resolveSafe(ws, parsed.data.to);
  if (!from || !to) return c.json({ error: "Invalid path" }, 400);
  if (from.rel === "") return c.json({ error: "Cannot move workspace root" }, 400);
  if (!existsSync(from.abs)) return c.json({ error: "Source does not exist" }, 404);
  if (existsSync(to.abs)) return c.json({ error: "Destination already exists" }, 409);
  await mkdir(path.dirname(to.abs), { recursive: true });
  await rename(from.abs, to.abs);
  return c.json({ from: from.rel, to: to.rel });
});

// ─── Git ───────────────────────────────────────────────────────────────────

workspacesRoute.get("/:id/git", async (c) => {
  const ws = ensureWorkspace(c.req.param("id"));
  if (!ws) return c.json({ error: "Workspace not found" }, 404);
  let root: string;
  try {
    root = await realpath(ws.folderPath);
  } catch {
    return c.json({ rootIsRepo: false });
  }
  const info = await probeGit(root);
  return c.json(info);
});
