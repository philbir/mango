import { EJSON } from "bson";
import { MongoClient } from "mongodb";
import { afterAll, describe, expect, it, vi } from "vitest";
import { type ConsoleLog, evaluateConsole } from "../src/mongosh-console.js";

// Never connected: these scripts don't touch the server, so the evaluator is
// exercised without a database. Port 9 (discard) fails fast if one ever does.
const client = new MongoClient("mongodb://127.0.0.1:9/?serverSelectionTimeoutMS=200");
afterAll(() => client.close());

const run = async (code: string) => {
  const logs: ConsoleLog[] = [];
  const out = await evaluateConsole({
    client,
    database: "acme",
    code,
    skip: 0,
    limit: 100,
    logs,
    signal: new AbortController().signal,
    readTimeoutMS: 1000,
    syncTimeoutMS: 500,
  });
  return { ...out, logs };
};

const ejson = (value: unknown) => EJSON.stringify(value, { relaxed: false });

describe("evaluateConsole (mongosh runtime)", () => {
  it("evaluates plain JavaScript", async () => {
    expect((await run("let n = 0; for (const x of [1, 2, 3]) n += x; n")).result).toBe(6);
  });

  it("knows the selected database and switches with `use`", async () => {
    expect((await run("db.getName()")).result).toBe("acme");
    const r = await run("use admin\ndb.getName()");
    expect(r.result).toBe("admin");
    expect(r.logs).toEqual([{ level: "log", args: ["switched to db admin"] }]);
  });

  it("provides mongosh's BSON constructors, with or without `new`", async () => {
    expect(ejson((await run(`ObjectId("6acb7ef0a48ad4bb01c821eb")`)).result)).toBe(
      '{"$oid":"6acb7ef0a48ad4bb01c821eb"}',
    );
    expect(ejson((await run(`new UUID("3f0c1b2a-4d5e-4f60-8a7b-9c0d1e2f3a4b")`)).result)).toBe(
      '{"$binary":{"base64":"PwwbKk1eT2CKe5wNHi86Sw==","subType":"04"}}',
    );
    expect(ejson((await run(`NumberLong("9007199254740993")`)).result)).toBe(
      '{"$numberLong":"9007199254740993"}',
    );
    expect(ejson((await run(`HexData(0, "00ff")`)).result)).toBe(
      '{"$binary":{"base64":"AP8=","subType":"00"}}',
    );
  });

  it("adds the legacy UUID helpers with the same byte order as the filter editor", async () => {
    const uuid = "00112233-4455-6677-8899-aabbccddeeff";
    const hex = async (ctor: string) =>
      Buffer.from(
        (EJSON.serialize((await run(`${ctor}("${uuid}")`)).result as never) as {
          $binary: { base64: string };
        }).$binary.base64,
        "base64",
      ).toString("hex");
    expect(await hex("CSUUID")).toBe("33221100554477668899aabbccddeeff");
    expect(await hex("JUUID")).toBe("7766554433221100ffeeddccbbaa9988");
    expect(await hex("PYUUID")).toBe("00112233445566778899aabbccddeeff");
  });

  it("captures print / console output with levels", async () => {
    const r = await run(`print("a", 1); console.warn("careful"); printjson({ x: 1 })`);
    expect(r.logs).toEqual([
      { level: "log", args: ["a", 1] },
      { level: "warn", args: ["careful"] },
      { level: "log", args: [{ x: 1 }] },
    ]);
  });

  it("accepts top-level await", async () => {
    expect((await run("const r = await Promise.all([1, 2].map(async (x) => x * 2));\nr")).result)
      .toEqual([2, 4]);
  });

  it("stops runaway synchronous code", async () => {
    await expect(run("while (true) {}")).rejects.toThrow(/timed out/);
  });

  it("never closes the shared client", async () => {
    const close = vi.spyOn(client, "close");
    await expect(run("quit()")).rejects.toThrow(/not available in the console/);
    await run("db.getMongo().close(); 1");
    expect(close).not.toHaveBeenCalled();
    close.mockRestore();
  });

  it("doesn't leak topology listeners on the shared client", async () => {
    const before = client.listenerCount("topologyDescriptionChanged");
    await run("1");
    await run("2");
    expect(client.listenerCount("topologyDescriptionChanged")).toBe(before);
  });
});
