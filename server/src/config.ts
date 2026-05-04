import { execSync } from "child_process";
import crypto from "crypto";
import http from "http";
import { MongoClient } from "mongodb";
import type { OIDCCallbackParams, OIDCResponse } from "mongodb";
import { resolveAspireConnectionUri } from "./aspire.js";
import { sanitizeMongoUri } from "./security.js";
import { getConnection, touchConnection } from "./store/connections.js";
import type { OidcProvider } from "./store/connections.js";

/**
 * Build a PATH string that includes common Homebrew / system binary
 * directories so that `az` is findable even when the server is started from
 * an environment (e.g. VS Code integrated terminal) that strips them.
 */
const buildAugmentedPath = (): string => {
  const extra = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];
  const current = process.env.PATH?.split(":") ?? [];
  const merged = [...current];
  for (const p of extra) {
    if (!merged.includes(p)) merged.push(p);
  }
  return merged.join(":");
};

const AZ_PATH = buildAugmentedPath();

/**
 * The redirect URI port used by Atlas / NoSQLBooster for OIDC callbacks.
 * The Atlas Azure AD app (`d0300797-32ed-46f6-8dfb-580ce3432c31`) is registered
 * as a public client with `http://localhost:27097/redirect`, so we bind our
 * local HTTP server to this exact port to avoid AADSTS50011 redirect-mismatch
 * errors. Override the client ID per-connection via the `azureClientId` field;
 * when unset, the audience (Atlas app ID) is used as the client ID, matching
 * how NoSQLBooster authenticates without a separate app registration.
 */
const OIDC_REDIRECT_PORT = 27097;
const OIDC_REDIRECT_URI = `http://localhost:${OIDC_REDIRECT_PORT}/redirect`;

export const config = {
  port: Number(process.env.PORT ?? 5180),
  host: process.env.HOST ?? process.env.MANGO_HOST ?? "127.0.0.1",
  staticDir: process.env.STATIC_DIR ?? "./public",
  mongoMaxTimeMS: Number(process.env.MANGO_MONGO_MAX_TIME_MS ?? 10_000),
  consoleTimeoutMS: Number(process.env.MANGO_CONSOLE_TIMEOUT_MS ?? 1_000),
  jsConsoleEnabled: process.env.MANGO_DISABLE_JS_CONSOLE !== "true",
};

interface CachedClient {
  client: MongoClient;
  defaultDatabase: string | null;
  uri: string;
  oidcProvider: OidcProvider;
  oidcTokenAudience: string | null;
  azureClientId: string | null;
  azureTenantId: string | null;
}

const clients = new Map<string, CachedClient>();
const ASPIRE_CACHE_MS = 30_000;
const aspireUriCache = new Map<string, { uri: string; ts: number }>();

/**
 * Cached OAuth2 tokens keyed by connection ID.  Stores the access token,
 * its expiry timestamp, and an optional refresh token so the browser is
 * only opened when a new interactive login is actually needed.
 */
interface BrowserTokenEntry {
  accessToken: string;
  expiresAt: number; // epoch ms
  refreshToken?: string;
}
const browserTokenCache = new Map<string, BrowserTokenEntry>();

/**
 * Build the OIDC_HUMAN_CALLBACK for the Azure CLI credential flow.
 *
 * Invokes `az account get-access-token --resource <audience>` directly so we
 * have full control over the PATH (needed when the server runs inside VS Code
 * whose integrated terminal strips /opt/homebrew/bin) and over error reporting.
 * No credentials are stored by Mango — the token lives in `~/.azure/`.
 *
 * Audience priority:
 *   1. Explicitly configured `oidcTokenAudience` on the connection
 *   2. `params.idpInfo.clientId` from the OIDC handshake (Atlas advertises
 *      its Azure AD app ID here — usually no manual config needed)
 */
