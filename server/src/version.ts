import { createRequire } from "node:module";

/**
 * The running Mango version. The git tag is the source of truth
 * (scripts/set-version.mjs stamps it in CI):
 * - desktop sidecar: MANGO_VERSION from the Tauri shell (tauri.conf.json) —
 *   the bun-compiled binary has no package.json next to it;
 * - Docker / `node dist` / tsx: server/package.json (`0.0.0-dev` locally).
 */
const readPackageVersion = (): string | undefined => {
  try {
    return (createRequire(import.meta.url)("../package.json") as { version?: string }).version;
  } catch {
    return undefined;
  }
};

export const MANGO_VERSION: string =
  process.env.MANGO_VERSION?.trim() || readPackageVersion() || "0.0.0-dev";
