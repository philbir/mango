// Run modes:
//   - "multi"      : default. Users manage multiple Mongo connections via the UI.
//   - "standalone" : Docker / Aspire. A single Mongo connection is supplied via
//                    `MONGO_URL` and the connection manager is hidden.

export type ServerMode = "multi" | "standalone";

export const STANDALONE_CONNECTION_ID = "standalone";

export interface ServerConfig {
  mode: ServerMode;
  standaloneConnectionId: string | null;
}

export const resolveServerConfig = (): ServerConfig => {
  const requested = (process.env.MANGO_MODE ?? "").trim().toLowerCase();
  const mongoUrl = process.env.MONGO_URL;
  if (requested === "standalone") {
    if (!mongoUrl) {
      console.warn(
        "[mango] MANGO_MODE=standalone but MONGO_URL is not set — falling back to multi mode",
      );
      return { mode: "multi", standaloneConnectionId: null };
    }
    return { mode: "standalone", standaloneConnectionId: STANDALONE_CONNECTION_ID };
  }
  return { mode: "multi", standaloneConnectionId: null };
};