const makeAzureCliOidcCallback = (configuredAudience: string | null) =>
  async (params: OIDCCallbackParams): Promise<OIDCResponse> => {
    const audience = configuredAudience || params.idpInfo?.clientId;
    if (!audience) {
      throw new Error(
        "Azure CLI OIDC: no audience available. " +
          "The server did not supply an idpInfo.clientId and no Token Audience " +
          "was configured on the connection. Please set the Token Audience field.",
      );
    }

    console.log(`[mango/oidc] requesting token for audience: ${audience}`);

    let stdout: string;
    try {
      // Escape the audience for use in the shell command.  Atlas app IDs are
      // GUIDs / api:// URIs — safe to pass as a single shell word.
      stdout = execSync(
        `az account get-access-token --resource ${audience} --output json`,
        { encoding: "utf8", env: { ...process.env, PATH: AZ_PATH }, timeout: 30_000 },
      );
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Azure CLI OIDC: 'az account get-access-token --resource ${audience}' failed.\n` +
          `Make sure you are logged in ('az login') and the app is consented.\n` +
          `Raw error: ${raw}`,
      );
    }

    interface AzTokenResponse {
      accessToken: string;
      expiresOn: string;
    }
    const data = JSON.parse(stdout) as AzTokenResponse;
    const expiresOnMs = new Date(data.expiresOn).getTime();
    return {
      accessToken: data.accessToken,
      expiresInSeconds: Math.max(0, Math.floor((expiresOnMs - Date.now()) / 1000)),
    };
  };

/**
 * Extract the Azure AD tenant ID from an OIDC issuer URL.
 * Atlas sends something like:
 *   https://login.microsoftonline.com/<tenantId>/v2.0
 */
const extractTenantId = (issuer?: string): string | undefined => {
  if (!issuer) return undefined;
  const m = issuer.match(/login\.microsoftonline\.com\/([^/]+)/);
  return m?.[1];
};

// ---------------------------------------------------------------------------
// Manual OAuth2 PKCE helpers — used by the "azure-browser" OIDC provider.
// We implement the flow ourselves so we can bind the local redirect server
// to a specific port (27097) rather than letting @azure/identity pick a
// random one, which causes AADSTS50011 when only port 27097 is registered.
// ---------------------------------------------------------------------------

const generateCodeVerifier = (): string =>
  crypto.randomBytes(32).toString("base64url");

const generateCodeChallenge = (verifier: string): string =>
  crypto.createHash("sha256").update(verifier).digest("base64url");

/** Start a one-shot HTTP server on OIDC_REDIRECT_PORT and resolve with the
 *  authorization code delivered to OIDC_REDIRECT_PATH. */
const waitForAuthCode = (): Promise<string> =>
  new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(
          req.url ?? "/",
          `http://localhost:${OIDC_REDIRECT_PORT}`,
        );
        if (url.pathname !== "/redirect") {
          res.writeHead(404).end();
          return;
        }
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        const desc = url.searchParams.get("error_description") ?? error;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          code
            ? "<html><body><p>Sign-in successful. You may close this window.</p></body></html>"
            : `<html><body><p>Sign-in failed: ${desc}</p></body></html>`,
        );
        server.close();
        if (code) resolve(code);
        else reject(new Error(`Azure AD auth error: ${desc}`));
      } catch (e) {
        server.close();
        reject(e);
      }
    });
    server.listen(OIDC_REDIRECT_PORT, "127.0.0.1", () => {
      console.log(
        `[mango/oidc] Listening on http://127.0.0.1:${OIDC_REDIRECT_PORT}/redirect`,
      );
    });
    server.on("error", reject);
    // 5-minute hard timeout
    const t = setTimeout(() => {
      server.close();
      reject(new Error("Azure AD interactive login timed out after 5 minutes"));
    }, 5 * 60 * 1000);
    t.unref();
  });

interface TokenEndpointResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

