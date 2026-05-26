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
  workspacesEnabled: boolean;
  devMode: boolean;
  dbToolsAvailable: boolean;
}

export interface DatabaseCollectionStats {
  name: string;
  type: string;
  count: number | null;
  size: number | null;
  storageSize: number | null;
  avgObjSize: number | null;
  totalIndexSize: number | null;
  indexCount: number | null;
}

export interface DatabaseStats {
  database: string;
  collections: DatabaseCollectionStats[];
  stats: {
    dataSize: number | null;
    storageSize: number | null;
    indexSize: number | null;
    totalSize: number | null;
    fsUsedSize: number | null;
    fsTotalSize: number | null;
    collections: number | null;
    views: number | null;
    objects: number | null;
    indexes: number | null;
    avgObjSize: number | null;
  };
}

export interface ClearCollectionsResult {
  ok: true;
  database: string;
  results: Array<{
    name: string;
    deletedCount: number | null;
    error?: string;
  }>;
}

export interface ToolResult {
  ok: boolean;
  code?: number;
  stderr?: string;
  error?: string;
}

export interface Workspace {
  id: string;
  name: string;
  folderPath: string;
  color: string | null;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number | null;
}

export interface WorkspaceTreeEntry {
  name: string;
  kind: "file" | "dir";
  size: number | null;
  mtime: number | null;
}

export interface WorkspaceFile {
  path: string;
  raw: string;
  mtime: number;
  size: number;
}

