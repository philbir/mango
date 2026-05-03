import { Hono } from "hono";
import { z } from "zod";
import { config, databaseNameFor, getMongoClientFor } from "../config.js";
import { parseEJSON, stringifyEJSON } from "../ejson.js";
import { redactErrorMessage } from "../security.js";

export const infoRoute = new Hono();

/** Collection-level stats — combines collStats + counts + index totals. */
infoRoute.get("/:name/stats", async (c) => {
  const cid = c.req.param("cid")!;
  const name = c.req.param("name");
  const { client } = await getMongoClientFor(cid);
  const dbName = databaseNameFor(cid, c.req.query("database"));
  const db = client.db(dbName);

  try {
    const stats = (await db.command({ collStats: name })) as Record<
      string,
      unknown
    >;
    const indexes = await db.collection(name).indexes();
    const indexCount = indexes.length;
    return new Response(
      stringifyEJSON({
        collection: name,
        database: dbName,
        count: stats.count ?? null,
        size: stats.size ?? null,
        avgObjSize: stats.avgObjSize ?? null,
        storageSize: stats.storageSize ?? null,
        totalIndexSize: stats.totalIndexSize ?? null,
        totalSize:
          typeof stats.size === "number" && typeof stats.totalIndexSize === "number"
            ? stats.size + stats.totalIndexSize
            : null,
        indexCount,
        capped: stats.capped ?? false,
        max: stats.max ?? null,
        sharded:
          (stats as { sharded?: unknown }).sharded === true ||
          !!(stats as { shards?: unknown }).shards,
        indexSizes: stats.indexSizes ?? {},
        // raw, in case the UI wants to dig deeper
        raw: stats,
      }),
      {
        headers: { "content-type": "application/json; charset=utf-8" },
      },
    );
  } catch (e) {
    return c.json(
      { error: `Could not load stats: ${redactErrorMessage(e)}` },
      400,
    );
  }
});

/** Indexes — listIndexes + $indexStats usage data when available. */
infoRoute.get("/:name/indexes", async (c) => {
  const cid = c.req.param("cid")!;
  const name = c.req.param("name");
  const { client } = await getMongoClientFor(cid);
  const dbName = databaseNameFor(cid, c.req.query("database"));
  const db = client.db(dbName);

  try {
    const coll = db.collection(name);
    const indexes = await coll.indexes();
    let usage: Record<string, { ops: number; since: unknown; host?: string }> = {};
    try {
      const stats = await coll
        .aggregate([{ $indexStats: {} }], { maxTimeMS: config.mongoMaxTimeMS })
        .toArray();
      for (const s of stats as Array<{
        name?: string;
        accesses?: { ops?: number; since?: unknown };
        host?: string;
      }>) {
        if (!s.name) continue;
        usage[s.name] = {
          ops: Number(s.accesses?.ops ?? 0),
          since: s.accesses?.since ?? null,
          host: s.host,
        };
      }
    } catch {
      // $indexStats can fail on some deployments (e.g. mongos without
      // permissions). The list itself is still useful.
      usage = {};
    }

    const enriched = indexes.map((ix) => ({
      name: ix.name,
      key: ix.key,
      unique: !!ix.unique,
      sparse: !!ix.sparse,
      hidden: !!(ix as { hidden?: unknown }).hidden,
      partialFilterExpression:
        (ix as { partialFilterExpression?: unknown }).partialFilterExpression ??
        null,
      expireAfterSeconds:
        (ix as { expireAfterSeconds?: unknown }).expireAfterSeconds ?? null,
      collation: (ix as { collation?: unknown }).collation ?? null,
      v: (ix as { v?: unknown }).v ?? null,
      ops: ix.name ? usage[ix.name]?.ops ?? null : null,
      since: ix.name ? usage[ix.name]?.since ?? null : null,
    }));

    return new Response(
      stringifyEJSON({
        collection: name,
        database: dbName,
        indexes: enriched,
        usageAvailable: Object.keys(usage).length > 0,
      }),
      {
        headers: { "content-type": "application/json; charset=utf-8" },
      },
    );
  } catch (e) {
    return c.json(
      { error: `Could not list indexes: ${redactErrorMessage(e)}` },
      400,
    );
  }
});

