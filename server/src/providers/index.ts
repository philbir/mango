import { readAiSettings } from "../store/aiSettings.js";
import { buildClaudeCodeProvider } from "./claudeCode.js";
import { buildCopilotProvider } from "./copilot.js";
import { buildOpenAiProvider } from "./openai.js";
import type { AiProvider, AiProviderName } from "./types.js";

let cachedProvider: AiProvider | null = null;
let cachedSignature: string | null = null;

const resolveProviderName = (): AiProviderName => {
  const stored = readAiSettings();
  if (stored?.provider) return stored.provider;
  const env = (process.env.AI_PROVIDER ?? "openai").toLowerCase();
  if (env === "copilot") return "copilot";
  if (env === "claude-code" || env === "claude") return "claude-code";
  return "openai";
};

export interface ProviderOverrides {
  provider: AiProviderName;
  apiKey?: string | null;
  baseUrl?: string | null;
  model?: string | null;
}

/**
 * Build a one-off provider from explicit overrides — used by /api/ai/test so
 * the user can validate draft settings before persisting them.
 */
export const buildProviderFromConfig = (
  overrides: ProviderOverrides,
): AiProvider => {
  if (overrides.provider === "copilot") {
    return buildCopilotProvider({ model: overrides.model ?? undefined });
  }
  if (overrides.provider === "claude-code") {
    return buildClaudeCodeProvider({ model: overrides.model ?? undefined });
  }
  return buildOpenAiProvider({
    apiKey: overrides.apiKey ?? undefined,
    baseUrl: overrides.baseUrl ?? undefined,
    model: overrides.model ?? undefined,
  });
};

export const getProvider = (): AiProvider => {
  const stored = readAiSettings();
  const name = resolveProviderName();
  const signature = JSON.stringify({ name, stored });
  if (cachedProvider && cachedSignature === signature) return cachedProvider;
  cachedSignature = signature;
  cachedProvider = buildProviderFromConfig({
    provider: name,
    apiKey: stored?.apiKey ?? null,
    baseUrl: stored?.baseUrl ?? null,
    model: stored?.model ?? null,
  });
  return cachedProvider;
};

export const invalidateProvider = (): void => {
  cachedProvider = null;
  cachedSignature = null;
};

export type { AiProvider } from "./types.js";
