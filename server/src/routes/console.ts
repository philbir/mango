import { Hono } from "hono";
import { z } from "zod";
import { config, databaseNameFor, getMongoClientFor } from "../config.js";
import { stringifyEJSON } from "../ejson.js";
import { queryTimeoutSchema } from "../mongo-util.js";
import { completeConsole } from "../mongosh-autocomplete.js";
import { type ConsoleLog, evaluateConsole } from "../mongosh-console.js";
import { redactErrorMessage } from "../security.js";

export const consoleRoute = new Hono();

const body = z.object({
  command: z.string().min(1).max(50_000),
  skip: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().max(2000).optional(),
  timeoutMS: queryTimeoutSchema,
});

const DEFAULT_RESULT_LIMIT = 100;

const completeBody = z.object({
  /** Script text up to the cursor. */
  code: z.string().max(50_000),
});

// mongosh autocompletion for the console editor; see mongosh-autocomplete.ts.
consoleRoute.post("/complete", async (c) => {
  if (!config.jsConsoleEnabled) {
    return c.json({ error: "JavaScript console is disabled." }, 403);
  }
  const parsed = completeBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Bad input" }, 400);
  }
  const cid = c.req.param("cid")!;
  try {
    const { client } = await getMongoClientFor(cid);
    const database = databaseNameFor(cid, c.req.query("database"));
    return c.json(await completeConsole({ client, database, code: parsed.data.code }));
  } catch (e) {
    return c.json({ error: redactErrorMessage(e) }, 500);
  }
});

consoleRoute.post("/", async (c) => {
  if (!config.jsConsoleEnabled) {
    return c.json({ error: "JavaScript console is disabled." }, 403);
  }

  const cid = c.req.param("cid")!;
  const parsed = body.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Bad input" }, 400);
  }

  const { client } = await getMongoClientFor(cid);
  const database = databaseNameFor(cid, c.req.query("database"));

  const skip = parsed.data.skip ?? 0;
  const limit = parsed.data.limit ?? DEFAULT_RESULT_LIMIT;
  const start = performance.now();
  const logs: ConsoleLog[] = [];
  try {
    const evaled = await evaluateConsole({
      client,
      database,
      code: parsed.data.command,
      skip,
      limit,
      logs,
      signal: c.req.raw.signal,
      readTimeoutMS: parsed.data.timeoutMS ?? config.mongoMaxTimeMS,
      syncTimeoutMS: config.consoleTimeoutMS,
    });
    return c.body(
      stringifyEJSON({
        result: evaled.result,
        type: evaled.type,
        logs,
        skip: evaled.skip,
        limit: evaled.limit,
        hasMore: evaled.hasMore,
        paged: evaled.paged,
        elapsedMs: performance.now() - start,
        error: null,
      }),
      200,
      { "content-type": "application/json; charset=utf-8" },
    );
  } catch (e) {
    return c.body(
      stringifyEJSON({
        result: null,
        logs,
        skip,
        limit,
        hasMore: false,
        paged: false,
        elapsedMs: performance.now() - start,
        error: redactErrorMessage(e),
      }),
      400,
      { "content-type": "application/json; charset=utf-8" },
    );
  }
});
