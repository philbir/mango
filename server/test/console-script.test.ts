import { describe, expect, it } from "vitest";
import { prepareConsoleScript } from "../src/console-script.js";

describe("prepareConsoleScript", () => {
  it("returns a single expression, awaiting db calls", () => {
    expect(prepareConsoleScript("db.users.countDocuments()")).toBe(
      "return ((await db.users.countDocuments()))",
    );
  });

  it("returns the last expression of a multi-statement script", () => {
    expect(prepareConsoleScript("const n = 5;\nn * 2")).toBe(
      "const n = 5;\nreturn (n * 2)",
    );
  });

  it("does not return when the last statement is a declaration", () => {
    expect(prepareConsoleScript("const x = 1;")).toBe("const x = 1;");
  });

  it("awaits the outermost call of a db chain only", () => {
    expect(
      prepareConsoleScript("const a = db.users.find({}).limit(2).toArray();"),
    ).toBe("const a = (await db.users.find({}).limit(2).toArray());");
  });

  it("awaits calls on aliases but not inside non-async callbacks", () => {
    expect(prepareConsoleScript("c.forEach(d => print(d));\nlet x = f();")).toBe(
      "(await c.forEach(d => print(d)));\nlet x = (await f());",
    );
  });

  it("keeps parens balanced for a parenthesized last expression", () => {
    expect(prepareConsoleScript("const a = 1;\n({ a })")).toBe(
      "const a = 1;\nreturn (({ a }))",
    );
  });

  it("leaves explicit awaits alone", () => {
    expect(prepareConsoleScript("const n = await db.users.countDocuments();")).toBe(
      "const n = await db.users.countDocuments();",
    );
  });

  it("does not insert await inside non-async functions", () => {
    const src = "function f() { return db.users.findOne(); }";
    expect(prepareConsoleScript(src)).toBe(src);
  });

  it("inserts await inside async functions", () => {
    expect(
      prepareConsoleScript("async function f() { return db.users.findOne(); }"),
    ).toBe("async function f() { return (await db.users.findOne()); }");
  });

  it("reports syntax errors", () => {
    expect(() => prepareConsoleScript("const = 1")).toThrow(SyntaxError);
  });
});
