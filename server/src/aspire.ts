import { spawn } from "node:child_process";

interface AspireResource {
  name: string;
  displayName?: string;
  resourceType: string;
  state?: string;
  source?: string | null;
  urls?: Array<{ name?: string; url: string }>;
  properties?: Record<string, unknown>;
  environment?: Record<string, string | null>;
  relationships?: Array<{ type: string; resourceName: string }>;
}

interface AspireAppHost {
  appHostPath: string;
  appHostPid: number;
  cliPid?: number;
  dashboardUrl?: string;
  resources?: AspireResource[];
}

export interface AspireMongoTarget {
  appHostPath: string;
  appHostName: string;
  resourceName: string;
  parentName: string | null;
  databaseName: string;
  uri: string | null;
  warning: string | null;
}

export type AspireResourceKind = "mongo-database" | "mongo-server" | "other";

export interface AspireResourceSummary {
  name: string;
  displayName: string;
  resourceType: string;
  state: string | null;
  source: string | null;
  parentName: string | null;
  kind: AspireResourceKind;
  /** Set when `kind !== "other"` — the suggested URI for connecting. */
  uri: string | null;
  /** Set for `mongo-database` only — the database segment of the URI. */
  databaseName: string | null;
  warning: string | null;
}

export interface AspireAppHostInfo {
  appHostPath: string;
  appHostName: string;
  appHostPid: number;
  dashboardUrl: string | null;
  resources: AspireResourceSummary[];
}

const ASPIRE_BIN = process.env.ASPIRE_CLI ?? "aspire";

const runAspire = (args: string[], timeoutMs = 8_000): Promise<string> =>
  new Promise((resolve, reject) => {
    const proc = spawn(ASPIRE_BIN, args, {
      env: { ...process.env, NO_COLOR: "1" },
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`aspire ${args.join(" ")} timed out`));
    }, timeoutMs);
    proc.stdout.on("data", (c) => stdoutChunks.push(c as Buffer));
    proc.stderr.on("data", (c) => stderrChunks.push(c as Buffer));
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
        reject(
          new Error(
            `aspire ${args[0]} exited ${code}${stderr ? `: ${stderr}` : ""}`,
          ),
        );
        return;
      }
      resolve(Buffer.concat(stdoutChunks).toString("utf8"));
    });
  });

