import { Binary, ObjectId, UUID } from "bson";
import { describe, expect, it } from "vitest";
import { stringifyEJSON } from "../src/ejson.js";

const binaryToUuidString = (bin: Binary): string | null => {
  if (bin.sub_type !== Binary.SUBTYPE_UUID && bin.sub_type !== 4) return null;
  const hex = bin.toString("hex");
  if (hex.length !== 32) return null;
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
};

const matchesId = (value: unknown, urlId: string): boolean => {
  if (typeof value === "string") return value === urlId;
  if (value instanceof ObjectId) return value.toHexString() === urlId;
  if (value instanceof UUID) return value.toString() === urlId.toLowerCase();
  if (value instanceof Binary) {
    const asUuid = binaryToUuidString(value);
    return asUuid !== null && asUuid === urlId.toLowerCase();
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("$oid" in obj) return obj.$oid === urlId;
  }
  return false;
};

describe("PUT _id immutability check", () => {
  const urlId = "507f1f77bcf86cd799439011";

  it("accepts matching ObjectId", () => {
    expect(matchesId(new ObjectId(urlId), urlId)).toBe(true);
  });

  it("accepts matching $oid extended-json form", () => {
    const ejsonText = stringifyEJSON({ _id: new ObjectId(urlId) });
    const parsedRaw = JSON.parse(ejsonText) as { _id: { $oid: string } };
    expect(matchesId(parsedRaw._id, urlId)).toBe(true);
  });

  it("accepts matching string id", () => {
    expect(matchesId(urlId, urlId)).toBe(true);
  });

  it("rejects mismatched ObjectId", () => {
    expect(matchesId(new ObjectId("507f1f77bcf86cd799439099"), urlId)).toBe(false);
  });

  it("rejects mismatched string", () => {
    expect(matchesId("other-id", urlId)).toBe(false);
  });

  it("accepts matching UUID instance (Binary subType 04)", () => {
    const uuidStr = "00000040-0000-0000-0000-000000000001";
    expect(matchesId(new UUID(uuidStr), uuidStr)).toBe(true);
  });

  it("rejects mismatched UUID", () => {
    expect(
      matchesId(
        new UUID("00000040-0000-0000-0000-000000000001"),
        "00000040-0000-0000-0000-000000000099",
      ),
    ).toBe(false);
  });
});
