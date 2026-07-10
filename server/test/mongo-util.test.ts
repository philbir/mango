import type { Collection, Document } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { countForListing } from "../src/mongo-util.js";

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
});
