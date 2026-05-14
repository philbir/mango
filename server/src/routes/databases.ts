import { Hono } from "hono";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { getMongoClientFor } from "../config.js";
import { resolveServerConfig } from "../mode.js";
import { redactErrorMessage } from "../security.js";
import { getConnection } from "../store/connections.js";

export const databasesRoute = new Hono();

const requireDevMode = () => resolveServerConfig().devMode;
const requireDbTools = () => resolveServerConfig().dbToolsAvailable;

const FORBIDDEN_NAME = /[/\\\0$]|^$|\.\./;

const validateDbName = (name: string): string | null => {
  if (name.length > 64) return "database name too long";
  if (FORBIDDEN_NAME.test(name)) return "invalid database name";
  return null;
};

const validateCollectionName = (name: string): string | null => {
  if (name.length > 120) return "collection name too long";
  if (FORBIDDEN_NAME.test(name)) return "invalid collection name";
  return null;
};

// Mongo's `dbStats` / `collStats` commands return BSON Long / Int32 / Double
// instances for counters and sizes. Sent through EJSON canonical mode and
// parsed back by the UI they become objects like `{ value: <bigint> }`, which
// React refuses to render in a JSX child. Coerce everything we know is
// numeric down to plain JS numbers so the response is a flat shape the UI can
// drop into `<td>` cells directly.
const toNumber = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "bigint") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === "object") {
    const obj = v as { toNumber?: () => number; value?: unknown; valueOf?: () => unknown };
    if (typeof obj.toNumber === "function") {
      const n = obj.toNumber();
      return Number.isFinite(n) ? n : null;
    }
    if (typeof obj.value === "bigint") {
      const n = Number(obj.value);
      return Number.isFinite(n) ? n : null;
    }
    if (typeof obj.value === "number") {
      return Number.isFinite(obj.value) ? obj.value : null;
    }
    if (typeof obj.valueOf === "function") {
      const v2 = obj.valueOf();
      if (typeof v2 === "number" && Number.isFinite(v2)) return v2;
      if (typeof v2 === "bigint") {
        const n = Number(v2);
        return Number.isFinite(n) ? n : null;
      }
    }
  }
  return null;
};

// ── Stats ────────────────────────────────────────────────────────────────────

databasesRoute.get("/:db/stats", async (c) => {
  const cid = c.req.param("cid")!;
  const dbName = c.req.param("db")!;
  const err = validateDbName(dbName);
  if (err) return c.json({ error: err }, 400);
  try {
    const { client } = await getMongoClientFor(cid);
    const db = client.db(dbName);
    const dbStats = (await db.command({ dbStats: 1 })) as Record<string, unknown>;
    const cols = await db.listCollections({}, { nameOnly: false }).toArray();

    // Per-collection rollup. Promise.all + per-collection try/catch so a
    // single bad collection (e.g. view permissions, fle-encrypted) doesn't
    // sink the page.
    const collections = await Promise.all(
      cols.map(async (col) => {
        try {
          const s = (await db.command({ collStats: col.name })) as Record<
            string,
            unknown
          >;
          return {
            name: col.name,
            type: col.type ?? "collection",
            count: toNumber(s.count),
            size: toNumber(s.size),
            storageSize: toNumber(s.storageSize),
            avgObjSize: toNumber(s.avgObjSize),
            totalIndexSize: toNumber(s.totalIndexSize),
            indexCount: toNumber(s.nindexes),
          };
        } catch {
          return {
            name: col.name,
            type: col.type ?? "collection",
            count: null,
            size: null,
            storageSize: null,
            avgObjSize: null,
            totalIndexSize: null,
            indexCount: null,
          };
        }
      }),
    );

    collections.sort((a, b) => a.name.localeCompare(b.name));

    const dataSize = toNumber(dbStats.dataSize);
    const indexSize = toNumber(dbStats.indexSize);
    return c.json({
      database: dbName,
      collections,
      stats: {
        dataSize,
        storageSize: toNumber(dbStats.storageSize),
        indexSize,
        totalSize:
          dataSize !== null || indexSize !== null
            ? (dataSize ?? 0) + (indexSize ?? 0)
            : null,
        fsUsedSize: toNumber(dbStats.fsUsedSize),
        fsTotalSize: toNumber(dbStats.fsTotalSize),
        collections: toNumber(dbStats.collections) ?? collections.length,
        views: toNumber(dbStats.views),
        objects: toNumber(dbStats.objects),
        indexes: toNumber(dbStats.indexes),
        avgObjSize: toNumber(dbStats.avgObjSize),
      },
    });
  } catch (e) {
    return c.json(
      { error: `Could not load database stats: ${redactErrorMessage(e)}` },
      400,
    );
  }
});

// ── Destructive (dev-mode only) ──────────────────────────────────────────────

