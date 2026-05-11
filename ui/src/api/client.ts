import { EJSON } from "bson";

export type EJSONValue = unknown;

const handleJson = async (res: Response): Promise<unknown> => {
  const text = await res.text();
  if (!res.ok) {
    let message = res.statusText;
    try {
      const parsed = text ? (JSON.parse(text) as { error?: string }) : null;
      if (parsed?.error) message = parsed.error;
    } catch {
      if (text) message = text;
    }
    throw new ApiError(res.status, message);
  }
  if (!text) return null;
  return EJSON.parse(text, { relaxed: false });
};

/**
 * Plain JSON parse for endpoints that return config/status objects, not Mongo
 * documents. The EJSON canonical parser used by handleJson wraps numbers in
 * Int32/Double objects which React refuses to render — use this for any
 * response that doesn't carry BSON types.
 */
const handlePlainJson = async (res: Response): Promise<unknown> => {
  const text = await res.text();
  if (!res.ok) {
    let message = res.statusText;
    try {
      const parsed = text ? (JSON.parse(text) as { error?: string }) : null;
      if (parsed?.error) message = parsed.error;
    } catch {
      if (text) message = text;
    }
    throw new ApiError(res.status, message);
  }
  if (!text) return null;
  return JSON.parse(text);
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type AiProviderId = "openai" | "copilot" | "claude-code";

export interface AiConfig {
  provider: AiProviderId | null;
  baseUrl: string | null;
  model: string | null;
  copilotCliPath: string | null;
  claudeCliPath: string | null;
  apiKeySet: boolean;
  allowDataSampling: boolean;
  persisted: boolean;
}

export type ServerMode = "multi" | "standalone";

export interface ServerConfig {
  mode: ServerMode;
  standaloneConnectionId: string | null;
  logsAvailable: boolean;
}

export interface CollectionStats {
  collection: string;
  database: string;
  count: number | null;
  size: number | null;
  avgObjSize: number | null;
  storageSize: number | null;
  totalIndexSize: number | null;
  totalSize: number | null;
  indexCount: number;
  capped: boolean;
  max: number | null;
  sharded: boolean;
  indexSizes: Record<string, number>;
  raw: Record<string, unknown>;
}

export interface IndexInfo {
  name: string;
  key: Record<string, 1 | -1 | string>;
  unique: boolean;
  sparse: boolean;
  hidden: boolean;
  partialFilterExpression: Record<string, unknown> | null;
  expireAfterSeconds: number | null;
  collation: Record<string, unknown> | null;
  v: number | null;
  ops: number | null;
  since: unknown;
}

export interface CollectionIndexes {
  collection: string;
  database: string;
  indexes: IndexInfo[];
  usageAvailable: boolean;
}

export interface AspireRef {
  appHostPath: string;
  resourceName: string;
}

export type ConnectionSource = "docker" | null;

export type OidcProvider = "azure-cli" | "azure-browser" | null;

export interface ConnectionPublic {
  id: string;
  name: string;
  defaultDatabase: string | null;
  effectiveDefaultDatabase: string | null;
  color: string | null;
  uriRedacted: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
  aspire: AspireRef | null;
  source: ConnectionSource;
  oidcProvider: OidcProvider;
  oidcTokenAudience: string | null;
  azureClientId: string | null;
  azureTenantId: string | null;
}

export interface DiscoveredMongo {
  containerId: string;
  containerName: string;
  image: string;
  hostPort: number | null;
  username: string | null;
  hasPassword: boolean;
  uri: string | null;
  warning: string | null;
}

export interface DiscoveryResult {
  ok: boolean;
  socket?: string;
  error?: string;
  containers: DiscoveredMongo[];
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
  uri: string | null;
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

export interface AspireCliInfo {
  installed: boolean;
  version: string | null;
  major: number | null;
  supported: boolean;
}

export interface AspireDiscoveryResult {
  ok: boolean;
  error?: string;
  cli?: AspireCliInfo;
  appHosts: AspireAppHostInfo[];
}

const cidPath = (cid: string) => `/api/connections/${encodeURIComponent(cid)}`;

export const api = {
  async getConfig(): Promise<ServerConfig> {
    const res = await fetch("/api/config");
    return handleJson(res) as Promise<ServerConfig>;
  },

  async revealLogs(): Promise<{ ok: boolean; path?: string; error?: string }> {
    const res = await fetch("/api/system/reveal-logs", { method: "POST" });
    return handlePlainJson(res) as Promise<{
      ok: boolean;
      path?: string;
      error?: string;
    }>;
  },

  async getKeyHealth(): Promise<{ healthy: boolean; undecryptableCount: number }> {
    const res = await fetch("/api/system/key-health");
    return handlePlainJson(res) as Promise<{
      healthy: boolean;
      undecryptableCount: number;
    }>;
  },

  async resetEncrypted(): Promise<{ ok: boolean; removedConnections: number }> {
    const res = await fetch("/api/system/reset-encrypted", { method: "POST" });
    return handlePlainJson(res) as Promise<{
      ok: boolean;
      removedConnections: number;
    }>;
  },

  // ── Connection management ───────────────────────────────────────────────────
  async listConnections(): Promise<{ connections: ConnectionPublic[] }> {
    const res = await fetch("/api/connections");
    return handleJson(res) as Promise<{ connections: ConnectionPublic[] }>;
  },

  async createConnection(input: {
    name: string;
    uri: string;
    defaultDatabase?: string | null;
    color?: string | null;
    aspire?: AspireRef | null;
    source?: ConnectionSource;
    oidcProvider?: OidcProvider;
    oidcTokenAudience?: string | null;
    azureClientId?: string | null;
    azureTenantId?: string | null;
  }): Promise<ConnectionPublic> {
    const res = await fetch("/api/connections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    return handleJson(res) as Promise<ConnectionPublic>;
  },

  async updateConnection(
    id: string,
    input: Partial<{
      name: string;
      uri: string;
      defaultDatabase: string | null;
      color: string | null;
      aspire: AspireRef | null;
      source: ConnectionSource;
      oidcProvider: OidcProvider;
      oidcTokenAudience: string | null;
      azureClientId: string | null;
      azureTenantId: string | null;
    }>,
  ): Promise<ConnectionPublic> {
    const res = await fetch(`/api/connections/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    return handleJson(res) as Promise<ConnectionPublic>;
  },

  async deleteConnection(id: string): Promise<void> {
    const res = await fetch(`/api/connections/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ApiError(res.status, text || res.statusText);
    }
  },

  async getConnectionSecret(id: string): Promise<{ uri: string }> {
    const res = await fetch(
      `/api/connections/${encodeURIComponent(id)}/secret`,
    );
    return handlePlainJson(res) as Promise<{ uri: string }>;
  },

  async testConnection(id: string): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch(`/api/connections/${encodeURIComponent(id)}/test`, {
      method: "POST",
    });
    const data = (await handlePlainJson(res)) as { ok: boolean; error?: string };
    return data;
  },

  async discoverDocker(): Promise<DiscoveryResult> {
    const res = await fetch("/api/discovery/docker");
    return handlePlainJson(res) as Promise<DiscoveryResult>;
  },

  async discoverAspire(): Promise<AspireDiscoveryResult> {
    const res = await fetch("/api/discovery/aspire");
    return handlePlainJson(res) as Promise<AspireDiscoveryResult>;
  },

  async testUri(uri: string): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch("/api/connections/test-uri", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uri }),
    });
    return handlePlainJson(res) as Promise<{ ok: boolean; error?: string }>;
  },

  async listDatabases(cid: string): Promise<{
    databases: Array<{ name: string; sizeOnDisk: number | null; empty: boolean }>;
  }> {
    const res = await fetch(`${cidPath(cid)}/databases`);
    return handleJson(res) as Promise<{
      databases: Array<{ name: string; sizeOnDisk: number | null; empty: boolean }>;
    }>;
  },

  // ── Connection-scoped operations ────────────────────────────────────────────
  async listCollections(
    cid: string,
    database?: string,
  ): Promise<{
    database: string;
    collections: Array<{ name: string; type: string; count: number | null }>;
  }> {
    const qs = database ? `?database=${encodeURIComponent(database)}` : "";
    const res = await fetch(`${cidPath(cid)}/collections${qs}`);
    return handleJson(res) as Promise<{
      database: string;
      collections: Array<{ name: string; type: string; count: number | null }>;
    }>;
  },

  async findDocuments(params: {
    cid: string;
    database?: string;
    name: string;
    filter?: string;
    sort?: string;
    projection?: string;
    skip?: number;
    limit?: number;
  }): Promise<{
    documents: Array<Record<string, unknown>>;
    total: number;
    skip: number;
    limit: number;
    hasMore: boolean;
  }> {
    const qs = params.database ? `?database=${encodeURIComponent(params.database)}` : "";
    const res = await fetch(
      `${cidPath(params.cid)}/collections/${encodeURIComponent(params.name)}/find${qs}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filter: params.filter,
          sort: params.sort,
          projection: params.projection,
          skip: params.skip,
          limit: params.limit,
        }),
      },
    );
    return handleJson(res) as Promise<{
      documents: Array<Record<string, unknown>>;
      total: number;
      skip: number;
      limit: number;
      hasMore: boolean;
    }>;
  },

  async getDocument(
    cid: string,
    name: string,
    id: string,
    database?: string,
  ): Promise<{ document: Record<string, unknown> }> {
    const qs = database ? `?database=${encodeURIComponent(database)}` : "";
    const res = await fetch(
      `${cidPath(cid)}/collections/${encodeURIComponent(name)}/document/${encodeURIComponent(id)}${qs}`,
    );
    return handleJson(res) as Promise<{ document: Record<string, unknown> }>;
  },

  async deleteDocument(
    cid: string,
    name: string,
    id: string,
    database?: string,
  ): Promise<void> {
    const qs = database ? `?database=${encodeURIComponent(database)}` : "";
    const res = await fetch(
      `${cidPath(cid)}/collections/${encodeURIComponent(name)}/document/${encodeURIComponent(id)}${qs}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ApiError(res.status, text || res.statusText);
    }
  },

  async putDocument(
    cid: string,
    name: string,
    id: string,
    bodyEJSONText: string,
    database?: string,
  ): Promise<{ document: Record<string, unknown> }> {
    const qs = database ? `?database=${encodeURIComponent(database)}` : "";
    const res = await fetch(
      `${cidPath(cid)}/collections/${encodeURIComponent(name)}/document/${encodeURIComponent(id)}${qs}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: bodyEJSONText,
      },
    );
    return handleJson(res) as Promise<{ document: Record<string, unknown> }>;
  },

  async getSchema(
    cid: string,
    name: string,
    sample = 50,
    database?: string,
  ): Promise<{
    collection: string;
    sampleSize: number;
    fields: Array<{ path: string; types: string[]; examples: unknown[] }>;
  }> {
    const qs = database
      ? `?sample=${sample}&database=${encodeURIComponent(database)}`
      : `?sample=${sample}`;
    const res = await fetch(
      `${cidPath(cid)}/collections/${encodeURIComponent(name)}/schema${qs}`,
    );
    return handleJson(res) as Promise<{
      collection: string;
      sampleSize: number;
      fields: Array<{ path: string; types: string[]; examples: unknown[] }>;
    }>;
  },

  async runConsole(params: {
    cid: string;
    command: string;
    database?: string;
    skip?: number;
    limit?: number;
  }): Promise<{
    result: unknown;
    skip: number;
    limit: number;
    hasMore: boolean;
    paged: boolean;
    elapsedMs: number;
    error: string | null;
  }> {
    const qs = params.database
      ? `?database=${encodeURIComponent(params.database)}`
      : "";
    const res = await fetch(`${cidPath(params.cid)}/console${qs}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command: params.command,
        skip: params.skip,
        limit: params.limit,
      }),
    });
    return handleJson(res) as Promise<{
      result: unknown;
      skip: number;
      limit: number;
      hasMore: boolean;
      paged: boolean;
      elapsedMs: number;
      error: string | null;
    }>;
  },

  async runShell(cid: string, commandJson: string, database?: string): Promise<unknown> {
    const qs = database ? `?database=${encodeURIComponent(database)}` : "";
    const res = await fetch(`${cidPath(cid)}/shell${qs}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: commandJson,
    });
    return handleJson(res);
  },

  // ── AI ──────────────────────────────────────────────────────────────────────
  async getAiStatus(): Promise<{
    provider: AiProviderId;
    configured: boolean;
    baseUrl?: string;
    model: string;
    setupHint: string;
  }> {
    const res = await fetch("/api/ai/status");
    return handleJson(res) as Promise<{
      provider: AiProviderId;
      configured: boolean;
      baseUrl?: string;
      model: string;
      setupHint: string;
    }>;
  },

  async getAiConfig(): Promise<AiConfig> {
    const res = await fetch("/api/ai/config");
    return handleJson(res) as Promise<AiConfig>;
  },

  async putAiConfig(input: {
    provider: AiProviderId;
    apiKey?: string | null;
    baseUrl?: string | null;
    model?: string | null;
    copilotCliPath?: string | null;
    claudeCliPath?: string | null;
    allowDataSampling?: boolean;
  }): Promise<AiConfig> {
    const res = await fetch("/api/ai/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    return handleJson(res) as Promise<AiConfig>;
  },

  async clearAiConfig(): Promise<void> {
    const res = await fetch("/api/ai/config", { method: "DELETE" });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ApiError(res.status, text || res.statusText);
    }
  },

  async detectCopilotCli(input?: { path?: string | null }): Promise<{
    ok: boolean;
    path: string | null;
    source: "override" | "env" | "candidate" | "where" | "path" | "fallback";
    version: string | null;
    error?: string;
  }> {
    const res = await fetch("/api/ai/copilot-cli/detect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: input?.path ?? null }),
    });
    return handlePlainJson(res) as Promise<{
      ok: boolean;
      path: string | null;
      source: "override" | "env" | "candidate" | "where" | "path" | "fallback";
      version: string | null;
      error?: string;
    }>;
  },

  async detectClaudeCli(input?: { path?: string | null }): Promise<{
    ok: boolean;
    path: string | null;
    source: "override" | "env" | "candidate" | "where" | "path" | "fallback";
    version: string | null;
    error?: string;
  }> {
    const res = await fetch("/api/ai/claude-cli/detect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: input?.path ?? null }),
    });
    return handlePlainJson(res) as Promise<{
      ok: boolean;
      path: string | null;
      source: "override" | "env" | "candidate" | "where" | "path" | "fallback";
      version: string | null;
      error?: string;
    }>;
  },

  async testAiConfig(input: {
    provider: AiProviderId;
    apiKey?: string | null;
    baseUrl?: string | null;
    model?: string | null;
    copilotCliPath?: string | null;
    claudeCliPath?: string | null;
  }): Promise<{
    ok: boolean;
    provider?: AiProviderId;
    modelCount?: number;
    sample?: string[];
    diagnostics?: Record<string, string | number | boolean | null>;
    error?: string;
  }> {
    const res = await fetch("/api/ai/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    return handlePlainJson(res) as Promise<{
      ok: boolean;
      provider?: AiProviderId;
      modelCount?: number;
      sample?: string[];
      diagnostics?: Record<string, string | number | boolean | null>;
      error?: string;
    }>;
  },

  async chatAi(params: {
    mode: "collection" | "console" | "shell" | "general" | "indexes";
    connectionId?: string;
    database?: string;
    collection?: string;
    model?: string;
    context?: { indexes?: string; explain?: string };
    messages: Array<{ role: "user" | "assistant"; content: string }>;
  }): Promise<{
    text: string;
    model: string;
    provider: AiProviderId;
  }> {
    const res = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });
    return handleJson(res) as Promise<{
      text: string;
      model: string;
      provider: AiProviderId;
    }>;
  },

  async getCollectionStats(
    cid: string,
    name: string,
    database?: string,
  ): Promise<CollectionStats> {
    const qs = database ? `?database=${encodeURIComponent(database)}` : "";
    const res = await fetch(
      `${cidPath(cid)}/collections/${encodeURIComponent(name)}/stats${qs}`,
    );
    return handleJson(res) as Promise<CollectionStats>;
  },

  async getCollectionIndexes(
    cid: string,
    name: string,
    database?: string,
  ): Promise<CollectionIndexes> {
    const qs = database ? `?database=${encodeURIComponent(database)}` : "";
    const res = await fetch(
      `${cidPath(cid)}/collections/${encodeURIComponent(name)}/indexes${qs}`,
    );
    return handleJson(res) as Promise<CollectionIndexes>;
  },

  async dropIndex(
    cid: string,
    name: string,
    indexName: string,
    database?: string,
  ): Promise<void> {
    const qs = database ? `?database=${encodeURIComponent(database)}` : "";
    const res = await fetch(
      `${cidPath(cid)}/collections/${encodeURIComponent(name)}/indexes/drop${qs}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: indexName }),
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ApiError(res.status, text || res.statusText);
    }
  },

  async dropCollection(
    cid: string,
    name: string,
    database?: string,
  ): Promise<void> {
    const qs = database ? `?database=${encodeURIComponent(database)}` : "";
    const res = await fetch(
      `${cidPath(cid)}/collections/${encodeURIComponent(name)}/drop${qs}`,
      { method: "POST" },
    );
    await handlePlainJson(res);
  },

  async clearCollection(
    cid: string,
    name: string,
    database?: string,
  ): Promise<{ deletedCount: number }> {
    const qs = database ? `?database=${encodeURIComponent(database)}` : "";
    const res = await fetch(
      `${cidPath(cid)}/collections/${encodeURIComponent(name)}/clear${qs}`,
      { method: "POST" },
    );
    return (await handlePlainJson(res)) as { deletedCount: number };
  },

  async createIndex(params: {
    cid: string;
    name: string;
    database?: string;
    keys: Record<string, 1 | -1 | string>;
    options?: {
      name?: string;
      unique?: boolean;
      sparse?: boolean;
      partialFilterExpression?: Record<string, unknown>;
      expireAfterSeconds?: number;
    };
  }): Promise<{ ok: boolean; name: string }> {
    const qs = params.database
      ? `?database=${encodeURIComponent(params.database)}`
      : "";
    const res = await fetch(
      `${cidPath(params.cid)}/collections/${encodeURIComponent(params.name)}/indexes/create${qs}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keys: params.keys, options: params.options }),
      },
    );
    return handleJson(res) as Promise<{ ok: boolean; name: string }>;
  },

  async runExplain(params: {
    cid: string;
    name: string;
    database?: string;
    filter?: string;
    projection?: string;
    sort?: string;
    pipeline?: string;
    limit?: number;
    skip?: number;
    verbosity?: "queryPlanner" | "executionStats" | "allPlansExecution";
  }): Promise<{ collection: string; explain: Record<string, unknown> }> {
    const qs = params.database
      ? `?database=${encodeURIComponent(params.database)}`
      : "";
    const res = await fetch(
      `${cidPath(params.cid)}/collections/${encodeURIComponent(params.name)}/explain${qs}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filter: params.filter,
          projection: params.projection,
          sort: params.sort,
          pipeline: params.pipeline,
          limit: params.limit,
          skip: params.skip,
          verbosity: params.verbosity ?? "executionStats",
        }),
      },
    );
    return handleJson(res) as Promise<{
      collection: string;
      explain: Record<string, unknown>;
    }>;
  },

  async listAiModels(): Promise<{
    provider: AiProviderId;
    default: string;
    models: Array<{ id: string; name?: string; description?: string; vendor?: string }>;
    error?: string;
  }> {
    const res = await fetch("/api/ai/models");
    return handleJson(res) as Promise<{
      provider: AiProviderId;
      default: string;
      models: Array<{ id: string; name?: string; description?: string; vendor?: string }>;
      error?: string;
    }>;
  },
};

