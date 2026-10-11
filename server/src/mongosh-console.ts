import { EventEmitter } from "node:events";
import vm from "node:vm";
import { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import { ShellInstanceState, toShellResult } from "@mongosh/shell-api";
import { ShellEvaluator } from "@mongosh/shell-evaluator";
import { Binary } from "bson";
import type { MongoClient } from "mongodb";
import { allowTopLevelAwait, splitScript } from "./console-script.js";
import { stringifyEJSON } from "./ejson.js";

/**
 * The JavaScript console runs scripts through MongoDB's own mongosh runtime
 * (`@mongosh/shell-api` + `@mongosh/shell-evaluator`, the pieces Compass
 * embeds) instead of a hand-rolled imitation, so everything that works in
 * mongosh works here: every collection / database / cursor method, `show` and
 * `use`, `rs.*` / `sh.*`, all BSON constructors, the Bulk API, and database
 * calls inside synchronous callbacks.
 *
 * It runs on the connection's existing MongoClient; nothing reconnects.
 */

export interface ConsoleLog {
  level: "log" | "info" | "warn" | "error";
  args: unknown[];
}

export interface ConsoleEvalResult {
  result: unknown;
  /** mongosh's result type (`Cursor`, `Document`, `ShowCollectionsResult`, …). */
  type: string | null;
  skip: number;
  limit: number;
  hasMore: boolean;
  paged: boolean;
}

export interface ConsoleEvalOptions {
  client: MongoClient;
  database: string;
  code: string;
  skip: number;
  limit: number;
  /** Collected even when evaluation throws, so output printed before a failure still shows. */
  logs: ConsoleLog[];
  signal: AbortSignal;
  /** Server-side `maxTimeMS` for reads (find, aggregate, counts, distinct). */
  readTimeoutMS: number;
  /** Upper bound for synchronous script execution (infinite loops). */
  syncTimeoutMS: number;
}

const MAX_LOG_ENTRIES = 1000;

interface ShellCursor {
  tryNext(): Promise<unknown>;
  close?(): Promise<void>;
}

// Shell-API cursors (find, aggregate, watch, runCursorCommand) all expose
// tryNext(), which returns null at the end — or, for change streams, when no
// event is waiting — so one loop pages every kind without blocking.
const isShellCursor = (value: unknown): value is ShellCursor =>
  !!value &&
  typeof value === "object" &&
  typeof (value as ShellCursor).tryNext === "function" &&
  typeof (value as { toArray?: unknown }).toArray === "function";

// Logged values travel back as EJSON; anything that can't be serialized
// (cursors, functions, circular objects) is logged as its string form.
const toLoggable = (value: unknown): unknown => {
  try {
    stringifyEJSON(value);
    return value;
  } catch {
    return String(value);
  }
};

// Read methods and the position of their options argument. Reads get the
// query timeout as server-side maxTimeMS unless the script sets its own.
const READ_OPTIONS_INDEX: Record<string, number> = {
  find: 3,
  aggregate: 3,
  aggregateDb: 2,
  count: 3,
  countDocuments: 3,
  distinct: 4,
  estimatedDocumentCount: 2,
};

/**
 * A mongosh service provider over the connection's shared MongoClient. The
 * console builds one per evaluation so its base options carry that request's
 * AbortSignal and concurrent runs can't cancel each other. The constructor
 * subscribes to the shared client's topology events — detach that again, or
 * every provider would leak a listener.
 */
export const createServiceProvider = (
  client: MongoClient,
  database: string,
  readTimeoutMS: number,
  signal?: AbortSignal,
): NodeDriverServiceProvider => {
  const event = "topologyDescriptionChanged";
  const before = new Set(client.listeners(event));
  const sp = new NodeDriverServiceProvider(
    client as never,
    new EventEmitter() as never,
    { productName: "Mango", productDocsLink: "https://github.com/philbir/mango" } as never,
  );
  for (const l of client.listeners(event)) {
    if (!before.has(l)) client.removeListener(event, l as (...args: unknown[]) => void);
  }
  const internals = sp as unknown as {
    initialDb: string;
    baseCmdOptions: Record<string, unknown>;
  };
  internals.initialDb = database;
  if (signal) internals.baseCmdOptions = { ...internals.baseCmdOptions, signal };
  // The client is the connection's shared, cached one. `quit()`,
  // `db.getMongo().close()` and our own cleanup must never close it.
  (sp as unknown as { close: () => Promise<void> }).close = async () => undefined;
  const methods = sp as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const [name, index] of Object.entries(READ_OPTIONS_INDEX)) {
    const original = methods[name]!.bind(sp);
    methods[name] = (...args: unknown[]) => {
      const options = args[index] as Record<string, unknown> | undefined;
      args[index] = { maxTimeMS: readTimeoutMS, ...options };
      return original(...args);
    };
  }
  return sp;
};

/**
 * Legacy (subtype 3) UUID constructors from the old shell's uuidhelpers,
 * which mongosh dropped. The filter editor accepts them, so the console does
 * too. Byte order follows each driver's legacy representation.
 */
