import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api, type UuidRepresentation } from "./api/client";
import type {
  DateDisplay,
  FormatOptions,
  JsonViewFormat,
} from "./features/documents/docFormats";
import { isTauri } from "./features/updater/useUpdater";

export type { DateDisplay, JsonViewFormat, UuidRepresentation };
export type Theme = "system" | "dark" | "light";
export type PageSize = 50 | 100 | 200 | 500;
export type CollectionMode = "query" | "console";

export interface Settings {
  theme: Theme;
  uuidRepresentation: UuidRepresentation;
  pageSize: PageSize;
  tabMode: boolean;
  defaultCollectionMode: CollectionMode;
  /** Global document text format — result list, viewer and update editor. */
  jsonFormat: JsonViewFormat;
  dateDisplay: DateDisplay;
}

const DEFAULT: Settings = {
  theme: "system",
  uuidRepresentation: "standard",
  pageSize: 50,
  tabMode: true,
  defaultCollectionMode: "query",
  jsonFormat: "shell",
  dateDisplay: "local",
};

/*
 * Persistence:
 *  - Web (Docker / Aspire): sessionStorage — preferences live for the browser
 *    tab only, so a shared deployment doesn't accumulate per-machine state.
 *  - Desktop (Tauri): the server writes them to `ui-settings.json` in the app
 *    data dir, so they survive WebView cache clears and updates. sessionStorage
 *    is still used as a warm cache so the first paint doesn't flash defaults.
 *  - `localStorage` under the legacy key is read once as a migration seed for
 *    installs that predate this scheme, then left alone.
 */
const STORAGE_KEY = "mongo-manager:settings:v1";

const sanitize = (raw: unknown): Partial<Settings> => {
  if (!raw || typeof raw !== "object") return {};
  // `documentFormat` was the old per-viewer dropdown, superseded by the global
  // `jsonFormat` — dropped rather than migrated since every install persisted
  // its default, so it doesn't reflect a real choice.
  const { documentFormat: _legacy, ...parsed } = raw as Partial<Settings> & {
    documentFormat?: unknown;
  };
  const out: Partial<Settings> = { ...parsed };
  if (out.theme !== "dark" && out.theme !== "light" && out.theme !== "system") {
    delete out.theme;
  }
  return out;
};

const readStorage = (storage: Storage | undefined): Partial<Settings> => {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    return raw ? sanitize(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
};

const loadSettings = (): Settings => {
  if (typeof window === "undefined") return DEFAULT;
  const session = readStorage(window.sessionStorage);
  if (Object.keys(session).length > 0) return { ...DEFAULT, ...session };
  // First load in this tab: seed from the pre-migration localStorage copy.
  return { ...DEFAULT, ...readStorage(window.localStorage) };
};

const systemPrefersDark = (): boolean =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;

const applyTheme = (theme: Theme) => {
  if (typeof document === "undefined") return;
  const dark = theme === "system" ? systemPrefersDark() : theme === "dark";
  document.documentElement.classList.toggle("dark", dark);
};

interface SettingsContextValue extends Settings {
  /** The theme actually in effect once "system" is resolved. */
  resolvedTheme: "dark" | "light";
  setTheme: (t: Theme) => void;
  setUuidRepresentation: (r: UuidRepresentation) => void;
  setPageSize: (n: PageSize) => void;
  setTabMode: (v: boolean) => void;
  setDefaultCollectionMode: (m: CollectionMode) => void;
  setJsonFormat: (f: JsonViewFormat) => void;
  setDateDisplay: (d: DateDisplay) => void;
  /** Uuid + date options, memoized — pass straight to the doc formatters. */
  formatOptions: FormatOptions;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export const SettingsProvider = ({ children }: { children: React.ReactNode }) => {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [systemDark, setSystemDark] = useState(() => systemPrefersDark());
  // Desktop: don't write back to the server until we've read from it, or a
  // fast first render would clobber the persisted file with defaults.
  const hydratedRef = useRef(!isTauri());

  // Desktop: hydrate from the server-side file.
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    api
      .getUiSettings()
      .then(({ settings: remote }) => {
        if (cancelled) return;
        const parsed = sanitize(remote);
        if (Object.keys(parsed).length > 0) {
          setSettings((s) => ({ ...s, ...parsed }));
        }
      })
      .catch(() => {
        /* keep the local copy */
      })
      .finally(() => {
        if (!cancelled) hydratedRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    applyTheme(settings.theme);
  }, [settings.theme, systemDark]);

  // Follow OS theme changes live while on "system".
  useEffect(() => {
    if (settings.theme !== "system" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [settings.theme]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* ignore */
    }
    if (!isTauri() || !hydratedRef.current) return;
    const handle = window.setTimeout(() => {
      api.putUiSettings(settings as unknown as Record<string, unknown>).catch(() => {
        /* best effort — sessionStorage still has it */
      });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [settings]);

  const setTheme = useCallback(
    (theme: Theme) => setSettings((s) => ({ ...s, theme })),
    [],
  );
  const setUuidRepresentation = useCallback(
    (uuidRepresentation: UuidRepresentation) =>
      setSettings((s) => ({ ...s, uuidRepresentation })),
    [],
  );
  const setPageSize = useCallback(
    (pageSize: PageSize) => setSettings((s) => ({ ...s, pageSize })),
    [],
  );
  const setTabMode = useCallback(
    (tabMode: boolean) => setSettings((s) => ({ ...s, tabMode })),
    [],
  );
  const setDefaultCollectionMode = useCallback(
    (defaultCollectionMode: CollectionMode) =>
      setSettings((s) => ({ ...s, defaultCollectionMode })),
    [],
  );
  const setJsonFormat = useCallback(
    (jsonFormat: JsonViewFormat) => setSettings((s) => ({ ...s, jsonFormat })),
    [],
  );
  const setDateDisplay = useCallback(
    (dateDisplay: DateDisplay) => setSettings((s) => ({ ...s, dateDisplay })),
    [],
  );
  const formatOptions = useMemo<FormatOptions>(
    () => ({
      uuidRepresentation: settings.uuidRepresentation,
      dateDisplay: settings.dateDisplay,
    }),
    [settings.uuidRepresentation, settings.dateDisplay],
  );

  const resolvedTheme: "dark" | "light" =
    settings.theme === "system"
      ? systemDark
        ? "dark"
        : "light"
      : settings.theme;

  const value = useMemo(
    () => ({
      ...settings,
      resolvedTheme,
      setTheme,
      setUuidRepresentation,
      setPageSize,
      setTabMode,
      setDefaultCollectionMode,
      setJsonFormat,
      setDateDisplay,
      formatOptions,
    }),
    [
      settings,
      resolvedTheme,
      setTheme,
      setUuidRepresentation,
      setPageSize,
      setTabMode,
      setDefaultCollectionMode,
      setJsonFormat,
      setDateDisplay,
      formatOptions,
    ],
  );

  return (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
};

export const useSettings = (): SettingsContextValue => {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
};
