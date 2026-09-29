import { Binary, Decimal128, ObjectId, UUID } from "bson";
import { Hono } from "hono";
import type { Collection, Db, MongoClient } from "mongodb";
import vm from "node:vm";
import { z } from "zod";
import { config, databaseNameFor, getMongoClientFor } from "../config.js";
import { prepareConsoleScript } from "../console-script.js";
import { stringifyEJSON } from "../ejson.js";
import { queryTimeoutSchema } from "../mongo-util.js";
import { redactErrorMessage } from "../security.js";

export const consoleRoute = new Hono();

const body = z.object({
  command: z.string().min(1).max(50_000),
  skip: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().max(2000).optional(),
  timeoutMS: queryTimeoutSchema,
});

const DEFAULT_RESULT_LIMIT = 100;

const ALLOWED_COLLECTION_METHODS = new Set([
  "find",
  "findOne",
  "aggregate",
  "countDocuments",
  "estimatedDocumentCount",
  "distinct",
  "indexes",
  "listIndexes",
  "insertOne",
  "insertMany",
  "updateOne",
  "updateMany",
  "replaceOne",
  "deleteOne",
  "deleteMany",
  "createIndex",
  "dropIndex",
  "drop",
  "rename",
  "stats",
  "getIndexes",
]);

// Properties runtime machinery probes on arbitrary values (promise
// resolution checks `then`, serializers check `toJSON`/`toBSON`). The proxies
// must answer "not here" instead of treating them as collection names or
// disallowed methods.
const PROBED_PROPS = new Set(["then", "toJSON", "toBSON", "_bsontype", "constructor"]);

const READ_OPTIONS_INDEX: Record<string, number> = {
  find: 1,
  findOne: 1,
  aggregate: 1,
  countDocuments: 1,
  estimatedDocumentCount: 0,
  distinct: 2,
  indexes: 0,
  listIndexes: 0,
};

const buildCollectionProxy = (col: Collection, signal: AbortSignal, timeoutMS: number): unknown =>
  new Proxy(
    {},
    {
      get(_target, prop: string | symbol) {
        if (typeof prop !== "string") return undefined;
        if (PROBED_PROPS.has(prop)) return undefined;
        if (prop === "getName") return () => col.collectionName;
        if (!ALLOWED_COLLECTION_METHODS.has(prop)) {
          throw new Error(`Method "${prop}" is not allowed in console.`);
        }
        const fn = (col as unknown as Record<string, unknown>)[prop];
        if (typeof fn !== "function") return undefined;
        const method = (fn as (...args: unknown[]) => unknown).bind(col);
        const optionsIndex = READ_OPTIONS_INDEX[prop];
        if (optionsIndex === undefined) return method;
        return (...args: unknown[]) => {
          const options = args[optionsIndex] as Record<string, unknown> | undefined;
          args[optionsIndex] = { maxTimeMS: timeoutMS, ...options, signal };
          return method(...args);
        };
      },
    },
  );

const buildDbProxy = (client: MongoClient, db: Db, signal: AbortSignal, timeoutMS: number): unknown =>
  new Proxy(
    {},
    {
      get(_target, prop: string | symbol) {
        if (typeof prop !== "string") return undefined;
        if (PROBED_PROPS.has(prop)) return undefined;
        if (prop === "getName") return () => db.databaseName;
        if (prop === "getSiblingDB") {
          return (name: string) => buildDbProxy(client, client.db(name), signal, timeoutMS);
        }
        if (prop === "getCollection") {
          return (name: string) => buildCollectionProxy(db.collection(name), signal, timeoutMS);
        }
        if (prop === "getCollectionNames") {
          return async () => {
            const cols = await db
              .listCollections({}, { nameOnly: true, signal, maxTimeMS: timeoutMS })
              .toArray();
            return cols.map((c) => c.name);
          };
        }
        if (prop === "stats") return () => db.stats();
        if (prop === "command" || prop === "runCommand") {
          return (cmd: Record<string, unknown>) => db.command(
            { ...cmd, maxTimeMS: cmd.maxTimeMS ?? timeoutMS },
            { signal },
          );
        }
        if (prop === "createCollection") {
          return (name: string, opts?: Record<string, unknown>) =>
            db.createCollection(name, opts);
        }
        return buildCollectionProxy(db.collection(prop), signal, timeoutMS);
      },
    },
  );

interface CursorLike {
  toArray?: () => Promise<unknown[]>;
  [Symbol.asyncIterator]?: () => AsyncIterableIterator<unknown>;
}

const isCursor = (value: unknown): value is CursorLike & AsyncIterable<unknown> =>
  !!value &&
  typeof value === "object" &&
  typeof (value as CursorLike).toArray === "function" &&
  typeof (value as { [k: symbol]: unknown })[Symbol.asyncIterator] ===
    "function";

const consumeCursor = async (
  cursor: AsyncIterable<unknown>,
  max: number,
): Promise<{ docs: unknown[]; truncated: boolean }> => {
  const docs: unknown[] = [];
  let truncated = false;
  for await (const d of cursor) {
    if (docs.length >= max) {
      truncated = true;
      break;
    }
    docs.push(d);
  }
  return { docs, truncated };
};