export const stringifyEJSON = (value: unknown, pretty = true): string =>
  EJSON.stringify(value, undefined, pretty ? 2 : 0, { relaxed: false });

export const parseEJSON = (text: string): unknown =>
  EJSON.parse(text, { relaxed: false });

/** Extract { base64, subType } from either a plain EJSON binary object
 *  or a BSON Binary class instance (bson >= 5 returns class instances). */
const extractBinaryInfo = (
  value: unknown,
): { base64: string; subType: string } | null => {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  // Plain EJSON object: { $binary: { base64: "...", subType: "03" } }
  if ("$binary" in v) {
    const b = v.$binary as { base64?: string; subType?: string } | undefined;
    if (b && typeof b.base64 === "string" && typeof b.subType === "string") {
      return { base64: b.base64, subType: b.subType };
    }
  }
  // BSON Binary class instance: has sub_type (number), buffer, and toString("base64")
  if ("sub_type" in v && typeof v.sub_type === "number" && "buffer" in v) {
    try {
      const base64 = (v as { toString(enc: string): string }).toString("base64");
      if (typeof base64 === "string" && base64.length > 0) {
        return { base64, subType: v.sub_type.toString(16).padStart(2, "0") };
      }
    } catch {
      /* ignore */
    }
  }
  return null;
};

