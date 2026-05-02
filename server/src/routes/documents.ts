import { Binary, ObjectId, UUID } from "bson";
import { Hono } from "hono";
import type { Sort } from "mongodb";
import { z } from "zod";
import { databaseNameFor, getMongoClientFor } from "../config.js";
import {
  FilterParseError,
  parseEJSON,
  parseFilter,
  stringifyEJSON,
} from "../ejson.js";

export const documentsRoute = new Hono();

const findBody = z.object({
  filter: z.string().optional(),
  sort: z.string().optional(),
  skip: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().max(500).optional(),
  projection: z.string().optional(),
});

documentsRoute.post("/:name/find", async (c) => {
  const cid = c.req.param("cid")!;
  const name = c.req.param("name");
  const body = findBody.parse(await c.req.json().catch(() => ({})));

  let filter: Record<string, unknown>;
  let sort: Record<string, unknown> = {};
  let projection: Record<string, unknown> | undefined;
  try {
    filter = parseFilter(body.filter);
    if (body.sort) {
      const parsed = parseEJSON(body.sort);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        sort = parsed as Record<string, unknown>;
      }
    }
    if (body.projection) {
      const parsed = parseEJSON(body.projection);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        projection = parsed as Record<string, unknown>;
      }
    }
  } catch (e) {
    if (e instanceof FilterParseError) {
      return c.json({ error: e.message }, 400);
    }
    throw e;
  }

  const skip = body.skip ?? 0;
  const limit = body.limit ?? 50;

  const { client } = await getMongoClientFor(cid);
  const dbName = databaseNameFor(cid, c.req.query("database"));
  const db = client.db(dbName);
  const collection = db.collection(name);

  const cursor = collection
    .find(filter, { projection })
    .sort(sort as Sort)
    .skip(skip)
    .limit(limit);
  const [docs, total] = await Promise.all([
    cursor.toArray(),
    collection.countDocuments(filter),
  ]);

  return c.body(
    stringifyEJSON({
      documents: docs,
      total,
      skip,
      limit,
      hasMore: skip + docs.length < total,
    }),
    200,
    { "content-type": "application/json; charset=utf-8" },
  );
});

documentsRoute.get("/:name/document/:id", async (c) => {
  const cid = c.req.param("cid")!;
  const name = c.req.param("name");
  const id = c.req.param("id");

  const { client } = await getMongoClientFor(cid);
  const dbName = databaseNameFor(cid, c.req.query("database"));
  const db = client.db(dbName);
  const collection = db.collection(name);

  const idCandidates = buildIdCandidates(id);
  const doc = await collection.findOne({ $or: idCandidates });

  if (!doc) {
    return c.json({ error: "Document not found" }, 404);
  }

  return c.body(stringifyEJSON({ document: doc }), 200, {
    "content-type": "application/json; charset=utf-8",
  });
});

documentsRoute.delete("/:name/document/:id", async (c) => {
  const cid = c.req.param("cid")!;
  const name = c.req.param("name");
  const id = c.req.param("id");

  const { client } = await getMongoClientFor(cid);
  const dbName = databaseNameFor(cid, c.req.query("database"));
  const db = client.db(dbName);
  const collection = db.collection(name);

  const idCandidates = buildIdCandidates(id);
  const result = await collection.deleteOne({ $or: idCandidates });

  if (result.deletedCount === 0) {
    return c.json({ error: "Document not found" }, 404);
  }
  return c.body(null, 204);
});

documentsRoute.put("/:name/document/:id", async (c) => {
  const cid = c.req.param("cid")!;
  const name = c.req.param("name");
  const id = c.req.param("id");

  const rawText = await c.req.text();
  let payload: unknown;
  try {
    payload = parseEJSON(rawText);
  } catch (e) {
    return c.json(
      { error: `Invalid EJSON body: ${e instanceof Error ? e.message : String(e)}` },
      400,
    );
  }

  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return c.json({ error: "Body must be a JSON object." }, 400);
  }

  const obj = payload as Record<string, unknown>;
  if (!("_id" in obj)) {
    return c.json({ error: "Document is missing _id." }, 400);
  }

  if (!matchesId(obj._id, id)) {
    return c.json(
      { error: "Body _id does not match URL id; _id is immutable." },
      400,
    );
  }

  const { client } = await getMongoClientFor(cid);
  const dbName = databaseNameFor(cid, c.req.query("database"));
  const db = client.db(dbName);
  const collection = db.collection(name);

  const idCandidates = buildIdCandidates(id);
  const result = await collection.replaceOne({ $or: idCandidates }, obj as object);

  if (result.matchedCount === 0) {
    return c.json({ error: "Document not found" }, 404);
  }

  const fresh = await collection.findOne({ $or: idCandidates });
  return c.body(stringifyEJSON({ document: fresh }), 200, {
    "content-type": "application/json; charset=utf-8",
  });
});

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const buildIdCandidates = (id: string): Array<Record<string, unknown>> => {
  const candidates: Array<Record<string, unknown>> = [{ _id: id }];
  if (ObjectId.isValid(id) && /^[0-9a-fA-F]{24}$/.test(id)) {
    candidates.push({ _id: new ObjectId(id) });
  }
  if (UUID_RE.test(id)) {
    try {
      candidates.push({ _id: new UUID(id) });
    } catch {
      /* ignore */
    }
  }
  return candidates;
};

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
