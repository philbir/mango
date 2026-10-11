import { createRequire } from "node:module";
import * as esm from "bson";
import { describe, expect, it } from "vitest";
import { detectType, truncatedExample } from "../src/schema-sampling.js";

// The driver loads bson's CJS build while our source imports the ESM one —
// two class identities. Sampled values must be typed either way.
const cjs = createRequire(import.meta.url)("bson") as typeof esm;

describe.each([
  ["esm", esm],
  ["cjs (driver)", cjs],
])("schema sampling with %s bson", (_label, bson) => {
  it("types ObjectIds and shows their hex", () => {
    const id = new bson.ObjectId("6acb7ef0a48ad4bb01c821eb");
    expect(detectType(id)).toBe("objectId");
    expect(truncatedExample(id)).toBe("6acb7ef0a48ad4bb01c821eb");
  });

  it("types subtype-4 binaries as uuid", () => {
    const uuid = "3f0c1b2a-4d5e-4f60-8a7b-9c0d1e2f3a4b";
    for (const value of [new bson.UUID(uuid), new bson.Binary(new bson.UUID(uuid).buffer, 4)]) {
      expect(detectType(value)).toBe("uuid");
      expect(truncatedExample(value)).toBe(uuid);
    }
  });

  it("keeps other binaries and decimals distinct", () => {
    expect(detectType(new bson.Binary(new Uint8Array([1, 2, 3]), 0))).toBe("binary");
    expect(detectType(bson.Decimal128.fromString("1.5"))).toBe("decimal");
  });
});