export interface WorkspaceGitInfo {
  rootIsRepo: boolean;
  branch?: string;
  shortSha?: string;
  dirty?: boolean;
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

export interface CollectionListEntry {
  name: string;
  type: string;
  count: number | null;
  gridFs: { bucket: string; role: "files" | "chunks" } | null;
}

export interface GridFsBucketInfo {
  name: string;
  filesCollection: string;
  chunksCollection: string;
  fileCount: number | null;
}

export interface GridFsFileMeta {
  _id: unknown;
  filename: string;
  length: number;
  chunkSize: number;
  uploadDate: unknown;
  contentType?: string | null;
  md5?: string | null;
  metadata?: Record<string, unknown> | null;
}

export const gridFsDownloadUrl = (params: {
  cid: string;
  bucket: string;
  fileId: string;
  database?: string;
  inline?: boolean;
}): string => {
  const qs = new URLSearchParams();
  if (params.database) qs.set("database", params.database);
  if (params.inline) qs.set("inline", "1");
  const suffix = qs.toString() ? `?${qs}` : "";
  return `${cidPath(params.cid)}/gridfs/${encodeURIComponent(params.bucket)}/download/${encodeURIComponent(params.fileId)}${suffix}`;
};

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
    collections: CollectionListEntry[];
  }> {
    const qs = database ? `?database=${encodeURIComponent(database)}` : "";
    const res = await fetch(`${cidPath(cid)}/collections${qs}`);
    return handleJson(res) as Promise<{
      database: string;
      collections: CollectionListEntry[];
    }>;
  },

  // ── GridFS ──────────────────────────────────────────────────────────────────
  async listGridFsBuckets(
    cid: string,
    database?: string,
  ): Promise<{
    database: string;
    buckets: GridFsBucketInfo[];
  }> {
    const qs = database ? `?database=${encodeURIComponent(database)}` : "";
    const res = await fetch(`${cidPath(cid)}/gridfs${qs}`);
    return handleJson(res) as Promise<{
      database: string;
      buckets: GridFsBucketInfo[];
    }>;
  },

  async listGridFsFiles(params: {
    cid: string;
    bucket: string;
    database?: string;
    search?: string;
    skip?: number;
    limit?: number;
  }): Promise<{
    bucket: string;
    database: string;
    total: number;
    skip: number;
    limit: number;
    hasMore: boolean;
    files: GridFsFileMeta[];
  }> {
    const qs = new URLSearchParams();
    if (params.database) qs.set("database", params.database);
    if (params.search) qs.set("search", params.search);
    if (params.skip != null) qs.set("skip", String(params.skip));
    if (params.limit != null) qs.set("limit", String(params.limit));
    const suffix = qs.toString() ? `?${qs}` : "";
    const res = await fetch(
      `${cidPath(params.cid)}/gridfs/${encodeURIComponent(params.bucket)}/files${suffix}`,
    );
    return handleJson(res) as Promise<{
      bucket: string;
      database: string;
      total: number;
      skip: number;
      limit: number;
      hasMore: boolean;
      files: GridFsFileMeta[];
    }>;
  },

  async deleteGridFsFile(params: {
    cid: string;
    bucket: string;
    fileId: string;
    database?: string;
  }): Promise<void> {
    const qs = params.database
      ? `?database=${encodeURIComponent(params.database)}`
      : "";
    const res = await fetch(
      `${cidPath(params.cid)}/gridfs/${encodeURIComponent(params.bucket)}/files/${encodeURIComponent(params.fileId)}${qs}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ApiError(res.status, text || res.statusText);
    }
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

  /** PATCH = updateOne with an operator body, e.g. `{ $set: {…}, $unset: {…} }`. */
  async patchDocument(
    cid: string,
    name: string,
    id: string,
    updateEJSONText: string,
    database?: string,
  ): Promise<{ document: Record<string, unknown> }> {
    const qs = database ? `?database=${encodeURIComponent(database)}` : "";
    const res = await fetch(
      `${cidPath(cid)}/collections/${encodeURIComponent(name)}/document/${encodeURIComponent(id)}${qs}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: updateEJSONText,
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

  // ── Database-level operations ───────────────────────────────────────────────
  async getDatabaseStats(cid: string, db: string): Promise<DatabaseStats> {
    const res = await fetch(
      `${cidPath(cid)}/databases/${encodeURIComponent(db)}/stats`,
    );
    return handlePlainJson(res) as Promise<DatabaseStats>;
  },

  async clearDatabaseCollections(
    cid: string,
    db: string,
  ): Promise<ClearCollectionsResult> {
    const res = await fetch(
      `${cidPath(cid)}/databases/${encodeURIComponent(db)}/clear-collections`,
      { method: "POST" },
    );
    return (await handlePlainJson(res)) as ClearCollectionsResult;
  },

  async dropDatabase(cid: string, db: string): Promise<{ ok: true }> {
    const res = await fetch(
      `${cidPath(cid)}/databases/${encodeURIComponent(db)}/drop`,
      { method: "POST" },
    );
    return (await handlePlainJson(res)) as { ok: true };
  },

  async exportCollection(
    cid: string,
    db: string,
    collection: string,
  ): Promise<Blob> {
    const qs = `?collection=${encodeURIComponent(collection)}`;
    const res = await fetch(
      `${cidPath(cid)}/databases/${encodeURIComponent(db)}/export${qs}`,
      { method: "POST" },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let message = res.statusText;
      try {
        const parsed = text ? (JSON.parse(text) as { error?: string }) : null;
        if (parsed?.error) message = parsed.error;
      } catch {
        if (text) message = text;
      }
      throw new ApiError(res.status, message);
    }
    return res.blob();
  },

  async importCollection(params: {
    cid: string;
    db: string;
    collection: string;
    file: Blob;
    mode?: "insert" | "upsert" | "merge";
    drop?: boolean;
  }): Promise<ToolResult> {
    const qs = new URLSearchParams({
      collection: params.collection,
      mode: params.mode ?? "insert",
    });
    if (params.drop) qs.set("drop", "true");
    const res = await fetch(
      `${cidPath(params.cid)}/databases/${encodeURIComponent(params.db)}/import?${qs.toString()}`,
      {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: params.file,
      },
    );
    return (await handlePlainJson(res)) as ToolResult;
  },

  async dumpDatabase(cid: string, db: string): Promise<Blob> {
    const res = await fetch(
      `${cidPath(cid)}/databases/${encodeURIComponent(db)}/dump`,
      { method: "POST" },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ApiError(res.status, text || res.statusText);
    }
    return res.blob();
  },

  async restoreDatabase(params: {
    cid: string;
    db: string;
    file: Blob;
    drop?: boolean;
  }): Promise<ToolResult> {
    const qs = new URLSearchParams();
    if (params.drop) qs.set("drop", "true");
    const url = `${cidPath(params.cid)}/databases/${encodeURIComponent(params.db)}/restore${qs.toString() ? `?${qs}` : ""}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: params.file,
    });
    return (await handlePlainJson(res)) as ToolResult;
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

  // ── Workspaces ──────────────────────────────────────────────────────────────
  async listWorkspaces(): Promise<{ enabled: boolean; workspaces: Workspace[] }> {
    const res = await fetch("/api/workspaces");
    return handlePlainJson(res) as Promise<{
      enabled: boolean;
      workspaces: Workspace[];
    }>;
  },

  async listFsDirectory(targetPath?: string): Promise<{
    path: string;
    parent: string | null;
    home: string;
    entries: Array<{ name: string; hidden: boolean }>;
    readError: string | null;
  }> {
    const qs = targetPath
      ? `?path=${encodeURIComponent(targetPath)}`
      : "";
    const res = await fetch(`/api/workspaces/fs${qs}`);
    return handlePlainJson(res) as Promise<{
      path: string;
      parent: string | null;
      home: string;
      entries: Array<{ name: string; hidden: boolean }>;
      readError: string | null;
    }>;
  },

  async createWorkspace(input: {
    name: string;
    folderPath: string;
    color?: string | null;
    createIfMissing?: boolean;
  }): Promise<Workspace> {
    const res = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    return handlePlainJson(res) as Promise<Workspace>;
  },

  async updateWorkspace(
    id: string,
    input: { name?: string; color?: string | null; folderPath?: string },
  ): Promise<Workspace> {
    const res = await fetch(`/api/workspaces/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    return handlePlainJson(res) as Promise<Workspace>;
  },

  async deleteWorkspace(id: string): Promise<void> {
    const res = await fetch(`/api/workspaces/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ApiError(res.status, text || res.statusText);
    }
  },

  async listWorkspaceTree(
    id: string,
    relPath: string,
  ): Promise<{ path: string; entries: WorkspaceTreeEntry[] }> {
    const qs = `?path=${encodeURIComponent(relPath)}`;
    const res = await fetch(`/api/workspaces/${encodeURIComponent(id)}/tree${qs}`);
    return handlePlainJson(res) as Promise<{
      path: string;
      entries: WorkspaceTreeEntry[];
    }>;
  },

  async readWorkspaceFile(id: string, relPath: string): Promise<WorkspaceFile> {
    const qs = `?path=${encodeURIComponent(relPath)}`;
    const res = await fetch(`/api/workspaces/${encodeURIComponent(id)}/file${qs}`);
    return handlePlainJson(res) as Promise<WorkspaceFile>;
  },

  async writeWorkspaceFile(
    id: string,
    relPath: string,
    raw: string,
    expectedMtime?: number | null,
  ): Promise<{ path: string; mtime: number; size: number }> {
    const qs = `?path=${encodeURIComponent(relPath)}`;
    const res = await fetch(`/api/workspaces/${encodeURIComponent(id)}/file${qs}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ raw, expectedMtime: expectedMtime ?? null }),
    });
    return handlePlainJson(res) as Promise<{
      path: string;
      mtime: number;
      size: number;
    }>;
  },

  async deleteWorkspacePath(id: string, relPath: string): Promise<void> {
    const qs = `?path=${encodeURIComponent(relPath)}`;
    const res = await fetch(`/api/workspaces/${encodeURIComponent(id)}/file${qs}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ApiError(res.status, text || res.statusText);
    }
  },

  async createWorkspaceFolder(
    id: string,
    relPath: string,
  ): Promise<{ path: string }> {
    const qs = `?path=${encodeURIComponent(relPath)}`;
    const res = await fetch(`/api/workspaces/${encodeURIComponent(id)}/folder${qs}`, {
      method: "POST",
    });
    return handlePlainJson(res) as Promise<{ path: string }>;
  },

  async moveWorkspacePath(
    id: string,
    from: string,
    to: string,
  ): Promise<{ from: string; to: string }> {
    const res = await fetch(`/api/workspaces/${encodeURIComponent(id)}/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from, to }),
    });
    return handlePlainJson(res) as Promise<{ from: string; to: string }>;
  },

  async getWorkspaceGit(id: string): Promise<WorkspaceGitInfo> {
    const res = await fetch(`/api/workspaces/${encodeURIComponent(id)}/git`);
    return handlePlainJson(res) as Promise<WorkspaceGitInfo>;
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

export type UuidRepresentation =
  | "standard"
  | "csharpLegacy"
  | "javaLegacy"
  | "pythonLegacy"
  | "unspecified";

export const extractIdString = (id: unknown): string => {
  if (typeof id === "string") return id;
  if (id && typeof id === "object" && "$oid" in (id as Record<string, unknown>)) {
    return String((id as Record<string, unknown>).$oid);
  }
  const binaryUuid = binaryToCanonicalUuid(id, "standard");
  if (binaryUuid) return binaryUuid;
  if (id && typeof id === "object" && "toHexString" in (id as { toHexString?: () => string })) {
    const f = (id as { toHexString?: () => string }).toHexString;
    if (typeof f === "function") return f.call(id);
  }
  return String(id);
};

const reorderBytesForRepresentation = (
  bytes: Uint8Array,
  rep: UuidRepresentation,
): Uint8Array => {
  if (rep === "standard" || rep === "pythonLegacy" || rep === "unspecified") {
    return bytes;
  }
  const out = new Uint8Array(16);
  if (rep === "csharpLegacy") {
    out[0] = bytes[3]!;
    out[1] = bytes[2]!;
    out[2] = bytes[1]!;
    out[3] = bytes[0]!;
    out[4] = bytes[5]!;
    out[5] = bytes[4]!;
    out[6] = bytes[7]!;
    out[7] = bytes[6]!;
    for (let i = 8; i < 16; i++) out[i] = bytes[i]!;
    return out;
  }
  // javaLegacy: reverse first 8 bytes and last 8 bytes
  for (let i = 0; i < 8; i++) out[i] = bytes[7 - i]!;
  for (let i = 0; i < 8; i++) out[8 + i] = bytes[15 - i]!;
  return out;
};

/**
 * Extract raw UUID bytes + subtype from either a bson Binary/UUID instance
 * (what EJSON.parse produces with `relaxed: false`) or a plain `$binary`
 * EJSON-canonical object. Returns null for anything that isn't a 16-byte
 * subtype-3 or subtype-4 binary.
 */
const tryReadUuidBytes = (
  value: unknown,
): { bytes: Uint8Array; subType: 3 | 4 } | null => {
  if (!value || typeof value !== "object") return null;

  const inst = value as {
    _bsontype?: string;
    sub_type?: number;
    buffer?: Uint8Array;
  };
  if (inst._bsontype === "Binary") {
    const sub = inst.sub_type;
    const buf = inst.buffer;
    if ((sub === 3 || sub === 4) && buf instanceof Uint8Array && buf.length >= 16) {
      return { bytes: buf.subarray(0, 16), subType: sub };
    }
    return null;
  }

  if ("$binary" in (value as Record<string, unknown>)) {
    const b = (value as Record<string, unknown>).$binary as
      | { base64?: string; subType?: string }
      | undefined;
    if (!b || typeof b.base64 !== "string") return null;
    if (b.subType !== "04" && b.subType !== "03") return null;
    try {
      const bin = atob(b.base64);
      if (bin.length !== 16) return null;
      const bytes = new Uint8Array(16);
      for (let i = 0; i < 16; i++) bytes[i] = bin.charCodeAt(i);
      return { bytes, subType: b.subType === "04" ? 4 : 3 };
    } catch {
      return null;
    }
  }

  return null;
};

const bytesToCanonicalHex = (bytes: Uint8Array): string => {
  let hex = "";
  for (let i = 0; i < 16; i++) hex += bytes[i]!.toString(16).padStart(2, "0");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
};

const binaryToCanonicalUuid = (
  value: unknown,
  representation: UuidRepresentation,
): string | null => {
  const read = tryReadUuidBytes(value);
  if (!read) return null;
  // Subtype 4 is always Standard regardless of the representation setting.
  // Subtype 3 is a legacy UUID whose byte order depends on the driver that
  // wrote it — see the MongoDB Guid representation table.
  const bytes =
    read.subType === 3
      ? reorderBytesForRepresentation(read.bytes, representation)
      : read.bytes;
  return bytesToCanonicalHex(bytes);
};

export const isBsonUuid = (value: unknown): boolean =>
  tryReadUuidBytes(value) !== null;

export const formatUuid = (
  value: unknown,
  representation: UuidRepresentation = "standard",
): string | null => binaryToCanonicalUuid(value, representation);

const uuidMarker = (
  subType: 3 | 4,
  representation: UuidRepresentation,
): string => {
  if (subType === 4) return "UUID";
  switch (representation) {
    case "csharpLegacy":
      return "CSUUID";
    case "javaLegacy":
      return "JUUID";
    case "pythonLegacy":
      return "PYUUID";
    case "unspecified":
    case "standard":
    default:
      return "UUID";
  }
};

/**
 * Walk a value tree and replace UUID binaries with Compass-style marker
 * strings (`UUID('...')`, `CSUUID('...')`, `JUUID('...')`, `PYUUID('...')`)
 * using the given representation for subtype-3 byte ordering. Single quotes
 * inside so JSON.stringify doesn't escape them — the resulting JSON shows
 * `"UUID('hex')"` instead of `"UUID(\"hex\")"`. Read-only views use this so
 * users see readable UUIDs instead of raw `$binary` blobs or destructured
 * Binary instances; edit paths must NOT use this — the marker strings don't
 * round-trip through EJSON.parse for legacy subtypes.
 *
 * Other bson runtime instances (Long, Decimal128, ObjectId, etc.) are
 * returned as-is so EJSON.stringify can serialize them through their normal
 * `toExtendedJSON()` paths instead of having their internal fields walked.
 */
/**
 * Walk a value tree and unwrap BSON types / canonical-EJSON wrappers into the
 * plainest JSON representation that still reads naturally — the same flavour
 * the result-table cells use. Numbers become numbers, ObjectIds and UUIDs
 * become plain hex/dash strings, dates become ISO strings, Decimal128 becomes
 * its decimal string. Intended for READ-ONLY views; edit paths must keep
 * canonical EJSON so saves round-trip with full type fidelity.
 */
export const humanizeForDisplay = (
  value: unknown,
  representation: UuidRepresentation,
): unknown => {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();

  const uuid = binaryToCanonicalUuid(value, representation);
  if (uuid !== null) return uuid;

  const bsonType = (value as { _bsontype?: string })._bsontype;
  if (bsonType) {
    switch (bsonType) {
      case "ObjectId":
      case "ObjectID": {
        const f = (value as { toHexString?: () => string }).toHexString;
        if (typeof f === "function") return f.call(value);
        return String(value);
      }
      case "Long":
      case "Int32":
      case "Double": {
        const f = (value as { toNumber?: () => number }).toNumber;
        if (typeof f === "function") {
          const n = f.call(value);
          if (Number.isFinite(n)) return n;
        }
        return String(value);
      }
      case "Decimal128":
        return String(value);
      case "BSONSymbol":
      case "Symbol":
        return String(value);
      case "BSONRegExp": {
        const obj = value as { pattern?: string; options?: string };
        return `/${obj.pattern ?? ""}/${obj.options ?? ""}`;
      }
      case "MinKey":
        return "MinKey()";
      case "MaxKey":
        return "MaxKey()";
      case "Binary": {
        // Non-UUID binary (UUID was already handled above).
        const bin = value as { toString: (encoding?: string) => string };
        return `Binary('${bin.toString("base64")}')`;
      }
      default:
        return value;
    }
  }

  // Canonical-EJSON wrapper shapes (in case the input was already serialized
  // and reparsed as plain objects rather than BSON instances).
  const obj = value as Record<string, unknown>;
  if ("$oid" in obj && typeof obj.$oid === "string") return obj.$oid;
  if ("$date" in obj) {
    const d = obj.$date;
    if (typeof d === "string") return d;
    if (d && typeof d === "object" && "$numberLong" in d) {
      const n = Number((d as Record<string, unknown>).$numberLong);
      if (Number.isFinite(n)) return new Date(n).toISOString();
    }
  }
  if ("$numberInt" in obj && typeof obj.$numberInt === "string") {
    return Number(obj.$numberInt);
  }
  if ("$numberLong" in obj && typeof obj.$numberLong === "string") {
    const n = Number(obj.$numberLong);
    return Number.isFinite(n) ? n : String(obj.$numberLong);
  }
  if ("$numberDouble" in obj && typeof obj.$numberDouble === "string") {
    const n = Number(obj.$numberDouble);
    return Number.isFinite(n) ? n : String(obj.$numberDouble);
  }
  if ("$numberDecimal" in obj && typeof obj.$numberDecimal === "string") {
    return String(obj.$numberDecimal);
  }

  if (Array.isArray(value)) {
    return value.map((v) => humanizeForDisplay(v, representation));
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = humanizeForDisplay(v, representation);
  }
  return out;
};

export const prettifyUuids = (
  value: unknown,
  representation: UuidRepresentation,
): unknown => {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;

  const read = tryReadUuidBytes(value);
  if (read) {
    const hex = binaryToCanonicalUuid(value, representation)!;
    return `${uuidMarker(read.subType, representation)}('${hex}')`;
  }

  // Don't walk into other bson types — their own properties are
  // implementation details that EJSON.stringify shouldn't see.
  if ((value as { _bsontype?: string })._bsontype) return value;

  if (Array.isArray(value)) {
    return value.map((v) => prettifyUuids(v, representation));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = prettifyUuids(v, representation);
  }
  return out;
};
