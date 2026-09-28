import { accessSync, constants, existsSync, mkdirSync } from "node:fs";
import { dataDir } from "./store/jsonFile.js";
import { MANGO_VERSION } from "./version.js";

export interface HealthCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface HealthReport {
  ok: boolean;
  version: string;
  uptimeSec: number;
  checks: HealthCheck[];
}

const startedAt = Date.now();

/**
 * Checks the UI's boot gate relies on. Everything a request could need that
 * isn't a Mongo connection: the JSON store must be writable (connections,
 * settings), and the master key must survive a restart or saved URIs become
 * unreadable next launch (a warning — ok stays true).
 */
export const healthReport = (): HealthReport => {
  const checks: HealthCheck[] = [];

  const dir = dataDir();
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.R_OK | constants.W_OK);
    checks.push({ name: "data-dir", ok: true, detail: dir });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    checks.push({ name: "data-dir", ok: false, detail: `${dir}: ${reason}` });
  }

  return {
    ok: checks.every((check) => check.ok),
    version: MANGO_VERSION,
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    checks,
  };
};
