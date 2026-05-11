import { Binary, ObjectId, UUID } from "bson";
import { Hono } from "hono";
import type { Sort } from "mongodb";
import { z } from "zod";
import { config, databaseNameFor, getMongoClientFor } from "../config.js";
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
    .find(filter, { projection, maxTimeMS: config.mongoMaxTimeMS })
    .sort(sort as Sort)
    .skip(skip)
    .limit(limit);
  const [docs, total] = await Promise.all([
    cursor.toArray(),
    collection.countDocuments(filter, { maxTimeMS: config.mongoMaxTimeMS }),
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

/** Rearrange standard UUID bytes to CSUUID (C# Guid) byte order. */
const uuidToCsUuidBytes = (uuidStr: string): Buffer => {
  const hex = uuidStr.replace(/-/g, "");
  const b = Buffer.from(hex, "hex");
  return Buffer.from([
    b.readUInt8(3), b.readUInt8(2), b.readUInt8(1), b.readUInt8(0),
    b.readUInt8(5), b.readUInt8(4),
    b.readUInt8(7), b.readUInt8(6),
    b.readUInt8(8), b.readUInt8(9), b.readUInt8(10), b.readUInt8(11), b.readUInt8(12), b.readUInt8(13), b.readUInt8(14), b.readUInt8(15),
  ]);
};

const buildIdCandidates = (id: string): Array<Record<string, unknown>> => {
  const candidates: Array<Record<string, unknown>> = [{ _id: id }];
  if (ObjectId.isValid(id) && /^[0-9a-fA-F]{24}$/.test(id)) {
    candidates.push({ _id: new ObjectId(id) });
  }
  if (UUID_RE.test(id)) {
    try {
      // subType 04 — standard UUID
      candidates.push({ _id: new UUID(id) });
    } catch {
      /* ignore */
    }
    try {
      // subType 03 — CSUUID (C# byte order)
      candidates.push({ _id: new Binary(uuidToCsUuidBytes(id), Binary.SUBTYPE_UUID_OLD) });
    } catch {
      /* ignore */
    }
    try {
      // subType 03 — standard byte order (JUUID / PyUUID)
      const stdBytes = Buffer.from(id.replace(/-/g, ""), "hex");
      candidates.push({ _id: new Binary(stdBytes, Binary.SUBTYPE_UUID_OLD) });
    } catch {
      /* ignore */
    }
  }
  return candidates;
};

const binaryToUuidString = (bin: Binary): string | null => {
  const hex = bin.toString("hex");
  if (hex.length !== 32) return null;
  if (bin.sub_type === Binary.SUBTYPE_UUID || bin.sub_type === 4) {
    // subType 04 — standard byte order
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32),
    ].join("-");
  }
  if (bin.sub_type === Binary.SUBTYPE_UUID_OLD || bin.sub_type === 3) {
    // subType 03 — return the CSUUID-decoded UUID (matches what the client sends)
    const bytes = hex.match(/.{2}/g)!.map((h) => parseInt(h, 16));
    const cs = [bytes[3]!, bytes[2]!, bytes[1]!, bytes[0]!, bytes[5]!, bytes[4]!, bytes[7]!, bytes[6]!, ...bytes.slice(8)];
    const csHex = cs.map((b) => b.toString(16).padStart(2, "0")).join("");
    return [
      csHex.slice(0, 8),
      csHex.slice(8, 12),
      csHex.slice(12, 16),
      csHex.slice(16, 20),
      csHex.slice(20, 32),
    ].join("-");
  }
  return null;
};

const matchesId = (value: unknown, urlId: string): boolean => {
  if (typeof value === "string") return value === urlId;
  if (value instanceof ObjectId) return value.toHexString() === urlId;
  if (value instanceof UUID) return value.toString() === urlId.toLowerCase();
  if (value instanceof Binary) {
    const lc = urlId.toLowerCase();
    if (value.sub_type === Binary.SUBTYPE_UUID || value.sub_type === 4) {
      const asUuid = binaryToUuidString(value);
      return asUuid !== null && asUuid === lc;
    }
    if (value.sub_type === Binary.SUBTYPE_UUID_OLD || value.sub_type === 3) {
      // Accept either CSUUID-decoded or standard-byte-order UUID string from client
      const hex = value.toString("hex");
      if (hex.length !== 32) return false;
      const bytes = hex.match(/.{2}/g)!.map((h) => parseInt(h, 16));
      const cs = [bytes[3]!, bytes[2]!, bytes[1]!, bytes[0]!, bytes[5]!, bytes[4]!, bytes[7]!, bytes[6]!, ...bytes.slice(8)];
      const csHex = cs.map((b) => b.toString(16).padStart(2, "0")).join("");
      const csUuid = [csHex.slice(0, 8), csHex.slice(8, 12), csHex.slice(12, 16), csHex.slice(16, 20), csHex.slice(20, 32)].join("-");
      const jUuid = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join("-");
      return csUuid === lc || jUuid === lc;
    }
    return false;
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("$oid" in obj) return obj.$oid === urlId;
  }
  return false;
};
