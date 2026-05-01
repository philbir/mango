import { buildCopilotProvider } from "./copilot.js";
import { buildOpenAiProvider } from "./openai.js";
import type { AiProvider } from "./types.js";

let cachedProvider: AiProvider | null = null;
let cachedProviderName: string | null = null;

export const getProvider = (): AiProvider => {
  const name = (process.env.AI_PROVIDER ?? "openai").toLowerCase();
  if (cachedProvider && cachedProviderName === name) return cachedProvider;
  cachedProviderName = name;
  cachedProvider = name === "copilot" ? buildCopilotProvider() : buildOpenAiProvider();
  return cachedProvider;
};

export type { AiProvider } from "./types.js";
