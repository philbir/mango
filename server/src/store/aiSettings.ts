import { decryptString, encryptString } from "./crypto.js";
import { getDb } from "./db.js";

export type AiProviderName = "openai" | "copilot" | "claude-code";

export interface AiSettings {
  provider: AiProviderName;
  apiKey: string | null;
  baseUrl: string | null;
  model: string | null;
  allowDataSampling: boolean;
}

const SETTINGS_KEY = "ai";

interface SettingsRow {
  key: string;
  value: string;
  updated_at: number;
}

/**
 * Read AI settings from SQLite. The full settings blob is encrypted with the
 * master key (so the API key never sits as plaintext).
 */
export const readAiSettings = (): AiSettings | null => {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM settings WHERE key = ?")
    .get(SETTINGS_KEY) as SettingsRow | undefined;
  if (!row) return null;
  try {
    const json = decryptString(row.value);
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
  const db = getDb();
  const encrypted = encryptString(JSON.stringify(settings));
  const now = Date.now();
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(SETTINGS_KEY, encrypted, now);
};

export const clearAiSettings = (): void => {
  const db = getDb();
  db.prepare("DELETE FROM settings WHERE key = ?").run(SETTINGS_KEY);
};