const legacyUuid =
  (reorder: (bytes: Buffer) => void) =>
  (uuid: string): Binary => {
    const hex = String(uuid).replace(/[{}-]/g, "");
    if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error(`Invalid UUID: ${uuid}`);
    const bytes = Buffer.from(hex, "hex");
    reorder(bytes);
    return new Binary(bytes, Binary.SUBTYPE_UUID_OLD);
  };

const reverse = (bytes: Buffer, start: number, end: number) => {
  bytes.set(bytes.subarray(start, end).reverse(), start);
};

const LEGACY_UUID_HELPERS = {
  CSUUID: legacyUuid((b) => {
    reverse(b, 0, 4);
    reverse(b, 4, 6);
    reverse(b, 6, 8);
  }),
  JUUID: legacyUuid((b) => {
    reverse(b, 0, 8);
    reverse(b, 8, 16);
  }),
  PYUUID: legacyUuid(() => undefined),
  LUUID: legacyUuid(() => undefined),
};

const collectPage = async (
  cursor: ShellCursor,
  skip: number,
  limit: number,
): Promise<{ docs: unknown[]; hasMore: boolean }> => {
  const docs: unknown[] = [];
  let seen = 0;
  try {
    // Read one past the page to learn whether there's more.
    while (docs.length <= limit) {
      const doc = await cursor.tryNext();
      if (doc === null || doc === undefined) break;
      if (seen++ >= skip) docs.push(doc);
    }
  } finally {
    await cursor.close?.().catch(() => undefined);
  }
  const hasMore = docs.length > limit;
  return { docs: hasMore ? docs.slice(0, limit) : docs, hasMore };
};

export const evaluateConsole = async (opts: ConsoleEvalOptions): Promise<ConsoleEvalResult> => {
  const { client, database, code, skip, limit, logs, signal, readTimeoutMS, syncTimeoutMS } = opts;

  const sp = createServiceProvider(client, database, readTimeoutMS, signal);
  const state = new ShellInstanceState(sp as never, new EventEmitter() as never);

  const log =
    (level: ConsoleLog["level"]) =>
    (...args: unknown[]) => {
      if (logs.length < MAX_LOG_ENTRIES) logs.push({ level, args: args.map(toLoggable) });
    };

  const context = vm.createContext(
    { ...LEGACY_UUID_HELPERS },
    { name: "mango-console", codeGeneration: { strings: false, wasm: false } },
  );
  state.setCtx(context);
  // setCtx points console.log/warn/info/error at print(); ours keep the level
  // so warnings and errors render as such.
  Object.assign((context as { console: Record<string, unknown> }).console, {
    log: log("log"),
    info: log("info"),
    debug: log("log"),
    warn: log("warn"),
    error: log("error"),
  });
  state.setEvaluationListener({
    onPrint: (values: Array<{ printable: unknown }>) => {
      log("log")(...values.map((v) => v.printable));
    },
    // No terminal to prompt in; passwordPrompt() fails instead of hanging.
    onPrompt: () => Promise.reject(new Error("Interactive prompts are not supported in the console.")),
    // `exit` / `quit()` must never take the server down with it.
    onExit: () => Promise.reject(new Error("exit / quit() is not available in the console.")) as never,
  } as never);

  const onAbort = () => void state.onInterruptExecution();
  signal.addEventListener("abort", onAbort, { once: true });

  try {
    // Keep the raw value so cursors can be paged instead of printed.
    const evaluator = new ShellEvaluator<unknown>(state, (value: unknown) => value);
    const run = (input: string) =>
      evaluator.customEval(
        (rewritten: string) =>
          vm.runInContext(rewritten, context, {
            filename: "console.js",
            timeout: syncTimeoutMS,
            breakOnSigint: true,
          }),
        input,
        context,
        "console.js",
      );

    // `use` / `show` lines run as their own steps (as in the REPL); what an
    // earlier step returns is printed, the last step's value is the result.
    const steps = splitScript(code);
    let value: unknown;
    for (const [i, step] of steps.entries()) {
      value = await run(step.shellCommand ? step.code : allowTopLevelAwait(step.code));
      if (i < steps.length - 1 && step.shellCommand && value !== undefined) {
        log("log")((await toShellResult(value)).printable);
      }
    }

    if (isShellCursor(value)) {
      const { docs, hasMore } = await collectPage(value, skip, limit);
      return { result: docs, type: "Cursor", skip, limit, hasMore, paged: true };
    }

    const shellResult = await toShellResult(value);
    return {
      result: shellResult.printable ?? null,
      type: shellResult.type,
      skip,
      limit,
      hasMore: false,
      paged: false,
    };
  } finally {
    signal.removeEventListener("abort", onAbort);
    // Closes connections the script opened itself (`Mongo("mongodb://…")`);
    // the shared client is protected by the no-op close above.
    await state.close().catch(() => undefined);
  }
};