const azureTokenRequest = async (
  tenantId: string,
  body: Record<string, string>,
): Promise<TokenEndpointResponse> => {
  const resp = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    },
  );
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Azure AD token request failed (${resp.status}): ${text}`);
  }
  return resp.json() as Promise<TokenEndpointResponse>;
};

/**
 * Build the OIDC_HUMAN_CALLBACK for the interactive browser credential flow.
 *
 * Uses a manual OAuth2 Authorization Code + PKCE flow so we control the
 * exact redirect URI (http://localhost:27097/redirect).  Tokens are cached
 * per connection; only the first connect (or post-expiry reconnect when no
 * refresh token is available) opens a browser window.
 *
 * The tenant is resolved as:
 *   1. Configured `azureTenantId` on the connection
 *   2. Extracted from `params.idpInfo.issuer` (Atlas provides this)
 *   3. Falls back to `"organizations"` (any work/school account)
 */
const makeAzureBrowserOidcCallback = (
  connectionId: string,
  configuredClientId: string | null,
  configuredTenantId: string | null,
  configuredAudience: string | null,
) =>
  async (params: OIDCCallbackParams): Promise<OIDCResponse> => {
    const audience = configuredAudience || params.idpInfo?.clientId;
    if (!audience) {
      throw new Error(
        "Azure Browser OIDC: no audience available. " +
          "The server did not supply an idpInfo.clientId and no Token Audience " +
          "was configured on the connection. Please set the Token Audience field.",
      );
    }

    const tenantId =
      configuredTenantId ||
      extractTenantId(params.idpInfo?.issuer) ||
      "organizations";

    // When no explicit client ID is configured, use the audience (Atlas app ID)
    // as the client ID. The Atlas Azure AD app is registered as a public client
    // with http://localhost:27097/redirect — no separate app registration needed.
    const clientId = configuredClientId || audience;

    console.log(
      `[mango/oidc] browser flow: clientId=${clientId} audience=${audience} tenant=${tenantId}`,
    );

    // --- Try cached token ---------------------------------------------------
    const cached = browserTokenCache.get(connectionId);
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      // Valid for at least another minute — return as-is.
      return {
        accessToken: cached.accessToken,
        expiresInSeconds: Math.max(
          0,
          Math.floor((cached.expiresAt - Date.now()) / 1000),
        ),
      };
    }

    // --- Try refresh token --------------------------------------------------
    if (cached?.refreshToken) {
      try {
        const data = await azureTokenRequest(tenantId, {
          client_id: clientId,
          grant_type: "refresh_token",
          refresh_token: cached.refreshToken,
          scope: `${audience}/.default offline_access`,
        });
        const entry: BrowserTokenEntry = {
          accessToken: data.access_token,
          expiresAt: Date.now() + data.expires_in * 1000,
          refreshToken: data.refresh_token ?? cached.refreshToken,
        };
        browserTokenCache.set(connectionId, entry);
        return {
          accessToken: entry.accessToken,
          expiresInSeconds: data.expires_in,
        };
      } catch {
        console.log("[mango/oidc] refresh token expired, starting interactive login");
      }
    }

    // --- Full interactive flow (PKCE) ----------------------------------------
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);
    const state = crypto.randomBytes(16).toString("hex");

    const authUrl = new URL(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`,
    );
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("redirect_uri", OIDC_REDIRECT_URI);
    authUrl.searchParams.set("scope", `${audience}/.default offline_access`);
    authUrl.searchParams.set("code_challenge", challenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("state", state);

    console.log(`[mango/oidc] Opening browser for Azure AD login: ${authUrl}`);

    // Start listening before opening the browser so the redirect doesn't miss us.
    const codePromise = waitForAuthCode();

    // Open the browser.  Use platform open command as a simple cross-platform
    // alternative; falls back gracefully if unavailable.
    try {
      const { default: open } = await import("open");
      await open(authUrl.toString(), { newInstance: false });
    } catch {
      console.log(
        `[mango/oidc] Could not open browser automatically. Please visit:\n${authUrl}`,
      );
    }

    const code = await codePromise;

    const data = await azureTokenRequest(tenantId, {
      client_id: clientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: OIDC_REDIRECT_URI,
      code_verifier: verifier,
      scope: `${audience}/.default offline_access`,
    });

    const entry: BrowserTokenEntry = {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      refreshToken: data.refresh_token,
    };
    browserTokenCache.set(connectionId, entry);

    return {
      accessToken: entry.accessToken,
      expiresInSeconds: data.expires_in,
    };
  };

const resolveUriForConnection = async (connectionId: string): Promise<{
  uri: string;
  defaultDatabase: string | null;
} | null> => {
  const conn = getConnection(connectionId);
  if (!conn) return null;
  if (!conn.aspire) {
    return { uri: conn.uri, defaultDatabase: conn.defaultDatabase };
  }
  const cached = aspireUriCache.get(connectionId);
  if (cached && Date.now() - cached.ts < ASPIRE_CACHE_MS) {
    return { uri: cached.uri, defaultDatabase: conn.defaultDatabase };
  }
  const fresh = await resolveAspireConnectionUri(
    conn.aspire.appHostPath,
    conn.aspire.resourceName,
  );
  aspireUriCache.set(connectionId, { uri: fresh, ts: Date.now() });
  return { uri: fresh, defaultDatabase: conn.defaultDatabase };
};

