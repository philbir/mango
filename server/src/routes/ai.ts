import { Hono } from "hono";
import { z } from "zod";
import { config, databaseNameFor, getMongoClientFor } from "../config.js";
import {
  buildProviderFromConfig,
  getProvider,
  invalidateProvider,
} from "../providers/index.js";
import { buildChatSystemPrompt } from "../providers/types.js";
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

/**
 * Validate draft AI settings without persisting. Builds a one-off provider
 * from the request body and tries to list models — fastest cheap call that
 * exercises auth + base URL.
 */
aiRoute.post("/test", async (c) => {
  const parsed = configBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Bad input" },
      400,
    );
  }
  const baseUrlError = validateAiBaseUrl(parsed.data.baseUrl);
  if (baseUrlError) return c.json({ ok: false, error: baseUrlError }, 400);

  // For OpenAI, fall back to the saved key when the form left it untouched.
  let apiKey = parsed.data.apiKey ?? null;
  if (parsed.data.provider === "openai" && (apiKey === null || apiKey === "")) {
    apiKey = readAiSettings()?.apiKey ?? null;
  }

  const provider = buildProviderFromConfig({
    provider: parsed.data.provider,
    apiKey,
    baseUrl: parsed.data.baseUrl ?? null,
    model: parsed.data.model ?? null,
  });

  if (!provider.configured) {
    return c.json({
      ok: false,
      provider: provider.name,
      error: provider.setupHint,
    });
  }

  try {
    const models = await provider.listModels();
    return c.json({
      ok: true,
      provider: provider.name,
      modelCount: models.length,
      sample: models.slice(0, 5).map((m) => m.id),
    });
  } catch (e) {
    return c.json({
      ok: false,
      provider: provider.name,
      error: redactErrorMessage(e),
    });
  }
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

const chatBody = z.object({
  connectionId: z.string().min(1).optional(),
  database: z.string().optional(),
  collection: z.string().optional(),
  mode: z
    .enum(["collection", "console", "shell", "general", "indexes"])
    .default("general"),
  model: z.string().optional(),
  /** Pre-rendered context the UI can hand the assistant for index mode. */
  context: z
    .object({
      indexes: z.string().optional(),
      explain: z.string().optional(),
    })
    .optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(8000),
      }),
    )
    .min(1)
    .max(40),
});

aiRoute.post("/chat", async (c) => {
  const provider = getProvider();
  if (!provider.configured) {
    return c.json(
      { error: `AI (${provider.name}) is not configured. ${provider.setupHint}` },
      503,
    );
  }

  const parsed = chatBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Bad input" }, 400);
  }

  const { mode, messages, model, connectionId, database, collection, context } =
    parsed.data;

  let dbName: string | null = null;
  let schemaText = "";
  if (connectionId) {
    try {
      const { client } = await getMongoClientFor(connectionId);
      dbName = databaseNameFor(connectionId, database);
      const db = client.db(dbName);
      if ((mode === "collection" || mode === "indexes") && collection) {
        const schema = await sampleCollectionSchema(db, collection, 30, {
          maxTimeMS: config.mongoMaxTimeMS,
        });
        const settings = readAiSettings();
        if (settings?.allowDataSampling) {
          await enrichWithDistinctValues(db, collection, schema.fields);
        }
        schemaText = renderSchemaForPrompt(schema.fields);
      } else if (mode === "console" || mode === "shell" || mode === "general") {
        schemaText = await sampleDatabaseSchema(db, {
          maxTimeMS: config.mongoMaxTimeMS,
        });
      }
    } catch (e) {
      schemaText = `(could not sample schema: ${redactErrorMessage(e)})`;
    }
  }

  const systemPrompt = buildChatSystemPrompt({
    mode,
    databaseName: dbName,
    collection: collection ?? null,
    schemaText,
    indexesText: context?.indexes ?? null,
    explainText: context?.explain ?? null,
  });

  try {
    const result = await provider.chat({
      systemPrompt,
      messages,
      model,
    });
    return c.json({ ...result, provider: provider.name });
  } catch (e) {
    return c.json(
      { error: `AI request failed: ${redactErrorMessage(e)}` },
      502,
    );
  }
});

