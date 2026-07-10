// GridFS routes — discovery, listing, metadata, streaming download, delete.
//
// Buckets are detected by scanning collections for matching `.files`/`.chunks`
// pairs (default bucket name is `fs`, but anything is allowed). The wire
// format follows the rest of the API: EJSON canonical for metadata, raw bytes
// for the download stream.
import { Hono } from "hono";
import { Readable } from "node:stream";
import { GridFSBucket, ObjectId } from "mongodb";
import { config, databaseNameFor, getMongoClientFor } from "../config.js";
import { stringifyEJSON } from "../ejson.js";
import { countForListing } from "../mongo-util.js";
import { redactErrorMessage } from "../security.js";

export const gridfsRoute = new Hono();

const isFilesCollection = (name: string): string | null => {
  if (!name.endsWith(".files")) return null;
  return name.slice(0, -".files".length);
};

const parseObjectId = (raw: string): ObjectId | string => {
  // GridFS allows arbitrary _id types but the common case is ObjectId. We try
  // ObjectId first; on failure we fall back to the raw string so buckets that
  // use string IDs still resolve.
  if (/^[a-f0-9]{24}$/i.test(raw)) {
    try {
      return new ObjectId(raw);
    } catch {
      /* fall through */
    }
  }
  return raw;
};

/** List GridFS buckets in a database. */
gridfsRoute.get("/", async (c) => {
  const cid = c.req.param("cid")!;
  try {
    const { client } = await getMongoClientFor(cid);
    const dbName = databaseNameFor(cid, c.req.query("database"));
    const db = client.db(dbName);
    const cols = await db.listCollections({}, { nameOnly: true }).toArray();
    const names = new Set(cols.map((c) => c.name));
    const buckets: Array<{
      name: string;
      filesCollection: string;
      chunksCollection: string;
      fileCount: number | null;
    }> = [];

    for (const col of cols) {
      const bucket = isFilesCollection(col.name);
      if (!bucket) continue;
      const chunks = `${bucket}.chunks`;
      if (!names.has(chunks)) continue;
      let fileCount: number | null = null;
      try {
        fileCount = await db.collection(col.name).estimatedDocumentCount();
      } catch {
        /* leave null */
      }
      buckets.push({
        name: bucket,
        filesCollection: col.name,
        chunksCollection: chunks,
        fileCount,
      });
    }
    buckets.sort((a, b) => a.name.localeCompare(b.name));
    return new Response(stringifyEJSON({ database: dbName, buckets }), {
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    return c.json(
      { error: `Could not list buckets: ${redactErrorMessage(e)}` },
      500,
    );
  }
});

/** List files in a bucket. Supports search by filename substring + paging. */
gridfsRoute.get("/:bucket/files", async (c) => {
  const cid = c.req.param("cid")!;
  const bucketName = c.req.param("bucket");
  const search = (c.req.query("search") ?? "").trim();
  const skip = Math.max(0, Number(c.req.query("skip") ?? 0) || 0);
  const limit = Math.min(
    500,
    Math.max(1, Number(c.req.query("limit") ?? 100) || 100),
  );

  try {
    const { client } = await getMongoClientFor(cid);
    const dbName = databaseNameFor(cid, c.req.query("database"));
    const db = client.db(dbName);
    const filesColl = db.collection(`${bucketName}.files`);

    const filter: Record<string, unknown> = {};
    if (search) {
      filter.filename = {
        $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        $options: "i",
      };
    }

    const [total, files] = await Promise.all([
      countForListing(filesColl, filter, config.mongoMaxTimeMS),
      filesColl
        .find(filter, { maxTimeMS: config.mongoMaxTimeMS })
        .sort({ uploadDate: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
    ]);

    return new Response(
      stringifyEJSON({
        bucket: bucketName,
        database: dbName,
        total,
        skip,
        limit,
        hasMore: skip + files.length < total,
        files,
      }),
      { headers: { "content-type": "application/json; charset=utf-8" } },
    );
  } catch (e) {
    return c.json(
      { error: `Could not list files: ${redactErrorMessage(e)}` },
      500,
    );
  }
});

/** Single file's metadata document. */
gridfsRoute.get("/:bucket/files/:id", async (c) => {
  const cid = c.req.param("cid")!;
  const bucketName = c.req.param("bucket");
  const idRaw = c.req.param("id");
  try {
    const { client } = await getMongoClientFor(cid);
    const dbName = databaseNameFor(cid, c.req.query("database"));
    const db = client.db(dbName);
    const filesColl = db.collection(`${bucketName}.files`);
    const id = parseObjectId(idRaw);
    const doc = await filesColl.findOne({ _id: id as never });
    if (!doc) return c.json({ error: "File not found" }, 404);
    return new Response(stringifyEJSON({ file: doc }), {
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    return c.json(
      { error: `Could not load file: ${redactErrorMessage(e)}` },
      500,
    );
  }
});

/** Stream the file's bytes. `?inline=1` sets inline disposition so browsers
 * render images/PDFs in-place instead of triggering a download. */
gridfsRoute.get("/:bucket/download/:id", async (c) => {
  const cid = c.req.param("cid")!;
  const bucketName = c.req.param("bucket");
  const idRaw = c.req.param("id");
  const inline = c.req.query("inline") === "1" || c.req.query("inline") === "true";

  try {
    const { client } = await getMongoClientFor(cid);
    const dbName = databaseNameFor(cid, c.req.query("database"));
    const db = client.db(dbName);
    const filesColl = db.collection(`${bucketName}.files`);
    const id = parseObjectId(idRaw);
    const doc = (await filesColl.findOne({ _id: id as never })) as
      | {
          _id: unknown;
          filename?: string;
          length?: number;
          contentType?: string;
          metadata?: { contentType?: string };
        }
      | null;
    if (!doc) return c.json({ error: "File not found" }, 404);

    const bucket = new GridFSBucket(db, { bucketName });
    const stream = bucket.openDownloadStream(id as never);

    const filename = doc.filename ?? "file";
    const contentType =
      doc.contentType ?? doc.metadata?.contentType ?? "application/octet-stream";
    const encodedName = encodeURIComponent(filename);
    const disposition = `${inline ? "inline" : "attachment"}; filename="${filename.replace(
      /[\\"]/g,
      "_",
    )}"; filename*=UTF-8''${encodedName}`;

    const headers: Record<string, string> = {
      "content-type": contentType,
      "content-disposition": disposition,
      "cache-control": "private, no-store",
    };
    if (typeof doc.length === "number") {
      headers["content-length"] = String(doc.length);
    }

    return new Response(Readable.toWeb(stream) as ReadableStream, { headers });
  } catch (e) {
    return c.json(
      { error: `Could not download file: ${redactErrorMessage(e)}` },
      500,
    );
  }
});

/** Delete a file (and its chunks). */
gridfsRoute.delete("/:bucket/files/:id", async (c) => {
  const cid = c.req.param("cid")!;
  const bucketName = c.req.param("bucket");
  const idRaw = c.req.param("id");
  try {
    const { client } = await getMongoClientFor(cid);
    const dbName = databaseNameFor(cid, c.req.query("database"));
    const db = client.db(dbName);
    const bucket = new GridFSBucket(db, { bucketName });
    const id = parseObjectId(idRaw);
    await bucket.delete(id as never);
    return c.body(null, 204);
  } catch (e) {
    return c.json(
      { error: `Could not delete file: ${redactErrorMessage(e)}` },
      400,
    );
  }
});