const explainBody = z.object({
  filter: z.string().optional(),
  projection: z.string().optional(),
  sort: z.string().optional(),
  limit: z.number().int().nonnegative().optional(),
  skip: z.number().int().nonnegative().optional(),
  pipeline: z.string().optional(),
  verbosity: z
    .enum(["queryPlanner", "executionStats", "allPlansExecution"])
    .default("executionStats"),
});

const parseEjsonOrEmpty = (text: string | undefined): unknown => {
  if (!text) return undefined;
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return parseEJSON(trimmed);
};

/** Run explain() on a find or aggregate and return the plan + execution stats. */
infoRoute.post("/:name/explain", async (c) => {
  const cid = c.req.param("cid")!;
  const name = c.req.param("name");
  const parsed = explainBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Bad input" }, 400);
  }

  const { client } = await getMongoClientFor(cid);
  const dbName = databaseNameFor(cid, c.req.query("database"));
  const db = client.db(dbName);
  const coll = db.collection(name);

  try {
    let result: unknown;
    if (parsed.data.pipeline) {
      const pipeline = parseEjsonOrEmpty(parsed.data.pipeline);
      if (!Array.isArray(pipeline)) {
        return c.json({ error: "pipeline must be a JSON array" }, 400);
      }
      result = await coll
        .aggregate(pipeline as Record<string, unknown>[], {
          maxTimeMS: config.mongoMaxTimeMS,
        })
        .explain(parsed.data.verbosity);
    } else {
      const filter = (parseEjsonOrEmpty(parsed.data.filter) ?? {}) as Record<
        string,
        unknown
      >;
      const sort = parseEjsonOrEmpty(parsed.data.sort) as
        | Record<string, 1 | -1>
        | undefined;
      const projection = parseEjsonOrEmpty(parsed.data.projection) as
        | Record<string, 0 | 1>
        | undefined;
      let cursor = coll.find(filter, {
        projection,
        sort,
        maxTimeMS: config.mongoMaxTimeMS,
      });
      if (parsed.data.skip) cursor = cursor.skip(parsed.data.skip);
      if (parsed.data.limit) cursor = cursor.limit(parsed.data.limit);
      result = await cursor.explain(parsed.data.verbosity);
    }
    return new Response(stringifyEJSON({ collection: name, explain: result }), {
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    return c.json(
      { error: `Explain failed: ${redactErrorMessage(e)}` },
      400,
    );
  }
});

const dropBody = z.object({
  name: z.string().min(1),
});

/** Drop an index by name. */
infoRoute.post("/:name/indexes/drop", async (c) => {
  const cid = c.req.param("cid")!;
  const collection = c.req.param("name");
  const parsed = dropBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Bad input" }, 400);
  }
  if (parsed.data.name === "_id_") {
    return c.json({ error: "Cannot drop the _id_ index." }, 400);
  }
  const { client } = await getMongoClientFor(cid);
  const dbName = databaseNameFor(cid, c.req.query("database"));
  const db = client.db(dbName);
  try {
    await db.collection(collection).dropIndex(parsed.data.name);
    return c.json({ ok: true });
  } catch (e) {
    return c.json(
      { error: `Drop failed: ${redactErrorMessage(e)}` },
      400,
    );
  }
});

const createIndexBody = z.object({
  keys: z.record(z.string(), z.union([z.literal(1), z.literal(-1), z.string()])),
  options: z
    .object({
      name: z.string().optional(),
      unique: z.boolean().optional(),
      sparse: z.boolean().optional(),
      partialFilterExpression: z.record(z.string(), z.unknown()).optional(),
      expireAfterSeconds: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

/** Create an index. */
infoRoute.post("/:name/indexes/create", async (c) => {
  const cid = c.req.param("cid")!;
  const collection = c.req.param("name");
  const parsed = createIndexBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Bad input" }, 400);
  }
  const { client } = await getMongoClientFor(cid);
  const dbName = databaseNameFor(cid, c.req.query("database"));
  const db = client.db(dbName);
  try {
    const name = await db
      .collection(collection)
      .createIndex(
        parsed.data.keys as Record<string, 1 | -1>,
        parsed.data.options ?? {},
      );
    return c.json({ ok: true, name });
  } catch (e) {
    return c.json(
      { error: `Create failed: ${redactErrorMessage(e)}` },
      400,
    );
  }
});
