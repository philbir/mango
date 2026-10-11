import { MongoClient } from "mongodb";
import { afterAll, describe, expect, it } from "vitest";
import { completeConsole } from "../src/mongosh-autocomplete.js";

// Never connected (port 9, short selection timeout): collection / database /
// schema lookups fail, which must degrade to type-based completions rather
// than failing the request.
const client = new MongoClient("mongodb://127.0.0.1:9/?serverSelectionTimeoutMS=200");
afterAll(() => client.close());

const complete = (code: string) => completeConsole({ client, database: "acme", code });

describe("completeConsole (mongosh autocompleter)", () => {
  it("returns the word being typed and its replacements", async () => {
    const r = await complete("ObjectI");
    expect(r.replaceLength).toBe(7);
    expect(r.items).toContain("ObjectId");
  });

  it("completes cursor methods on a multi-line chain", async () => {
    const r = await complete('const n = 1\ndb.getCollection("orders").find({ a: n })\n  .so');
    expect(r).toEqual({ replaceLength: 2, items: ["sort"] });
  });

  it("completes aggregation stages and query operators", async () => {
    expect((await complete('db.getCollection("o").aggregate([{ $gro')).items).toEqual(["$group"]);
    // Field-level operators need the field's sampled type; top-level ones don't.
    expect((await complete('db.getCollection("o").find({ $an')).items).toContain("$and");
  });

  it("completes shell commands", async () => {
    expect((await complete("show c")).items).toEqual(["collections"]);
  });

  it("hides mongosh internals unless asked for", async () => {
    const methods = (await complete('db.getCollection("o").')).items;
    expect(methods).toContain("insertOne");
    expect(methods.some((m) => m.startsWith("_"))).toBe(false);
    const internals = (await complete('db.getCollection("o")._')).items;
    expect(internals.length).toBeGreaterThan(0);
    expect(internals.every((m) => m.startsWith("_"))).toBe(true);
  });
}, 30_000);
