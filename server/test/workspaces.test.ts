import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Each test run gets its own data dir + workspace folders so JsonFileStore
// state from a previous run can't leak in.
const dataRoot = mkdtempSync(path.join(os.tmpdir(), "mango-test-data-"));
process.env.MANGO_DATA_DIR = dataRoot;

// Imports below MUST come after MANGO_DATA_DIR is set — JsonFileStore reads it
// lazily per call so this is safe, but be explicit about the ordering.
const { workspacesRoute } = await import("../src/routes/workspaces.js");
const { probeGit } = await import("../src/git/probe.js");

const workspaceFolders: string[] = [];
const newWorkspaceFolder = (): string => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "mango-test-ws-"));
  workspaceFolders.push(dir);
  return dir;
};

const create = async (name: string, folderPath: string) => {
  const res = await workspacesRoute.request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, folderPath }),
  });
  return res;
};

afterAll(() => {
  for (const dir of workspaceFolders) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  try {
    rmSync(dataRoot, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe("POST /api/workspaces", () => {
  it("creates a workspace pointing at an existing folder", async () => {
    const dir = newWorkspaceFolder();
    const res = await create("Test", dir);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; name: string; folderPath: string };
    expect(body.name).toBe("Test");
    expect(body.folderPath).toBe(dir);
    expect(body.id).toBeTruthy();
  });

  it("rejects a non-existent folder", async () => {
    const res = await create("Bad", "/nonexistent/totally/missing");
    expect(res.status).toBe(400);
  });

  it("rejects a path that is a file, not a directory", async () => {
    const dir = newWorkspaceFolder();
    const file = path.join(dir, "notadir.txt");
    writeFileSync(file, "x");
    const res = await create("Bad", file);
    expect(res.status).toBe(400);
  });
});

describe("path safety", () => {
  let id = "";
  let dir = "";

  beforeAll(async () => {
    dir = newWorkspaceFolder();
    const res = await create("PathSafety", dir);
    id = ((await res.json()) as { id: string }).id;
  });

  it("rejects ../ traversal in tree", async () => {
    const res = await workspacesRoute.request(
      `/${id}/tree?path=${encodeURIComponent("../escape")}`,
    );
    expect(res.status).toBe(400);
  });

  it("rejects absolute paths", async () => {
    const res = await workspacesRoute.request(
      `/${id}/file?path=${encodeURIComponent("/etc/passwd")}`,
    );
    expect(res.status).toBe(400);
  });

  it("rejects access into .git internals", async () => {
    mkdirSync(path.join(dir, ".git"));
    writeFileSync(path.join(dir, ".git", "HEAD"), "ref: refs/heads/main");
    const res = await workspacesRoute.request(
      `/${id}/file?path=${encodeURIComponent(".git/HEAD")}`,
    );
    expect(res.status).toBe(400);
  });

  it("lists files in the root directory", async () => {
    writeFileSync(path.join(dir, "hello.md"), "# hi");
    const res = await workspacesRoute.request(`/${id}/tree?path=`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: Array<{ name: string; kind: string }> };
    expect(body.entries.some((e) => e.name === "hello.md" && e.kind === "file")).toBe(
      true,
    );
  });
});

describe("file write/read round-trip", () => {
  let id = "";

  beforeAll(async () => {
    const dir = newWorkspaceFolder();
    const res = await create("RW", dir);
    id = ((await res.json()) as { id: string }).id;
  });

  it("preserves bytes verbatim (no server-side parsing)", async () => {
    const raw = "---\nmango:\n  kind: query\n  collection: users\n---\n\n# Title\n\n```mongo\ndb.users.find()\n```\n";
    const put = await workspacesRoute.request(
      `/${id}/file?path=${encodeURIComponent("queries/users.md")}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ raw }),
      },
    );
    expect(put.status).toBe(200);
    const get = await workspacesRoute.request(
      `/${id}/file?path=${encodeURIComponent("queries/users.md")}`,
    );
    expect(get.status).toBe(200);
    const body = (await get.json()) as { raw: string; mtime: number };
    expect(body.raw).toBe(raw);
    expect(body.mtime).toBeGreaterThan(0);
  });

  it("rejects PUT with stale expectedMtime (409)", async () => {
    const p = encodeURIComponent("conflict.md");
    // Initial write
    const first = await workspacesRoute.request(`/${id}/file?path=${p}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ raw: "v1" }),
    });
    expect(first.status).toBe(200);

    // Second write without expectedMtime should pass…
    const second = await workspacesRoute.request(`/${id}/file?path=${p}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ raw: "v2" }),
    });
    expect(second.status).toBe(200);

    // …but a third write claiming the original mtime should 409.
    const stale = await workspacesRoute.request(`/${id}/file?path=${p}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ raw: "v3", expectedMtime: 1 }),
    });
    expect(stale.status).toBe(409);
  });
});

describe("move / rename", () => {
  let id = "";
  let dir = "";

  beforeAll(async () => {
    dir = newWorkspaceFolder();
    const res = await create("Move", dir);
    id = ((await res.json()) as { id: string }).id;
    writeFileSync(path.join(dir, "a.md"), "hi");
  });

  it("renames a file within the workspace", async () => {
    const res = await workspacesRoute.request(`/${id}/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: "a.md", to: "b.md" }),
    });
    expect(res.status).toBe(200);
    expect(statSync(path.join(dir, "b.md")).isFile()).toBe(true);
  });

  it("rejects a move that escapes the root", async () => {
    const res = await workspacesRoute.request(`/${id}/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: "b.md", to: "../escaped.md" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects move when destination already exists", async () => {
    writeFileSync(path.join(dir, "exists.md"), "x");
    const res = await workspacesRoute.request(`/${id}/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: "b.md", to: "exists.md" }),
    });
    expect(res.status).toBe(409);
  });
});

describe("git probe", () => {
  it("returns rootIsRepo:false for a non-repo folder", async () => {
    const dir = newWorkspaceFolder();
    const info = await probeGit(dir);
    expect(info.rootIsRepo).toBe(false);
  });

  it("returns repo info for an init'd folder", async () => {
    // Skip if `git` isn't available.
    const probe = spawnSync("git", ["--version"]);
    if (probe.status !== 0) return;
    const dir = newWorkspaceFolder();
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
    writeFileSync(path.join(dir, "README.md"), "hi");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
    const info = await probeGit(dir);
    expect(info.rootIsRepo).toBe(true);
    expect(info.branch).toBe("main");
    expect(info.shortSha).toMatch(/^[0-9a-f]{7,}$/);
    expect(info.dirty).toBe(false);
  });
});