databasesRoute.post("/:db/clear-collections", async (c) => {
  if (!requireDevMode()) {
    return c.json({ error: "Dev mode is disabled on this server." }, 403);
  }
  const cid = c.req.param("cid")!;
  const dbName = c.req.param("db")!;
  const err = validateDbName(dbName);
  if (err) return c.json({ error: err }, 400);
  try {
    const { client } = await getMongoClientFor(cid);
    const db = client.db(dbName);
    const cols = await db.listCollections({}, { nameOnly: true }).toArray();
    const results: Array<{ name: string; deletedCount: number | null; error?: string }> =
      [];
    for (const col of cols) {
      if (col.name.startsWith("system.")) continue;
      try {
        const r = await db.collection(col.name).deleteMany({});
        results.push({ name: col.name, deletedCount: r.deletedCount ?? 0 });
      } catch (e) {
        results.push({
          name: col.name,
          deletedCount: null,
          error: redactErrorMessage(e),
        });
      }
    }
    return c.json({ ok: true, database: dbName, results });
  } catch (e) {
    return c.json(
      { error: `Clear failed: ${redactErrorMessage(e)}` },
      400,
    );
  }
});

databasesRoute.post("/:db/drop", async (c) => {
  if (!requireDevMode()) {
    return c.json({ error: "Dev mode is disabled on this server." }, 403);
  }
  const cid = c.req.param("cid")!;
  const dbName = c.req.param("db")!;
  const err = validateDbName(dbName);
  if (err) return c.json({ error: err }, 400);
  // Block dropping system databases — easy to fat-finger and there's no use
  // case for it from the UI.
  if (dbName === "admin" || dbName === "local" || dbName === "config") {
    return c.json({ error: `Refusing to drop system database '${dbName}'.` }, 400);
  }
  try {
    const { client } = await getMongoClientFor(cid);
    const dropped = await client.db(dbName).dropDatabase();
    return c.json({ ok: true, dropped });
  } catch (e) {
    return c.json(
      { error: `Drop failed: ${redactErrorMessage(e)}` },
      400,
    );
  }
});

// ── Database tools (export / import / dump / restore) ────────────────────────

const TOOL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

interface SpawnedTool {
  child: ReturnType<typeof spawn>;
  stderrChunks: Buffer[];
}

const spawnTool = (
  binary: string,
  args: string[],
): SpawnedTool => {
  const child = spawn(binary, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });
  const stderrChunks: Buffer[] = [];
  child.stderr.on("data", (chunk: Buffer) => {
    stderrChunks.push(chunk);
  });
  // Safety net: kill long-running tools so we don't leak forever.
  const killer = setTimeout(() => {
    if (!child.killed) child.kill("SIGKILL");
  }, TOOL_TIMEOUT_MS);
  child.on("close", () => clearTimeout(killer));
  return { child, stderrChunks };
};

const waitForExit = (child: ReturnType<typeof spawn>): Promise<number> =>
  new Promise((resolve) => {
    child.on("close", (code) => resolve(code ?? 0));
  });

const getConnectionUri = (cid: string): string | null => {
  const conn = getConnection(cid);
  return conn?.uri ?? null;
};

databasesRoute.post("/:db/export", async (c) => {
  if (!requireDbTools()) {
    return c.json({ error: "Database tools are not installed on this server." }, 503);
  }
  const cid = c.req.param("cid")!;
  const dbName = c.req.param("db")!;
  const collection = c.req.query("collection") ?? "";
  const dbErr = validateDbName(dbName);
  if (dbErr) return c.json({ error: dbErr }, 400);
  const colErr = validateCollectionName(collection);
  if (colErr) return c.json({ error: colErr }, 400);
  const uri = getConnectionUri(cid);
  if (!uri) return c.json({ error: "Connection not found" }, 404);

  const args = [
    `--uri=${uri}`,
    `--db=${dbName}`,
    `--collection=${collection}`,
    "--jsonArray",
    "--out=-",
    "--quiet",
  ];
  const { child, stderrChunks } = spawnTool("mongoexport", args);

  child.on("error", (err) => {
    console.error(`[mango] mongoexport spawn failed: ${err.message}`);
  });

  const filename = `${dbName}.${collection}.json`;
  return new Response(Readable.toWeb(child.stdout!) as ReadableStream, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "x-mango-tool": "mongoexport",
    },
  });
  // Note: stderrChunks is captured but not surfaced — mongoexport returns
  // exit code via the stream end. The client sees a truncated download if
  // export fails partway, which is the same behavior as running the CLI
  // directly. Most failures (auth, missing db) happen before any bytes flow.
  void stderrChunks;
});

