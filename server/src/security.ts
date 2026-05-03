const DEFAULT_DEV_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export const isLocalHost = (hostname: string): boolean =>
  LOCAL_HOSTS.has(hostname.toLowerCase());

export const configuredCorsOrigins = (): Set<string> => {
  const origins = new Set(DEFAULT_DEV_ORIGINS);
  const raw = process.env.MANGO_CORS_ORIGINS;
  if (!raw) return origins;
  for (const item of raw.split(",")) {
    const trimmed = item.trim();
    if (trimmed) origins.add(trimmed.replace(/\/$/, ""));
  }
  return origins;
};

export const isAllowedOrigin = (origin: string, requestUrl: string): boolean => {
  const normalized = origin.replace(/\/$/, "");
  if (configuredCorsOrigins().has(normalized)) return true;

  try {
    const originUrl = new URL(normalized);
    const reqUrl = new URL(requestUrl);
    return originUrl.origin === reqUrl.origin && isLocalHost(originUrl.hostname);
  } catch {
    return false;
  }
};

/**
 * Strip query parameters that the official Node MongoDB driver doesn't
 * accept. Studio 3T's "Copy connection string" pastes its own `3t.*` options
 * (uriversion, connection.name, alwaysshowauthdb, …) that crash MongoClient
 * with "MongoParseError: options ... are not supported".
 */
const UNSUPPORTED_OPTION_PREFIXES = [/^3t\./i];

export const sanitizeMongoUri = (uri: string): string => {
  const m = uri.match(/^(mongodb(?:\+srv)?:\/\/)(.*)$/i);
  if (!m) return uri;
  const scheme = m[1] ?? "";
  const rest = m[2] ?? "";
  const qIdx = rest.indexOf("?");
  if (qIdx === -1) return uri;
  const before = rest.slice(0, qIdx);
  const fragIdx = rest.indexOf("#", qIdx);
  const fragment = fragIdx === -1 ? "" : rest.slice(fragIdx);
  const queryStr = rest.slice(qIdx + 1, fragIdx === -1 ? undefined : fragIdx);
  const kept = queryStr
    .split("&")
    .filter((kv) => {
      if (!kv) return false;
      const key = kv.split("=", 1)[0] ?? "";
      return !UNSUPPORTED_OPTION_PREFIXES.some((re) => re.test(key));
    })
    .join("&");
  return `${scheme}${before}${kept ? `?${kept}` : ""}${fragment}`;
};

export const validateMongoUri = (uri: string): string | null => {
  const scheme = uri.match(/^mongodb(\+srv)?:\/\//i)?.[0];
  if (!scheme) {
    return "MongoDB URI must start with mongodb:// or mongodb+srv://.";
  }
  const rest = uri.slice(scheme.length);
  const authority = rest.split(/[/?#]/, 1)[0] ?? "";
  const hostPart = authority.includes("@")
    ? (authority.split("@").pop() ?? "")
    : authority;
  if (!hostPart.trim()) return "MongoDB URI must include a host.";
  if (/\s/.test(hostPart)) return "MongoDB URI host is malformed.";
  return null;
};

export const validateAiBaseUrl = (baseUrl: string | null | undefined): string | null => {
  if (!baseUrl) return null;
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return "AI base URL is malformed.";
  }
  if (url.protocol === "https:") return null;
  if (url.protocol === "http:" && isLocalHost(url.hostname)) return null;
  return "AI base URL must use https:// unless it points to localhost.";
};

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/mongodb(\+srv)?:\/\/([^:@/\s]+):([^@/\s]+)@/gi, "mongodb$1://$2:***@"],
  [/([?&](?:password|passwd|pwd|token|api[_-]?key|key|secret)=)[^&\s]+/gi, "$1***"],
  [/\b(?:sk|ghp|github_pat|xox[baprs])-[-_a-zA-Z0-9]{12,}\b/g, "***"],
  [/\b[A-Za-z0-9._%+-]+:[A-Za-z0-9._%+-]+@/g, "***:***@"],
];

export const redactErrorMessage = (value: unknown): string => {
  let text = value instanceof Error ? value.message : String(value);
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    text = text.replace(pattern, replacement);
  }
  return text;
};
