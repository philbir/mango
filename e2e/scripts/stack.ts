/**
 * Brings up everything the e2e suite needs, in one process Playwright can own:
 *
 *   MongoDB  — MANGO_E2E_MONGO_URL, or mongodb-memory-server on a fixed port
 *   server   — `tsx src/index.ts` in standalone mode on a throwaway data dir
 *   UI       — Vite dev server proxying /api to the server
 *
 * Playwright's webServer waits for the UI's /api/health (through the proxy)
 * and sends SIGTERM when the run ends; everything started here goes down
 * with it.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MEMORY_MONGO_PORT,
  MONGO_URL,
  SERVER_PORT,
  SERVER_URL,
  UI_PORT,
  USES_MEMORY_SERVER,
} from "./env.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dataDir = mkdtempSync(path.join(tmpdir(), "mango-e2e-"));
const children: ChildProcess[] = [];
let stopMongo: (() => Promise<void>) | null = null;
let shuttingDown = false;

const log = (msg: string) => process.stdout.write(`[e2e-stack] ${msg}\n`);

const shutdown = async (code = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  await Promise.all(
    children.map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null) return resolve();
          const timer = setTimeout(() => {
            child.kill("SIGKILL");
            resolve();
          }, 5_000);
          child.once("exit", () => {
            clearTimeout(timer);
            resolve();
          });
        }),
    ),
  );
  await stopMongo?.().catch(() => undefined);
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(code);
};

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

const run = (name: string, cwd: string, args: string[], env: NodeJS.ProcessEnv) => {
  const child = spawn("pnpm", ["exec", ...args], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d: Buffer) => process.stdout.write(`[${name}] ${d}`));
  child.stderr?.on("data", (d: Buffer) => process.stderr.write(`[${name}] ${d}`));
  child.on("exit", (code) => {
    if (!shuttingDown) {
      log(`${name} exited with ${code} — stopping the stack`);
      void shutdown(1);
    }
  });
  children.push(child);
  return child;
};

if (USES_MEMORY_SERVER) {
  const { MongoMemoryServer } = await import("mongodb-memory-server");
  log(`starting mongodb-memory-server on port ${MEMORY_MONGO_PORT}`);
  const mongo = await MongoMemoryServer.create({
    instance: { port: MEMORY_MONGO_PORT, ip: "127.0.0.1" },
  });
  stopMongo = async () => {
    await mongo.stop();
  };
} else {
  log(`using MongoDB at ${MONGO_URL}`);
}

log(`server on ${SERVER_URL}, data dir ${dataDir}`);
run("server", path.join(root, "server"), ["tsx", "src/index.ts"], {
  PORT: String(SERVER_PORT),
  MANGO_MODE: "standalone",
  MONGO_URL,
  MANGO_DATA_DIR: dataDir,
  // Fixed key so a restarted server can still read the standalone connection.
  MANGO_MASTER_KEY: "e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0",
  // Keep the console honest about runaway scripts but not flaky on slow CI.
  MANGO_CONSOLE_TIMEOUT_MS: "5000",
});

// Vite's proxy logs a connection error for every request that lands before
// the server listens, so hold the UI back until /api/health answers.
const waitForServer = async () => {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${SERVER_URL}/api/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not become healthy in time");
};
await waitForServer();

log(`ui on http://127.0.0.1:${UI_PORT}`);
run("ui", path.join(root, "ui"), ["vite", "--port", String(UI_PORT), "--strictPort"], {
  VITE_MANGO_API: SERVER_URL,
});