interface ConsoleLog {
  level: "log" | "info" | "warn" | "error";
  args: unknown[];
}

const MAX_LOG_ENTRIES = 1000;

// Logged values are serialized with the response; anything EJSON can't
// represent (cursors, proxies, circular objects) is logged as a string.
const toLoggable = (value: unknown): unknown => {
  if (isCursor(value)) return "[Cursor — use .toArray()]";
  try {
    stringifyEJSON(value);
    return value;
  } catch {
    return String(value);
  }
};

interface EvalResult {
  result: unknown;
  logs: ConsoleLog[];
  skip: number;
  limit: number;
  hasMore: boolean;
  paged: boolean;
}

/**
 * Evaluate a JavaScript script against a `db` proxy. Scripts may declare
 * variables, loop, define functions and `print(...)`; see
 * `prepareConsoleScript` for how the last expression becomes the result and
 * where `await` is implied. The result is awaited; if it's a cursor
 * (find/aggregate without an explicit toArray) we apply server-side
 * skip/limit paging so we never load huge collections into memory.
 *
 * NB: This is a local development tool. The vm context keeps Node globals such
 * as process and dynamic import out of the console, but it is still not a
 * multi-tenant security boundary.
 */
const evalCommand = async (
  client: MongoClient,
  db: Db,
  code: string,
  skip: number,
  limit: number,
  // Owned by the caller so output printed before a failure still reaches
  // the client alongside the error.
  logs: ConsoleLog[],
  signal: AbortSignal,
  timeoutMS: number,
): Promise<EvalResult> => {
  const dbProxy = buildDbProxy(client, db, signal, timeoutMS);
  const logger =
    (level: ConsoleLog["level"]) =>
    (...args: unknown[]) => {
      if (logs.length < MAX_LOG_ENTRIES) {
        logs.push({ level, args: args.map(toLoggable) });
      }
    };
  const consoleShim = {
    log: logger("log"),
    info: logger("info"),
    debug: logger("log"),
    warn: logger("warn"),
    error: logger("error"),
  };
  const ISODate = (s?: string) => (s ? new Date(s) : new Date());
  const NumberDecimal = (v: string | number) =>
    Decimal128.fromString(typeof v === "number" ? String(v) : v);
  const BinData = (subType: number, b64: string) =>
    new Binary(Buffer.from(b64, "base64"), subType);

  const sandbox = vm.createContext(
    {
      db: dbProxy,
      ObjectId,
      UUID,
      ISODate,
      NumberDecimal,
      BinData,
      print: consoleShim.log,
      printjson: consoleShim.log,
      console: consoleShim,
    },
    {
      name: "mango-console",
      codeGeneration: { strings: false, wasm: false },
    },
  );

  const script = new vm.Script(
    `"use strict"; (async () => {\n${prepareConsoleScript(code)}\n})();`,
    { filename: "console.js", lineOffset: -1 },
  );
  let result: unknown = script.runInContext(sandbox, {
    timeout: config.consoleTimeoutMS,
    breakOnSigint: true,
  });

  result = await result;

  if (isCursor(result)) {
    // Apply skip+limit on the cursor when we can. FindCursor has chainable
    // .skip/.limit; AggregationCursor doesn't, so for those we iterate
    // skip+limit+1 docs and slice client-side.
    const cursor = result as unknown as {
      skip?: (n: number) => unknown;
      limit?: (n: number) => unknown;
    };
    let chained = false;
    try {
      if (typeof cursor.skip === "function" && skip > 0) {
        cursor.skip(skip);
      }
      if (typeof cursor.limit === "function") {
        cursor.limit(limit + 1);
        chained = true;
      }
    } catch {
      /* fall through to manual iteration */
    }

    let docs: unknown[];
    if (chained) {
      docs = await result.toArray!();
    } else {
      const { docs: collected } = await consumeCursor(
        result,
        skip + limit + 1,
      );
      docs = collected.slice(skip);
    }
    const hasMore = docs.length > limit;
    if (hasMore) docs = docs.slice(0, limit);
    return {
      result: docs,
      logs,
      skip,
      limit,
      hasMore,
      paged: true,
    };
  }
  return {
    result,
    logs,
    skip,
    limit,
    hasMore: false,
    paged: false,
  };
};

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
  const dbName = databaseNameFor(cid, c.req.query("database"));
  const db = client.db(dbName);

  const skip = parsed.data.skip ?? 0;
  const limit = parsed.data.limit ?? DEFAULT_RESULT_LIMIT;
  const start = performance.now();
  const logs: ConsoleLog[] = [];
  try {
    const evaled = await evalCommand(
      client,
      db,
      parsed.data.command,
      skip,
      limit,
      logs,
      c.req.raw.signal,
      parsed.data.timeoutMS ?? config.mongoMaxTimeMS,
    );
    return c.body(
      stringifyEJSON({
        result: evaled.result,
        logs: evaled.logs,
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