/** Decode base64 → 16 bytes, or null if length ≠ 16. */
const base64ToUuidBytes = (b64: string): number[] | null => {
  try {
    const bin = atob(b64);
    if (bin.length !== 16) return null;
    return Array.from({ length: 16 }, (_, i) => bin.charCodeAt(i));
  } catch {
    return null;
  }
};

/** Format 16 bytes as a UUID string (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx). */
const bytesToUuid = (bytes: number[]): string => {
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
};

/** Rearrange CSUUID (C# Guid, little-endian) bytes to standard UUID byte order. */
const csUuidToStandard = (b: number[]): number[] => [
  b[3], b[2], b[1], b[0],
  b[5], b[4],
  b[7], b[6],
  b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15],
];

const binaryToCanonicalUuid = (value: unknown): string | null => {
  const info = extractBinaryInfo(value);
  if (!info || info.subType !== "04") return null;
  const bytes = base64ToUuidBytes(info.base64);
  if (!bytes) return null;
  return bytesToUuid(bytes);
};

export const extractIdString = (id: unknown): string => {
  if (typeof id === "string") return id;
  if (id && typeof id === "object" && "$oid" in (id as Record<string, unknown>)) {
    return String((id as Record<string, unknown>).$oid);
  }
  const info = extractBinaryInfo(id);
  if (info) {
    const bytes = base64ToUuidBytes(info.base64);
    if (bytes) {
      if (info.subType === "04") return bytesToUuid(bytes);
      // subType 03: always decode as CSUUID for a stable API key.
      // The server's buildIdCandidates tries both CSUUID and standard byte orderings.
      if (info.subType === "03") return bytesToUuid(csUuidToStandard(bytes));
    }
    return info.base64; // non-UUID binary: return base64 as stable fallback
  }
  if (id && typeof id === "object" && "toHexString" in (id as { toHexString?: () => string })) {
    const f = (id as { toHexString?: () => string }).toHexString;
    if (typeof f === "function") return f.call(id);
  }
  return String(id);
};

