import type { Collection, Document } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { countForListing, queryTimeoutSchema } from "../src/mongo-util.js";
import { infoRoute } from "../src/routes/info.js";
import { shellRoute } from "../src/routes/shell.js";

/**
 * The whole point of countForListing is to keep an empty-filter list from
 * putting a full-scan count on a large collection: no filter → the O(1)
 * estimatedDocumentCount, a real filter → the exact countDocuments.
 */
const mockCollection = (
  estimated: number,
  exact: number,
): {
  collection: Collection<Document>;
  estimatedDocumentCount: ReturnType<typeof vi.fn>;
  countDocuments: ReturnType<typeof vi.fn>;
} => {
  const estimatedDocumentCount = vi.fn().mockResolvedValue(estimated);
  const countDocuments = vi.fn().mockResolvedValue(exact);
  return {
    collection: { estimatedDocumentCount, countDocuments } as unknown as Collection<Document>,
    estimatedDocumentCount,
    countDocuments,
  };
};

describe("countForListing", () => {
  it("uses the fast estimate (no scan) for an empty filter", async () => {
    const { collection, estimatedDocumentCount, countDocuments } = mockCollection(
      42,
      99,
    );

    const total = await countForListing(collection, {}, 10_000);

    expect(total).toBe(42);
    expect(estimatedDocumentCount).toHaveBeenCalledOnce();
    expect(estimatedDocumentCount).toHaveBeenCalledWith({ maxTimeMS: 10_000 });
    expect(countDocuments).not.toHaveBeenCalled();
  });

  it("uses the exact count for a non-empty filter", async () => {
    const { collection, estimatedDocumentCount, countDocuments } = mockCollection(
      42,
      99,
    );
    const filter = { status: "paid" };

    const total = await countForListing(collection, filter, 10_000);

    expect(total).toBe(99);
    expect(countDocuments).toHaveBeenCalledOnce();
    expect(countDocuments).toHaveBeenCalledWith(filter, { maxTimeMS: 10_000 });
    expect(estimatedDocumentCount).not.toHaveBeenCalled();
  });

  it("passes cancellation to filtered counts", async () => {
    const { collection, countDocuments } = mockCollection(42, 99);
    const signal = new AbortController().signal;

    await countForListing(collection, { status: "paid" }, 60_000, signal);

    expect(countDocuments).toHaveBeenCalledWith(
      { status: "paid" },
      { maxTimeMS: 60_000, signal },
    );
  });
});

describe("queryTimeoutSchema", () => {
  it("accepts whole-millisecond timeouts up to one day and no override", () => {
    expect(queryTimeoutSchema.parse(undefined)).toBeUndefined();
    expect(queryTimeoutSchema.parse(60_000)).toBe(60_000);
    expect(queryTimeoutSchema.parse(86_400_000)).toBe(86_400_000);
  });

  it("rejects invalid or unbounded timeouts", () => {
    for (const value of [0, 999, 1_500.5, 86_400_001, "60000", Infinity]) {
      expect(queryTimeoutSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe("shell query timeout", () => {
  it("rejects invalid overrides before connecting to MongoDB", async () => {
    const response = await shellRoute.request("http://localhost/?timeoutMS=999", {
      method: "POST",
      body: '{"ping":1}',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid query timeout." });
  });
});

describe("explain query timeout", () => {
  it("rejects invalid overrides before connecting to MongoDB", async () => {
    const response = await infoRoute.request("http://localhost/docs/explain", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timeoutMS: 999 }),
    });

    expect(response.status).toBe(400);
  });
});
