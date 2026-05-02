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

export const getProvider = (): AiProvider => {
  const stored = readAiSettings();
  const name = resolveProviderName();
  const signature = JSON.stringify({ name, stored });
  if (cachedProvider && cachedSignature === signature) return cachedProvider;
  cachedSignature = signature;
  if (name === "copilot") {
    cachedProvider = buildCopilotProvider({
      model: stored?.model ?? undefined,
    });
  } else if (name === "claude-code") {
    cachedProvider = buildClaudeCodeProvider({
      model: stored?.model ?? undefined,
    });
  } else {
    cachedProvider = buildOpenAiProvider({
      apiKey: stored?.apiKey ?? undefined,
      baseUrl: stored?.baseUrl ?? undefined,
      model: stored?.model ?? undefined,
    });
  }
  return cachedProvider;
};

export const invalidateProvider = (): void => {
  cachedProvider = null;
  cachedSignature = null;
};

export type { AiProvider } from "./types.js";