/** Format a document _id for display using the user's UUID format preference. */
export const formatDocumentId = (
  id: unknown,
  format: "canonical" | "csuuid" | "juuid" | "short" | "compact" | "raw",
): string => {
  if (typeof id === "string") return id;
  if (id && typeof id === "object" && "$oid" in (id as Record<string, unknown>)) {
    return String((id as Record<string, unknown>).$oid);
  }
  const info = extractBinaryInfo(id);
  if (!info) return extractIdString(id);
  if (format === "raw") return info.base64;
  const bytes = base64ToUuidBytes(info.base64);
  if (!bytes) return info.base64;
  if (info.subType === "04") {
    const canonical = bytesToUuid(bytes);
    if (format === "short") return canonical.slice(0, 8);
    if (format === "compact") return canonical.replace(/-/g, "");
    return canonical;
  }
  if (info.subType === "03") {
    if (format === "csuuid") return bytesToUuid(csUuidToStandard(bytes));
    if (format === "juuid") return bytesToUuid(bytes);
    return info.base64;
  }
  return info.base64;
};

export const isBsonUuid = (value: unknown): boolean => {
  const info = extractBinaryInfo(value);
  return info !== null && (info.subType === "04" || info.subType === "03");
};

export const formatUuid = (
  value: unknown,
  format: "canonical" | "csuuid" | "juuid" | "short" | "compact" | "raw",
): string | null => {
  const info = extractBinaryInfo(value);
  if (!info) return null;
  const bytes = base64ToUuidBytes(info.base64);
  if (!bytes) return null;
  if (format === "raw") return info.base64;
  if (info.subType === "04") {
    const canonical = bytesToUuid(bytes);
    if (format === "short") return canonical.slice(0, 8);
    if (format === "compact") return canonical.replace(/-/g, "");
    return canonical;
  }
  if (info.subType === "03") {
    if (format === "csuuid") return bytesToUuid(csUuidToStandard(bytes));
    if (format === "juuid") return bytesToUuid(bytes);
    return null;
  }
  return null;
};