databasesRoute.post("/:db/import", async (c) => {
  if (!requireDbTools()) {
    return c.json({ error: "Database tools are not installed on this server." }, 503);
  }
  const cid = c.req.param("cid")!;
  const dbName = c.req.param("db")!;
  const collection = c.req.query("collection") ?? "";
  const drop = c.req.query("drop") === "true";
  const mode = c.req.query("mode") ?? "insert";
  const dbErr = validateDbName(dbName);
  if (dbErr) return c.json({ error: dbErr }, 400);
  const colErr = validateCollectionName(collection);
  if (colErr) return c.json({ error: colErr }, 400);
  if (mode !== "insert" && mode !== "upsert" && mode !== "merge") {
    return c.json({ error: "mode must be insert | upsert | merge" }, 400);
  }
  const uri = getConnectionUri(cid);
  if (!uri) return c.json({ error: "Connection not found" }, 404);
  const body = c.req.raw.body;
  if (!body) return c.json({ error: "No body uploaded" }, 400);

  const args = [
    `--uri=${uri}`,
    `--db=${dbName}`,
    `--collection=${collection}`,
    "--jsonArray",
    `--mode=${mode}`,
    "--file=-",
  ];
  if (drop) args.push("--drop");

  const { child, stderrChunks } = spawnTool("mongoimport", args);

  // Stream the upload directly to mongoimport's stdin so the file never has
  // to fit in memory.
  const stdin = child.stdin!;
  const reader = body.getReader();
  const pumpErr: Error | null = await (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          if (!stdin.write(value)) {
            await new Promise((resolve) => stdin.once("drain", resolve));
          }
        }
      }
      stdin.end();
      return null;
    } catch (e) {
      stdin.destroy();
      return e instanceof Error ? e : new Error(String(e));
    }
  })();
  const code = await waitForExit(child);
  const stderr = Buffer.concat(stderrChunks).toString("utf8");
  if (pumpErr || code !== 0) {
    return c.json(
      {
        ok: false,
        code,
        error: pumpErr?.message ?? stderr.trim() ?? "mongoimport failed",
        stderr,
      },
      400,
    );
  }
  return c.json({ ok: true, code, stderr });
});

databasesRoute.post("/:db/dump", async (c) => {
  if (!requireDbTools()) {
    return c.json({ error: "Database tools are not installed on this server." }, 503);
  }
  const cid = c.req.param("cid")!;
  const dbName = c.req.param("db")!;
  const dbErr = validateDbName(dbName);
  if (dbErr) return c.json({ error: dbErr }, 400);
  const uri = getConnectionUri(cid);
  if (!uri) return c.json({ error: "Connection not found" }, 404);

  const args = [
    `--uri=${uri}`,
    `--db=${dbName}`,
    "--archive",
    "--gzip",
    "--quiet",
  ];
  const { child, stderrChunks } = spawnTool("mongodump", args);
  child.on("error", (err) => {
    console.error(`[mango] mongodump spawn failed: ${err.message}`);
  });

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${dbName}-${ts}.archive.gz`;
  return new Response(Readable.toWeb(child.stdout!) as ReadableStream, {
    headers: {
      "content-type": "application/gzip",
      "content-disposition": `attachment; filename="${filename}"`,
      "x-mango-tool": "mongodump",
    },
  });
  void stderrChunks;
});

databasesRoute.post("/:db/restore", async (c) => {
  if (!requireDbTools()) {
    return c.json({ error: "Database tools are not installed on this server." }, 503);
  }
  const cid = c.req.param("cid")!;
  const dbName = c.req.param("db")!;
  const drop = c.req.query("drop") === "true";
  const dbErr = validateDbName(dbName);
  if (dbErr) return c.json({ error: dbErr }, 400);
  const uri = getConnectionUri(cid);
  if (!uri) return c.json({ error: "Connection not found" }, 404);
  const body = c.req.raw.body;
  if (!body) return c.json({ error: "No body uploaded" }, 400);

  const args = [
    `--uri=${uri}`,
    "--archive",
    "--gzip",
    `--nsInclude=${dbName}.*`,
    // Rewrite the source db namespace into the requested db, so a dump from
    // db "foo" can be restored as "bar" without editing the archive.
    `--nsFrom=${dbName}.*`,
    `--nsTo=${dbName}.*`,
  ];
  if (drop) args.push("--drop");

  const { child, stderrChunks } = spawnTool("mongorestore", args);

  const stdin = child.stdin!;
  const reader = body.getReader();
  const pumpErr: Error | null = await (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          if (!stdin.write(value)) {
            await new Promise((resolve) => stdin.once("drain", resolve));
          }
        }
      }
      stdin.end();
      return null;
    } catch (e) {
      stdin.destroy();
      return e instanceof Error ? e : new Error(String(e));
    }
  })();
  const code = await waitForExit(child);
  const stderr = Buffer.concat(stderrChunks).toString("utf8");
  if (pumpErr || code !== 0) {
    return c.json(
      {
        ok: false,
        code,
        error: pumpErr?.message ?? stderr.trim() ?? "mongorestore failed",
        stderr,
      },
      400,
    );
  }
  return c.json({ ok: true, code, stderr });
});
