import { describe, expect, it } from "vitest";
import { allowTopLevelAwait, splitScript } from "../src/console-script.js";

describe("splitScript", () => {
  it("runs use / show lines as their own steps", () => {
    expect(splitScript("use admin\ndb.getName()")).toEqual([
      { code: "use admin", shellCommand: true },
      { code: "db.getName()", shellCommand: false },
    ]);
    expect(splitScript("const a = 1\nshow collections;\na")).toEqual([
      { code: "const a = 1", shellCommand: false },
      { code: "show collections", shellCommand: true },
      { code: "a", shellCommand: false },
    ]);
    expect(splitScript("show log global")).toEqual([
      { code: "show log global", shellCommand: true },
    ]);
  });

  it("leaves code alone when there is no shell command", () => {
    const code = "const n = 5;\ndb.users.find({ age: { $gt: n } })";
    expect(splitScript(code)).toEqual([{ code, shellCommand: false }]);
  });

  it("doesn't split inside an unfinished statement", () => {
    // `show x` here is part of a template string, not a command.
    const code = "const s = `\nshow collections\n`;\ns";
    expect(splitScript(code)).toEqual([{ code, shellCommand: false }]);
  });

  it("treats `use` as an identifier when it isn't a whole command line", () => {
    const code = "const use = 1\nuse + 1";
    expect(splitScript(code)).toEqual([{ code, shellCommand: false }]);
  });
});

describe("allowTopLevelAwait", () => {
  it("leaves scripts without top-level await unchanged", () => {
    const code = "db.users.find()";
    expect(allowTopLevelAwait(code)).toBe(code);
    const fnOnly = "const f = async () => { await db.x.findOne() };\nf";
    expect(allowTopLevelAwait(fnOnly)).toBe(fnOnly);
  });

  it("wraps top-level await in an async function returning the last expression", () => {
    expect(allowTopLevelAwait("const r = await Promise.resolve(1);\nr;")).toBe(
      "(async () => {\nconst r = await Promise.resolve(1);\nreturn (r);\n})()",
    );
  });

  it("handles for await and keeps trailing comments outside the return", () => {
    expect(allowTopLevelAwait("for await (const d of c) {}\nx // done")).toBe(
      "(async () => {\nfor await (const d of c) {}\nreturn (x); // done\n})()",
    );
  });

  it("doesn't return when the last statement is a declaration", () => {
    expect(allowTopLevelAwait("const r = await p")).toBe("(async () => {\nconst r = await p\n})()");
  });

  it("passes code that doesn't parse through for mongosh to report", () => {
    expect(allowTopLevelAwait("await (")).toBe("await (");
  });
});
