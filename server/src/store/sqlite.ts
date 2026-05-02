// Selects a SQLite implementation at runtime.
//
//   - Bun runtime  →  `bun:sqlite` (built-in, works inside `bun build --compile`).
//   - Node runtime →  `better-sqlite3` (used by tsx dev server and vitest).
//
// `better-sqlite3` ships a native .node addon resolved via node-gyp `bindings`,
// which can't locate its binary inside Bun's `--compile` virtual filesystem.

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let DatabaseCtor: any;

if (isBun) {
  // `bun:sqlite` is a Bun built-in; TS can't resolve it under Node so we hide
  // the specifier from static analysis.
  const specifier = "bun:sqlite";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = (await import(specifier)) as any;
  DatabaseCtor = mod.Database;
} else {
  const mod = await import("better-sqlite3");
  DatabaseCtor = mod.default;
}

export interface SqliteStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  close(): void;
}

export const Database: new (filename: string) => SqliteDatabase = DatabaseCtor;
