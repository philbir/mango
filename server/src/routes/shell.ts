import { Hono } from "hono";
import { config, databaseNameFor, getMongoClientFor } from "../config.js";
import { FilterParseError, parseEJSON, stringifyEJSON } from "../ejson.js";
import { queryTimeoutSchema } from "../mongo-util.js";
import { redactErrorMessage } from "../security.js";

export const shellRoute = new Hono();

shellRoute.post("/", async (c) => {
  const timeout = queryTimeoutSchema.safeParse(
    c.req.query("timeoutMS") === undefined ? undefined : Number(c.req.query("timeoutMS")),
  );
  if (!timeout.success) return c.json({ error: "Invalid query timeout." }, 400);
  const timeoutMS = timeout.data ?? config.mongoMaxTimeMS;
  const cid = c.req.param("cid")!;
  const text = await c.req.text();
  let parsed: unknown;
  try {
    parsed = parseEJSON(text);
  } catch (e) {
    throw new FilterParseError(
      `Invalid command JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return c.json({ error: "Command must be a JSON object." }, 400);
  }

  const { client } = await getMongoClientFor(cid);
  const dbName = databaseNameFor(cid, c.req.query("database"));
  const db = client.db(dbName);

  try {
    const command = parsed as Record<string, unknown>;
    const boundedCommand =
      "maxTimeMS" in command
        ? command
        : { ...command, maxTimeMS: timeoutMS };
    const result = await db.command(boundedCommand, {
      timeoutMS: timeoutMS + 1_000,
      signal: c.req.raw.signal,
    });
    return c.body(stringifyEJSON({ ok: true, result }), 200, {
      "content-type": "application/json; charset=utf-8",
    });
  } catch (e) {
    return c.json(
      {
        ok: false,
        error: redactErrorMessage(e),
      },
      400,
    );
  }
});