/**
 * Resolve a Mongo client for a connection ID. Connection details are loaded
 * from the JSON store; the MongoClient itself is cached per connection. For
 * aspire-backed connections the URI is re-resolved on a TTL — when it
 * changes (port rotation between `aspire run`s), the cached client is
 * dropped and a fresh one is opened.
 */
export const getMongoClientFor = async (
  connectionId: string,
): Promise<{ client: MongoClient; defaultDatabase: string | null }> => {
  const resolved = await resolveUriForConnection(connectionId);
  if (!resolved) throw new Error(`Connection not found: ${connectionId}`);

  const conn = getConnection(connectionId);
  const oidcProvider = conn?.oidcProvider ?? null;
  const oidcTokenAudience = conn?.oidcTokenAudience ?? null;
  const azureClientId = conn?.azureClientId ?? null;
  const azureTenantId = conn?.azureTenantId ?? null;

  const cached = clients.get(connectionId);
  if (
    cached &&
    cached.uri === resolved.uri &&
    cached.oidcProvider === oidcProvider &&
    cached.oidcTokenAudience === oidcTokenAudience &&
    cached.azureClientId === azureClientId &&
    cached.azureTenantId === azureTenantId
  ) {
    touchConnection(connectionId);
    return cached;
  }
  if (cached) {
    clients.delete(connectionId);
    browserTokenCache.delete(connectionId);
    cached.client.close().catch(() => {});
  }

  let clientOptions: ConstructorParameters<typeof MongoClient>[1] = {
    serverSelectionTimeoutMS: 5_000,
  };

  if (oidcProvider === "azure-cli") {
    const audience = oidcTokenAudience || null;
    clientOptions = {
      ...clientOptions,
      authMechanism: "MONGODB-OIDC",
      authMechanismProperties: {
        OIDC_HUMAN_CALLBACK: makeAzureCliOidcCallback(audience),
      },
    };
  } else if (oidcProvider === "azure-browser") {
    clientOptions = {
      ...clientOptions,
      authMechanism: "MONGODB-OIDC",
      authMechanismProperties: {
        OIDC_HUMAN_CALLBACK: makeAzureBrowserOidcCallback(
          connectionId,
          azureClientId,
          azureTenantId,
          oidcTokenAudience,
        ),
      },
    };
  }

  const client = new MongoClient(sanitizeMongoUri(resolved.uri), clientOptions);
  await client.connect();
  const entry: CachedClient = {
    client,
    defaultDatabase: resolved.defaultDatabase,
    uri: resolved.uri,
    oidcProvider,
    oidcTokenAudience,
    azureClientId,
    azureTenantId,
  };
  clients.set(connectionId, entry);
  touchConnection(connectionId);
  return entry;
};

export const databaseNameFor = (
  connectionId: string,
  override?: string | null,
): string => {
  if (override) return override;
  const cached = clients.get(connectionId);
  if (cached?.defaultDatabase) return cached.defaultDatabase;
  const conn = getConnection(connectionId);
  if (conn?.defaultDatabase) return conn.defaultDatabase;
  if (conn) {
    try {
      const url = new URL(conn.uri.replace(/^mongodb(\+srv)?:\/\//, "http://"));
      const path = url.pathname.replace(/^\//, "").split("?")[0];
      if (path) return path;
    } catch {
      /* fall through */
    }
  }
  return "test";
};

export const closeMongoClient = async (connectionId: string): Promise<void> => {
  aspireUriCache.delete(connectionId);
  browserTokenCache.delete(connectionId);
  const cached = clients.get(connectionId);
  if (!cached) return;
  clients.delete(connectionId);
  await cached.client.close().catch(() => {
    /* ignore */
  });
};

export const closeAllClients = async (): Promise<void> => {
  const all = Array.from(clients.entries());
  clients.clear();
  await Promise.all(all.map(([, c]) => c.client.close().catch(() => {})));
};
