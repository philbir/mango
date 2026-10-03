import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { injectBasePath, mountAtBasePath, normalizeBasePath } from "../src/basePath.js";

describe("normalizeBasePath", () => {
  it.each([
    [undefined, ""],
    ["", ""],
    ["/", ""],
    ["  ", ""],
    ["/mongo", "/mongo"],
    ["mongo/", "/mongo"],
    ["//tools//mongo//", "/tools/mongo"],
  ])("%j → %j", (raw, expected) => {
    expect(normalizeBasePath(raw)).toBe(expected);
  });

  it.each(["/mongo?x=1", "/mongo#a", "/../etc", "/a/./b", "\\mongo"])("rejects %j", (raw) => {
    expect(() => normalizeBasePath(raw)).toThrow(/MANGO_BASE_PATH/);
  });
});

describe("injectBasePath", () => {
  const html = '<!doctype html><html><head>\n<meta charset="UTF-8" /><script src="./assets/a.js"></script></head></html>';

  it("puts base + global first in <head>", () => {
    const out = injectBasePath(html, "/mongo");
    expect(out).toContain(
      '<head><base href="/mongo/"><script>window.__MANGO_BASE__ = "/mongo";</script>\n<meta charset',
    );
  });

  it("injects root values when no base path is set", () => {
    const out = injectBasePath(html, "");
    expect(out).toContain('<base href="/"><script>window.__MANGO_BASE__ = "";</script>');
  });

  it("escapes the value in both contexts", () => {
    const out = injectBasePath(html, '/a"</script><x>');
    expect(out).toContain('<base href="/a&#34;&#60;/script&#62;&#60;x&#62;/">');
    expect(out).toContain('window.__MANGO_BASE__ = "/a\\"\\u003c/script>\\u003cx>";');
  });
});

describe("mountAtBasePath", () => {
  const app = new Hono();
  app.get("/api/health", (c) => c.json({ ok: true }));
  app.get("*", (c) => c.text(`spa ${c.req.path}`));

  it("returns the app unchanged at root", () => {
    expect(mountAtBasePath(app, "")).toBe(app);
  });

  it("serves routes under the prefix and nothing outside it", async () => {
    const root = mountAtBasePath(app, "/mongo");
    expect((await root.request("/mongo/api/health")).status).toBe(200);
    expect(await (await root.request("/mongo/")).text()).toBe("spa /mongo/");
    expect(await (await root.request("/mongo/x/y")).text()).toBe("spa /mongo/x/y");
    expect((await root.request("/api/health")).status).toBe(404);
    expect((await root.request("/mongoose")).status).toBe(404);
  });

  it("redirects the bare prefix to the trailing-slash form", async () => {
    const res = await mountAtBasePath(app, "/mongo").request("/mongo?a=1");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/mongo/?a=1");
  });
});

// Regression guard: every root-relative "/api/..." or "/assets/..." URL in the
// UI has to go through withBase() (ui/src/api/base.ts), or it escapes the
// MANGO_BASE_PATH prefix. client.ts is exempt because all its requests go
// through apiFetch(), which prefixes — so it must not call fetch() directly.
describe("UI base-path guard", () => {
  const uiRoot = path.resolve(__dirname, "../../ui");
  const uiSrc = path.join(uiRoot, "src");
  const files = (readdirSync(uiSrc, { recursive: true }) as string[])
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .map((f) => path.join(uiSrc, f));
  const isComment = (line: string) => /^\s*(\/\/|\/?\*)/.test(line);
  const rootUrl = /["'`]\/(api|assets)\//;

  it("finds the UI sources", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("wraps root URLs in withBase() outside api/client.ts", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(uiRoot, file);
      if (rel === path.join("src", "api", "client.ts")) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (!isComment(line) && rootUrl.test(line) && !/\bwithBase\b/.test(line)) {
            offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  it("api/client.ts only fetches through apiFetch()", () => {
    const lines = readFileSync(path.join(uiSrc, "api", "client.ts"), "utf8")
      .split("\n")
      .filter((line) => !isComment(line) && /(?<![\w.])fetch\(/.test(line));
    expect(lines).toEqual(["  fetch(withBase(path), init);"]);
  });

  it("index.html has no root-relative asset links", () => {
    expect(readFileSync(path.join(uiRoot, "index.html"), "utf8")).not.toMatch(/(href|src)="\/assets\//);
  });
});
