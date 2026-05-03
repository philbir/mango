import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { Hono } from "hono";
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

systemRoute.post("/reveal-logs", (c) => {
  const dir = process.env.MANGO_LOG_DIR;
  if (!dir) {
    return c.json({ error: "Logs are not available in this run mode." }, 404);
  }
  if (!existsSync(dir)) {
    return c.json({ error: `Log directory does not exist: ${dir}` }, 404);
  }
  const opener = platformOpener();
  if (!opener) {
    return c.json({ error: `Unsupported platform: ${process.platform}` }, 500);
  }
  try {
    const child = spawn(opener.cmd, opener.args(dir), {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return c.json({ ok: true, path: dir });
  } catch (e) {
    return c.json(
      { error: `Could not open log directory: ${e instanceof Error ? e.message : String(e)}` },
      500,
    );
  }
});
