import { Hono } from "hono";
import { z } from "zod";
import { databaseNameFor, getMongoClientFor } from "../config.js";
import { getProvider } from "../providers/index.js";
import {
  renderSchemaForPrompt,
  sampleCollectionSchema,
} from "../schema-sampling.js";

export const aiRoute = new Hono();

const queryBody = z.object({
  connectionId: z.string().min(1),
  collection: z.string().min(1),
  prompt: z.string().min(1).max(2000),
  model: z.string().optional(),
  database: z.string().optional(),
});

aiRoute.get("/status", (c) => {
  const provider = getProvider();
  return c.json({
    provider: provider.name,
    configured: provider.configured,
    model: provider.model,
    baseUrl: provider.baseUrl,
    setupHint: provider.setupHint,
  });
});

aiRoute.get("/models", async (c) => {
  const provider = getProvider();
  if (!provider.configured) {
    return c.json({ provider: provider.name, default: provider.model, models: [] });
  }
  try {
    const models = await provider.listModels();
    return c.json({
      provider: provider.name,
      default: provider.model,
      models,
    });
  } catch (e) {
    return c.json(
      {
        provider: provider.name,
        default: provider.model,
        models: [],
        error: e instanceof Error ? e.message : String(e),
      },
      200,
    );
  }
});

aiRoute.post("/query", async (c) => {
  const provider = getProvider();
  if (!provider.configured) {
    return c.json(
      { error: `AI (${provider.name}) is not configured. ${provider.setupHint}` },
      503,
    );
  }

  const parsed = queryBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Bad input" }, 400);
  }

  const { client } = await getMongoClientFor(parsed.data.connectionId);
  const dbName = databaseNameFor(parsed.data.connectionId, parsed.data.database);
  const db = client.db(dbName);

  let schemaText = "";
  try {
    const schema = await sampleCollectionSchema(db, parsed.data.collection, 30);
    schemaText = renderSchemaForPrompt(schema.fields);
  } catch (e) {
    return c.json(
      {
        error: `Could not sample schema: ${e instanceof Error ? e.message : String(e)}`,
      },
      400,
    );
  }

  try {
    const result = await provider.query({
      collection: parsed.data.collection,
      prompt: parsed.data.prompt,
      schemaText,
      model: parsed.data.model,
    });
    return c.json({ ...result, provider: provider.name });
  } catch (e) {
    return c.json(
      { error: `AI request failed: ${e instanceof Error ? e.message : String(e)}` },
      502,
    );
  }
});
