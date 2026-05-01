import { Decimal128, ObjectId } from "bson";
import { describe, expect, it } from "vitest";
import {
  FilterParseError,
  parseEJSON,
  parseFilter,
  stringifyEJSON,
} from "../src/ejson.js";

describe("EJSON round-trip", () => {
  it("preserves ObjectId, Date, and Decimal128 across stringify/parse", () => {
    const original = {
      _id: new ObjectId("507f1f77bcf86cd799439011"),
      createdAt: new Date("2026-05-01T12:00:00.000Z"),
      amount: Decimal128.fromString("123.45"),
      label: "hello",
    };

    const text = stringifyEJSON(original);
    const round = parseEJSON(text) as typeof original;

    expect(round._id).toBeInstanceOf(ObjectId);
    expect((round._id as ObjectId).toHexString()).toBe(
      "507f1f77bcf86cd799439011",
    );
    expect(round.createdAt).toBeInstanceOf(Date);
    expect((round.createdAt as Date).toISOString()).toBe(
      "2026-05-01T12:00:00.000Z",
    );
    expect(round.amount).toBeInstanceOf(Decimal128);
    expect((round.amount as Decimal128).toString()).toBe("123.45");
    expect(round.label).toBe("hello");
  });
});

describe("parseFilter", () => {
  it("returns empty object for blank input", () => {
    expect(parseFilter(undefined)).toEqual({});
    expect(parseFilter("")).toEqual({});
    expect(parseFilter("   ")).toEqual({});
  });

  it("parses a valid filter object", () => {
    expect(parseFilter('{"status":"Open"}')).toEqual({ status: "Open" });
  });

  it("throws FilterParseError on malformed JSON", () => {
    expect(() => parseFilter('{"status": ')).toThrow(FilterParseError);
  });

  it("throws FilterParseError when the filter is not an object", () => {
    expect(() => parseFilter("[1,2,3]")).toThrow(FilterParseError);
    expect(() => parseFilter('"hello"')).toThrow(FilterParseError);
  });
});
