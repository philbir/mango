import { JsonFileStore } from "./jsonFile.js";

/**
 * UI preferences (theme, tab mode, page size, formats…) persisted next to the
 * other JSON files in the data dir. The desktop shell uses this so settings
 * survive WebView cache clears and app updates; the web build keeps its
 * preferences in sessionStorage instead and never calls these.
 *
 * The blob is opaque to the server — the UI owns the schema and does its own
 * validation/migration on read.
 */
export type UiSettings = Record<string, unknown>;

interface UiSettingsFile {
  version: number;
  settings: UiSettings;
}

const store = new JsonFileStore<UiSettingsFile>("ui-settings.json", () => ({
  version: 1,
  settings: {},
}));

export const readUiSettings = (): UiSettings => store.read().settings ?? {};

export const writeUiSettings = (settings: UiSettings): void => {
  store.write({ version: 1, settings });
};
