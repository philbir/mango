import type { Collection, Document } from "mongodb";

/**
 * Count documents for a paged listing without putting a full scan on the
 * collection when we don't have to.
 *
 * The common case — opening a collection or bucket with no query — has an empty
 * filter. `countDocuments({})` is implemented by the driver as an aggregation
 * (`$match` → `$group $sum`) that walks every document: O(n), and on a
 * multi-million-doc collection it dominates the request and can trip
 * `maxTimeMS`. `estimatedDocumentCount()` instead reads the collection's cached
 * metadata in O(1).
 *
 * So: when there's no filter, use the fast estimate; only fall back to the
 * exact (scanning) count when a real filter is present, where correctness
 * demands it and the filter itself usually narrows the scan.
 */
export const countForListing = (
  collection: Collection<Document>,
  filter: Record<string, unknown>,
  maxTimeMS: number,
): Promise<number> => {
  const hasFilter = Object.keys(filter).length > 0;
  return hasFilter
    ? collection.countDocuments(filter, { maxTimeMS })
    : collection.estimatedDocumentCount({ maxTimeMS });
};
