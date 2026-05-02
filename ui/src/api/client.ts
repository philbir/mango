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
  apiKeySet: boolean;
  allowDataSampling: boolean;
  persisted: boolean;
}

export type ServerMode = "multi" | "standalone";

export interface ServerConfig {
  mode: ServerMode;
  standaloneConnectionId: string | null;
}

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
}

const cidPath = (cid: string) => `/api/connections/${encodeURIComponent(cid)}`;

export const api = {
  async getConfig(): Promise<ServerConfig> {
    const res = await fetch("/api/config");
    return handleJson(res) as Promise<ServerConfig>;
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

  async testConnection(id: string): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch(`/api/connections/${encodeURIComponent(id)}/test`, {
      method: "POST",
    });
    const data = (await handleJson(res)) as { ok: boolean; error?: string };
    return data;
  },

  async testUri(uri: string): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch("/api/connections/test-uri", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uri }),
    });
    return handleJson(res) as Promise<{ ok: boolean; error?: string }>;
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

  async generateAiCommand(params: {
    connectionId: string;
    prompt: string;
    model?: string;
    database?: string;
  }): Promise<{
    command: string;
    explanation: string;
    model: string;
    provider: AiProviderId;
  }> {
    const res = await fetch("/api/ai/command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });
    return handleJson(res) as Promise<{
      command: string;
      explanation: string;
      model: string;
      provider: AiProviderId;
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

  async runAiQuery(params: {
    connectionId: string;
    collection: string;
    prompt: string;
    model?: string;
    database?: string;
  }): Promise<{
    filter: Record<string, unknown>;
    explanation: string;
    model: string;
    provider: AiProviderId;
  }> {
    const res = await fetch("/api/ai/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });
    return handleJson(res) as Promise<{
      filter: Record<string, unknown>;
      explanation: string;
      model: string;
      provider: AiProviderId;
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

export const extractIdString = (id: unknown): string => {
  if (typeof id === "string") return id;
  if (id && typeof id === "object" && "$oid" in (id as Record<string, unknown>)) {
    return String((id as Record<string, unknown>).$oid);
  }
  const binaryUuid = binaryToCanonicalUuid(id);
  if (binaryUuid) return binaryUuid;
  if (id && typeof id === "object" && "toHexString" in (id as { toHexString?: () => string })) {
    const f = (id as { toHexString?: () => string }).toHexString;
    if (typeof f === "function") return f.call(id);
  }
  return String(id);
};

const binaryToCanonicalUuid = (value: unknown): string | null => {
  if (
    !value ||
    typeof value !== "object" ||
    !("$binary" in (value as Record<string, unknown>))
  ) {
    return null;
  }
  const b = (value as Record<string, unknown>).$binary as
    | { base64?: string; subType?: string }
    | undefined;
  if (!b || b.subType !== "04" || typeof b.base64 !== "string") return null;
  try {
    const bin = atob(b.base64);
    let hex = "";
    for (let i = 0; i < bin.length; i++) {
      hex += bin.charCodeAt(i).toString(16).padStart(2, "0");
    }
    if (hex.length !== 32) return null;
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32),
    ].join("-");
  } catch {
    return null;
  }
};

export const isBsonUuid = (value: unknown): boolean =>
  binaryToCanonicalUuid(value) !== null;

export const formatUuid = (
  value: unknown,
  format: "canonical" | "short" | "compact" | "raw",
): string | null => {
  const canonical = binaryToCanonicalUuid(value);
  if (!canonical) return null;
  if (format === "canonical") return canonical;
  if (format === "short") return canonical.slice(0, 8);
  if (format === "compact") return canonical.replace(/-/g, "");
  if (format === "raw") {
    return String(
      (value as { $binary: { base64: string } }).$binary.base64,
    );
  }
  return canonical;
};