const stripPreamble = (s: string): string => {
  // `aspire ps` prints "Scanning for running apphosts..." before the JSON.
  const idx = s.search(/[\[{]/);
  return idx >= 0 ? s.slice(idx) : s;
};

const appHostNameOf = (path: string): string => {
  const base = path.split(/[\\/]/).pop() ?? path;
  return base.replace(/\.csproj$/i, "");
};

const portFromUrl = (url: string): { host: string; port: number } | null => {
  try {
    // Aspire mongo URLs look like tcp://localhost:60323 — URL parses the authority.
    const u = new URL(url);
    if (!u.hostname || !u.port) return null;
    return { host: u.hostname, port: Number(u.port) };
  } catch {
    return null;
  }
};

const enc = (s: string) => encodeURIComponent(s);

const buildUriFromContainer = (
  parent: AspireResource,
  databaseName: string,
): { uri: string | null; warning: string | null } => {
  const tcpUrl = parent.urls?.find((u) => u.url.startsWith("tcp://"))?.url;
  if (!tcpUrl) {
    return { uri: null, warning: "Parent mongo container has no published URL." };
  }
  const hp = portFromUrl(tcpUrl);
  if (!hp) {
    return { uri: null, warning: `Could not parse mongo URL: ${tcpUrl}` };
  }
  const env = parent.environment ?? {};
  const user =
    env.MONGO_INITDB_ROOT_USERNAME ??
    env.MONGODB_ROOT_USER ??
    env.MONGODB_USERNAME ??
    null;
  const pass =
    env.MONGO_INITDB_ROOT_PASSWORD ??
    env.MONGODB_ROOT_PASSWORD ??
    env.MONGODB_PASSWORD ??
    null;
  const userinfo =
    user && pass ? `${enc(user)}:${enc(pass)}@` : user ? `${enc(user)}@` : "";
  const auth = user ? "?authSource=admin" : "";
  return {
    uri: `mongodb://${userinfo}${hp.host}:${hp.port}/${enc(databaseName)}${auth}`,
    warning: null,
  };
};

const isMongoContainer = (r: AspireResource): boolean => {
  if (r.resourceType !== "Container") return false;
  const image = (r.properties?.["container.image"] as string | undefined) ?? "";
  return /mongo/i.test(image);
};

/**
 * Build the full per-apphost view: every resource is listed, with mongo-related
 * ones flagged as selectable and pre-populated with a connection URI.
 */
const summarizeResources = (
  resources: AspireResource[],
): AspireResourceSummary[] => {
  const byName = new Map(resources.map((r) => [r.name, r] as const));

  const summarize = (r: AspireResource): AspireResourceSummary => {
    const parentName =
      (r.properties?.["resource.parentName"] as string | undefined) ??
      r.relationships?.find((rel) => rel.type === "Parent")?.resourceName ??
      null;

    const base = {
      name: r.name,
      displayName: r.displayName ?? r.name,
      resourceType: r.resourceType,
      state: r.state ?? null,
      source: r.source ?? null,
      parentName,
    };

    if (r.resourceType === "MongoDBDatabaseResource") {
      const parent = parentName ? byName.get(parentName) ?? null : null;
      if (!parent) {
        return {
          ...base,
          kind: "mongo-database",
          uri: null,
          databaseName: r.name,
          warning: parentName
            ? `Parent resource '${parentName}' not found in apphost.`
            : "MongoDBDatabaseResource has no parent.",
        };
      }
      const built = buildUriFromContainer(parent, r.name);
      return {
        ...base,
        kind: "mongo-database",
        uri: built.uri,
        databaseName: r.name,
        warning: built.warning,
      };
    }

    if (isMongoContainer(r)) {
      const tcpUrl = r.urls?.find((u) => u.url.startsWith("tcp://"))?.url;
      let uri: string | null = null;
      let warning: string | null = null;
      if (!tcpUrl) {
        warning = "Mongo container has no published URL.";
      } else {
        const built = buildUriFromContainer(r, "");
        // buildUriFromContainer with empty db produces "mongodb://.../?..."; trim trailing slash before query.
        uri = built.uri ? built.uri.replace(/\/(\?|$)/, "/$1") : null;
        warning = built.warning;
      }
      return {
        ...base,
        kind: "mongo-server",
        uri,
        databaseName: null,
        warning,
      };
    }

    return {
      ...base,
      kind: "other",
      uri: null,
      databaseName: null,
      warning: null,
    };
  };

  return resources.map(summarize);
};

/** Backwards-compat: flat list of mongo-database targets. */
const extractMongoTargets = (
  appHostPath: string,
  resources: AspireResource[],
): AspireMongoTarget[] => {
  const summaries = summarizeResources(resources);
  return summaries
    .filter((s) => s.kind === "mongo-database")
    .map((s) => ({
      appHostPath,
      appHostName: appHostNameOf(appHostPath),
      resourceName: s.name,
      parentName: s.parentName,
      databaseName: s.databaseName ?? s.name,
      uri: s.uri,
      warning: s.warning,
    }));
};

/** Minimum Aspire CLI major version. `aspire describe --apphost ...` and the
 *  per-resource JSON shape we parse here landed in 13.x. */
export const MIN_ASPIRE_MAJOR = 13;

export interface AspireCliInfo {
  installed: boolean;
  version: string | null;
  major: number | null;
  supported: boolean;
}

export const getAspireCliInfo = async (): Promise<AspireCliInfo> => {
  let raw: string;
  try {
    raw = await runAspire(["--version"], 3_000);
  } catch {
    return { installed: false, version: null, major: null, supported: false };
  }
  const trimmed = raw.trim();
  // Output looks like `13.2.4+dd5916f...` — drop any build metadata after `+`
  // and pull the numeric prefix.
  const numericMatch = trimmed.split(/\s+/)[0]?.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  const major = numericMatch ? Number(numericMatch[1]) : null;
  return {
    installed: true,
    version: trimmed || null,
    major,
    supported: major !== null && major >= MIN_ASPIRE_MAJOR,
  };
};

/**
 * List every running apphost and its full resource tree, with mongo-related
 * resources flagged as selectable.
 *
 * `aspire ps` returns the apphost list cheaply but `--resources` strips the
 * `environment` block (where mongo credentials live). So we use `ps` purely to
 * enumerate apphost paths, then run `describe --apphost <path>` per apphost
 * to get full resource details.
 */
export const discoverAspireAppHosts = async (): Promise<AspireAppHostInfo[]> => {
  const raw = await runAspire([
    "ps",
    "--format",
    "json",
    "--nologo",
    "--non-interactive",
  ]);
  const json = stripPreamble(raw).trim();
  if (!json) return [];
  let appHosts: AspireAppHost[];
  try {
    appHosts = JSON.parse(json) as AspireAppHost[];
  } catch (e) {
    throw new Error(
      `aspire ps returned non-JSON output: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const out: AspireAppHostInfo[] = [];
  for (const ah of appHosts) {
    let described: { resources?: AspireResource[] };
    try {
      const raw2 = await runAspire([
        "describe",
        "--apphost",
        ah.appHostPath,
        "--format",
        "json",
        "--nologo",
        "--non-interactive",
      ]);
      described = JSON.parse(stripPreamble(raw2).trim()) as {
        resources?: AspireResource[];
      };
    } catch {
      // Skip apphosts we couldn't describe — usually means it's still starting.
      continue;
    }
    out.push({
      appHostPath: ah.appHostPath,
      appHostName: appHostNameOf(ah.appHostPath),
      appHostPid: ah.appHostPid,
      dashboardUrl: ah.dashboardUrl ?? null,
      resources: summarizeResources(described.resources ?? []),
    });
  }
  return out;
};

/**
 * Re-resolve a single apphost+resource pair. Used when a saved connection is
 * aspire-backed: every connect re-queries to pick up port/cred rotation.
 */
export const resolveAspireConnectionUri = async (
  appHostPath: string,
  resourceName: string,
): Promise<string> => {
  const raw = await runAspire([
    "describe",
    "--apphost",
    appHostPath,
    "--format",
    "json",
    "--nologo",
    "--non-interactive",
  ]);
  const json = stripPreamble(raw).trim();
  let parsed: { resources?: AspireResource[] };
  try {
    parsed = JSON.parse(json) as { resources?: AspireResource[] };
  } catch (e) {
    throw new Error(
      `aspire describe returned non-JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const summaries = summarizeResources(parsed.resources ?? []);
  const match = summaries.find(
    (s) => s.name === resourceName && s.kind !== "other",
  );
  if (!match) {
    throw new Error(
      `Aspire mongo resource '${resourceName}' not found in apphost '${appHostPath}'. Is the apphost running?`,
    );
  }
  if (!match.uri) {
    throw new Error(
      match.warning ??
        `Aspire resource '${resourceName}' has no usable connection.`,
    );
  }
  return match.uri;
};
