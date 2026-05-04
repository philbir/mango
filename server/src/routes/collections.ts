import { Hono } from "hono";
import { databaseNameFor, getMongoClientFor } from "../config.js";
import { redactErrorMessage } from "../security.js";

export const collectionsRoute = new Hono();

collectionsRoute.get("/", async (c) => {
  const cid = c.req.param("cid")!;
  try {
    const { client } = await getMongoClientFor(cid);
    const dbName = databaseNameFor(cid, c.req.query("database"));
    const db = client.db(dbName);
    const cols = await db.listCollections({}, { nameOnly: false }).toArray();

    const counts = await Promise.all(
      cols.map(async (col) => {
        try {
          const count = await db.collection(col.name).estimatedDocumentCount();
          return { name: col.name, type: col.type ?? "collection", count };
        } catch {
          return { name: col.name, type: col.type ?? "collection", count: null };
        }
      }),
    );

    counts.sort((a, b) => a.name.localeCompare(b.name));

    return c.json({ database: db.databaseName, collections: counts });
  } catch (e) {
    return c.json(
      { error: `Could not list collections: ${redactErrorMessage(e)}` },
      500,
    );
  }
});

/** Drop a collection. */
collectionsRoute.post("/:name/drop", async (c) => {
  const cid = c.req.param("cid")!;
  const name = c.req.param("name");
  const { client } = await getMongoClientFor(cid);
  const dbName = databaseNameFor(cid, c.req.query("database"));
  const db = client.db(dbName);
  try {
    await db.collection(name).drop();
    return c.json({ ok: true });
  } catch (e) {
    return c.json(
      { error: `Drop failed: ${redactErrorMessage(e)}` },
      400,
    );
  }
});

/** Clear a collection (deleteMany({})). */
collectionsRoute.post("/:name/clear", async (c) => {
  const cid = c.req.param("cid")!;
  const name = c.req.param("name");
  const { client } = await getMongoClientFor(cid);
  const dbName = databaseNameFor(cid, c.req.query("database"));
  const db = client.db(dbName);
  try {
    const result = await db.collection(name).deleteMany({});
    return c.json({ ok: true, deletedCount: result.deletedCount });
  } catch (e) {
    return c.json(
      { error: `Clear failed: ${redactErrorMessage(e)}` },
      400,
    );
  }
});
