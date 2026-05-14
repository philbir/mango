import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { UuidRepresentation } from "./api/client";

export type { UuidRepresentation };
export type Theme = "dark" | "light";
export type PageSize = 50 | 100 | 200 | 500;
export type CollectionMode = "query" | "console";

export interface Settings {
  theme: Theme;
  uuidRepresentation: UuidRepresentation;
  pageSize: PageSize;
  tabMode: boolean;
  defaultCollectionMode: CollectionMode;
}

const DEFAULT: Settings = {
  theme: "dark",
  uuidRepresentation: "standard",
  pageSize: 50,
  tabMode: false,
  defaultCollectionMode: "query",
};

const STORAGE_KEY = "mongo-manager:settings:v1";

const loadSettings = (): Settings => {
  if (typeof window === "undefined") return DEFAULT;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT, ...parsed };
  } catch {
    return DEFAULT;
  }
};

const applyTheme = (theme: Theme) => {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
};

interface SettingsContextValue extends Settings {
  setTheme: (t: Theme) => void;
  setUuidRepresentation: (r: UuidRepresentation) => void;
  setPageSize: (n: PageSize) => void;
  setTabMode: (v: boolean) => void;
  setDefaultCollectionMode: (m: CollectionMode) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export const SettingsProvider = ({ children }: { children: React.ReactNode }) => {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());

  useEffect(() => {
    applyTheme(settings.theme);
  }, [settings.theme]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* ignore */
    }
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

  const value = useMemo(
    () => ({
      ...settings,
      setTheme,
      setUuidRepresentation,
      setPageSize,
      setTabMode,
      setDefaultCollectionMode,
    }),
    [
      settings,
      setTheme,
      setUuidRepresentation,
      setPageSize,
      setTabMode,
      setDefaultCollectionMode,
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
