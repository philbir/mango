import { Hono } from "hono";
import { databaseNameFor, getMongoClientFor } from "../config.js";

export const collectionsRoute = new Hono();

collectionsRoute.get("/", async (c) => {
  const cid = c.req.param("cid")!;
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
});
