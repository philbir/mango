// Run modes:
//   - "multi"      : default. Users manage multiple Mongo connections via the UI.
//   - "standalone" : Docker / Aspire. A single Mongo connection is supplied via
//                    `MONGO_URL` and the connection manager is hidden.

import { accessSync, constants } from "node:fs";
import path from "node:path";

export type ServerMode = "multi" | "standalone";

export const STANDALONE_CONNECTION_ID = "standalone";

export interface ServerConfig {
  mode: ServerMode;
  standaloneConnectionId: string | null;
  /** True when running under the desktop shell — UI may show "Open logs" actions. */
  logsAvailable: boolean;
  /**
   * Whether the workspaces feature (folder-on-disk Mongo script library) is
   * available. Disabled in standalone (Docker) where the server's filesystem
   * isn't the user's filesystem; the UI hides the sidebar toggle when false.
   */
  workspacesEnabled: boolean;
  /**
   * When true, destructive database-level actions (clear all collections,
   * drop database) are exposed in the UI and on the server. Set via
   * MANGO_DEV_MODE=true. Independent of `mode`.
   */
  devMode: boolean;
  /**
   * True when the MongoDB Database Tools (mongoexport, mongoimport, mongodump,
   * mongorestore) are all discoverable on PATH at boot. Drives whether the
   * Database Info page renders its Import/Export section.
   */
  dbToolsAvailable: boolean;
}

const isTruthyEnv = (value: string | undefined): boolean => {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
};

const isExecutableFile = (candidate: string): boolean => {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const findOnPath = (binary: string): boolean => {
  const names =
    process.platform === "win32" ? [`${binary}.exe`, `${binary}.cmd`, binary] : [binary];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      if (isExecutableFile(path.join(dir, name))) return true;
    }
  }
  return false;
};

const probeDbTools = (): boolean => {
  // All four are bundled together in `mongodb-database-tools` /
  // `mongodb-tools` packages; treat them atomically so the UI shows or hides
  // the whole section, not a half-broken subset.
  return (
    findOnPath("mongoexport") &&
    findOnPath("mongoimport") &&
    findOnPath("mongodump") &&
    findOnPath("mongorestore")
  );
};

export const resolveServerConfig = (): ServerConfig => {
  const requested = (process.env.MANGO_MODE ?? "").trim().toLowerCase();
  const mongoUrl = process.env.MONGO_URL;
  const logsAvailable = !!process.env.MANGO_LOG_DIR;
  const devMode = isTruthyEnv(process.env.MANGO_DEV_MODE);
  const dbToolsAvailable = probeDbTools();
  if (requested === "standalone") {
    if (!mongoUrl) {
      console.warn(
        "[mango] MANGO_MODE=standalone but MONGO_URL is not set — falling back to multi mode",
      );
      return {
        mode: "multi",
        standaloneConnectionId: null,
        logsAvailable,
        workspacesEnabled: true,
        devMode,
        dbToolsAvailable,
      };
    }
    return {
      mode: "standalone",
      standaloneConnectionId: STANDALONE_CONNECTION_ID,
      logsAvailable,
      workspacesEnabled: false,
      devMode,
      dbToolsAvailable,
    };
  }
  return {
    mode: "multi",
    standaloneConnectionId: null,
    logsAvailable,
    workspacesEnabled: true,
    devMode,
    dbToolsAvailable,
  };
};
