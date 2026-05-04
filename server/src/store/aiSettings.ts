import { decryptString, encryptString } from "./crypto.js";
import { JsonFileStore } from "./jsonFile.js";

export type AiProviderName = "openai" | "copilot" | "claude-code";

export interface AiSettings {
  provider: AiProviderName;
  apiKey: string | null;
  baseUrl: string | null;
  model: string | null;
  copilotCliPath: string | null;
  claudeCliPath: string | null;
  allowDataSampling: boolean;
}

interface AiSettingsFile {
  version: number;
  encrypted: string | null;
}

const store = new JsonFileStore<AiSettingsFile>("ai-settings.json", () => ({
  version: 1,
  encrypted: null,
}));

/**
 * Read AI settings. The full settings blob is encrypted with the master key
 * (so the API key never sits as plaintext on disk).
 */
export const readAiSettings = (): AiSettings | null => {
  const { encrypted } = store.read();
  if (!encrypted) return null;
  try {
    const json = decryptString(encrypted);
    const parsed = JSON.parse(json) as Partial<AiSettings>;
    const provider: AiProviderName =
      parsed.provider === "copilot"
        ? "copilot"
        : parsed.provider === "claude-code"
          ? "claude-code"
          : "openai";
    return {
      provider,
      apiKey: parsed.apiKey ?? null,
      baseUrl: parsed.baseUrl ?? null,
      model: parsed.model ?? null,
      copilotCliPath: parsed.copilotCliPath ?? null,
      claudeCliPath: parsed.claudeCliPath ?? null,
      allowDataSampling: parsed.allowDataSampling === true,
    };
  } catch (e) {
    console.warn(
      `[mango] failed to decrypt AI settings: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
};

export const writeAiSettings = (settings: AiSettings): void => {
  const encrypted = encryptString(JSON.stringify(settings));
  store.write({ version: 1, encrypted });
};

export const clearAiSettings = (): void => {
  store.write({ version: 1, encrypted: null });
};
