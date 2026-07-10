import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { Hono } from "hono";
import { listAvailableBrowsers } from "../browser.js";
import { clearAiSettings } from "../store/aiSettings.js";
import {
  countUndecryptableConnections,
  deleteAllConnections,
} from "../store/connections.js";

export const systemRoute = new Hono();

systemRoute.get("/key-health", (c) => {
  const undecryptableCount = countUndecryptableConnections();
  return c.json({ healthy: undecryptableCount === 0, undecryptableCount });
});

systemRoute.post("/reset-encrypted", (c) => {
  const removed = deleteAllConnections();
  clearAiSettings();
  return c.json({ ok: true, removedConnections: removed });
});

systemRoute.get("/browsers", (c) => {
  return c.json({ browsers: listAvailableBrowsers() });
});

const platformOpener = (): { cmd: string; args: (target: string) => string[] } | null => {
  switch (process.platform) {
    case "darwin":
      return { cmd: "open", args: (t) => [t] };
    case "win32":
      return { cmd: "explorer.exe", args: (t) => [t] };
    case "linux":
      return { cmd: "xdg-open", args: (t) => [t] };
    default:
      return null;
  }
};

systemRoute.post("/reveal-logs", async (c) => {
  const dir = process.env.MANGO_LOG_DIR;
  if (!dir) {
    return c.json({ error: "Logs are not available in this run mode." }, 404);
  }
  if (!existsSync(dir)) {
    // The Tauri shell creates MANGO_LOG_DIR lazily on first log write — try
    // to create it here so "Open logs" works even on a fresh install.
    try {
      mkdirSync(dir, { recursive: true });
    } catch (e) {
      return c.json(
        {
          error: `Log directory does not exist and could not be created: ${dir} — ${e instanceof Error ? e.message : String(e)}`,
        },
        404,
      );
    }
  }
  const opener = platformOpener();
  if (!opener) {
    return c.json({ error: `Unsupported platform: ${process.platform}` }, 500);
  }
  // Wait for the opener to finish — `open` exits quickly once Finder/Explorer
  // has been signalled. If it fails (e.g. SIP-restricted path, broken
  // installation), we want to surface stderr instead of returning a fake 200.
  try {
    const result = await new Promise<{ code: number | null; stderr: string }>(
      (resolve, reject) => {
        const child = spawn(opener.cmd, opener.args(dir), {
          stdio: ["ignore", "ignore", "pipe"],
        });
        let stderr = "";
        child.stderr?.on("data", (b: Buffer) => (stderr += b.toString()));
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, stderr }));
      },
    );
    if (result.code !== 0) {
      return c.json(
        {
          error: `${opener.cmd} exited with ${result.code} for "${dir}": ${result.stderr.trim() || "(no stderr)"}`,
        },
        500,
      );
    }
    return c.json({ ok: true, path: dir });
  } catch (e) {
    return c.json(
      { error: `Could not open log directory: ${e instanceof Error ? e.message : String(e)}` },
      500,
    );
  }
});
