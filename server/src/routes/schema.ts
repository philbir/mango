import { Hono } from "hono";
import { databaseNameFor, getMongoClientFor } from "../config.js";
import { sampleCollectionSchema } from "../schema-sampling.js";

export const schemaRoute = new Hono();

schemaRoute.get("/:name/schema", async (c) => {
  const cid = c.req.param("cid")!;
  const name = c.req.param("name");
  const sampleParam = Number(c.req.query("sample") ?? 50);
  const sample = Math.min(
    Math.max(1, Number.isFinite(sampleParam) ? sampleParam : 50),
    200,
  );

  const { client } = await getMongoClientFor(cid);
  const dbName = databaseNameFor(cid, c.req.query("database"));
  const db = client.db(dbName);
  const { docs, fields } = await sampleCollectionSchema(db, name, sample);

  return c.json({ collection: name, sampleSize: docs, fields });
});
