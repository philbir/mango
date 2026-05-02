import { Hono } from "hono";
import { z } from "zod";
import { config, databaseNameFor, getMongoClientFor } from "../config.js";
import { getProvider, invalidateProvider } from "../providers/index.js";
import { redactErrorMessage, validateAiBaseUrl } from "../security.js";
import {
  enrichWithDistinctValues,
  renderSchemaForPrompt,
  sampleCollectionSchema,
  sampleDatabaseSchema,
} from "../schema-sampling.js";
import {
  clearAiSettings,
  readAiSettings,
  writeAiSettings,
} from "../store/aiSettings.js";

export const aiRoute = new Hono();

const queryBody = z.object({
  connectionId: z.string().min(1),
  collection: z.string().min(1),
  prompt: z.string().min(1).max(2000),
  model: z.string().optional(),
  database: z.string().optional(),
});

const commandBody = z.object({
  connectionId: z.string().min(1),
  prompt: z.string().min(1).max(2000),
  model: z.string().optional(),
  database: z.string().optional(),
});

const configBody = z.object({
  provider: z.enum(["openai", "copilot", "claude-code"]),
  apiKey: z.string().nullable().optional(),
  baseUrl: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  allowDataSampling: z.boolean().optional(),
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

aiRoute.get("/config", (c) => {
  const stored = readAiSettings();
  return c.json({
    provider: stored?.provider ?? null,
    baseUrl: stored?.baseUrl ?? null,
    model: stored?.model ?? null,
    apiKeySet: !!stored?.apiKey,
    allowDataSampling: stored?.allowDataSampling ?? false,
    persisted: !!stored,
  });
});

aiRoute.put("/config", async (c) => {
  const parsed = configBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Bad input" }, 400);
  }
  const baseUrlError = validateAiBaseUrl(parsed.data.baseUrl);
  if (baseUrlError) return c.json({ error: baseUrlError }, 400);
  const existing = readAiSettings();
  const apiKey =
    parsed.data.apiKey === undefined
      ? (existing?.apiKey ?? null)
      : parsed.data.apiKey;
  writeAiSettings({
    provider: parsed.data.provider,
    apiKey: apiKey === "" ? null : apiKey,
    baseUrl: parsed.data.baseUrl?.trim() || null,
    model: parsed.data.model?.trim() || null,
    allowDataSampling:
      parsed.data.allowDataSampling ?? existing?.allowDataSampling ?? false,
  });
  invalidateProvider();
  const next = readAiSettings();
  return c.json({
    provider: next?.provider ?? null,
    baseUrl: next?.baseUrl ?? null,
    model: next?.model ?? null,
    apiKeySet: !!next?.apiKey,
    allowDataSampling: next?.allowDataSampling ?? false,
    persisted: !!next,
  });
});

aiRoute.delete("/config", (c) => {
  clearAiSettings();
  invalidateProvider();
  return c.body(null, 204);
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
        error: redactErrorMessage(e),
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
    const schema = await sampleCollectionSchema(db, parsed.data.collection, 30, {
      maxTimeMS: config.mongoMaxTimeMS,
    });
    const settings = readAiSettings();
    if (settings?.allowDataSampling) {
      await enrichWithDistinctValues(db, parsed.data.collection, schema.fields);
    }
    schemaText = renderSchemaForPrompt(schema.fields);
  } catch (e) {
    return c.json(
      {
        error: `Could not sample schema: ${redactErrorMessage(e)}`,
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
      { error: `AI request failed: ${redactErrorMessage(e)}` },
      502,
    );
  }
});

aiRoute.post("/command", async (c) => {
  const provider = getProvider();
  if (!provider.configured) {
    return c.json(
      { error: `AI (${provider.name}) is not configured. ${provider.setupHint}` },
      503,
    );
  }

  const parsed = commandBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Bad input" }, 400);
  }

  const { client } = await getMongoClientFor(parsed.data.connectionId);
  const dbName = databaseNameFor(parsed.data.connectionId, parsed.data.database);
  const db = client.db(dbName);

  let schemaText = "";
  try {
    schemaText = await sampleDatabaseSchema(db, { maxTimeMS: config.mongoMaxTimeMS });
  } catch (e) {
    return c.json(
      {
        error: `Could not sample database schema: ${redactErrorMessage(e)}`,
      },
      400,
    );
  }

  try {
    const result = await provider.generateCommand({
      prompt: parsed.data.prompt,
      schemaText,
      model: parsed.data.model,
    });
    return c.json({ ...result, provider: provider.name });
  } catch (e) {
    return c.json(
      { error: `AI request failed: ${redactErrorMessage(e)}` },
      502,
    );
  }
});
