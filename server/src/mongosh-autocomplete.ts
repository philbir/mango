import { EventEmitter } from "node:events";
import { initNewAutocompleter } from "@mongosh/autocomplete";
import { ShellInstanceState } from "@mongosh/shell-api";
import type { MongoClient } from "mongodb";
import { createServiceProvider } from "./mongosh-console.js";

/**
 * Console autocompletion through mongosh's own autocompleter — a TypeScript
 * language service over the shell API's type definitions plus sampled
 * documents, so it completes collection names, every database / collection /
 * cursor method, document fields inside queries, aggregation stages and
 * operators, `use` / `show` arguments and BSON constructors.
 */

type Complete = (text: string) => Promise<[string[], string, "exclusive"] | [string[], string]>;

// The first completion pays for loading the type definitions (~0.4s), so
// completers stay warm per shared client and database. Keyed weakly by
// client: editing or removing a connection replaces its client, and the old
// completers go with it.
const completers = new WeakMap<MongoClient, Map<string, Promise<Complete>>>();
const MAX_DATABASES_PER_CLIENT = 8;

// Schema sampling for field completion is a convenience; never let it hang.
const SAMPLING_TIMEOUT_MS = 5_000;

type AutocompletionContext = ReturnType<ShellInstanceState["getAutocompletionContext"]>;

/**
 * mongosh only tolerates "not connected" / "unauthorized" when it looks up
 * databases, collections or sample documents; anything else (a timeout, a
 * missing privilege, a server hiccup) fails the whole completion. Degrade to
 * "nothing known" instead so method / operator / type completions still work.
 */
const tolerant = (context: AutocompletionContext): AutocompletionContext => ({
  ...context,
  databasesForConnection: (...args) =>
    context.databasesForConnection(...args).catch(() => []),
  collectionsForDatabase: (...args) =>
    context.collectionsForDatabase(...args).catch(() => []),
  schemaInformationForCollection: (...args) =>
    context
      .schemaInformationForCollection(...args)
      .catch(() => ({ bsonType: "object", properties: {} }) as never),
});

const getCompleter = (client: MongoClient, database: string): Promise<Complete> => {
  let byDb = completers.get(client);
  if (!byDb) {
    byDb = new Map();
    completers.set(client, byDb);
  }
  const cached = byDb.get(database);
  if (cached) {
    // Re-insert to mark as most recently used.
    byDb.delete(database);
    byDb.set(database, cached);
    return cached;
  }
  const sp = createServiceProvider(client, database, SAMPLING_TIMEOUT_MS);
  const state = new ShellInstanceState(sp as never, new EventEmitter() as never);
  const created = initNewAutocompleter({
    getAutocompletionContext: () => tolerant(state.getAutocompletionContext()),
  } as never) as Promise<Complete>;
  const map = byDb;
  created.catch(() => map.delete(database));
  map.set(database, created);
  if (map.size > MAX_DATABASES_PER_CLIENT) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  return created;
};

export interface ConsoleCompletions {
  /** Characters before the cursor that each item replaces (the partial word). */
  replaceLength: number;
  /** Replacement text for that word: `find`, `status`, `$match`, `acme`, … */
  items: string[];
}

const WORD_TAIL = /[\w$]*$/;

/**
 * Completions for the console script `code`, which ends at the cursor.
 * mongosh returns whole lines (`db.orders.find`); these are cut down to the
 * word being typed so the editor can replace just that. mongosh's internal
 * `_`-prefixed members are hidden unless the word starts with `_`.
 */
export const completeConsole = async (opts: {
  client: MongoClient;
  database: string;
  code: string;
}): Promise<ConsoleCompletions> => {
  const complete = await getCompleter(opts.client, opts.database);
  const [results] = await complete(opts.code);
  const word = WORD_TAIL.exec(opts.code)?.[0] ?? "";
  const head = opts.code.slice(0, opts.code.length - word.length);
  const items: string[] = [];
  const seen = new Set<string>();
  for (const result of results) {
    if (!result.startsWith(head)) continue;
    const item = result.slice(head.length);
    if (!item || seen.has(item)) continue;
    if (item.startsWith("_") && !word.startsWith("_")) continue;
    seen.add(item);
    items.push(item);
  }
  return { replaceLength: word.length, items };
};
