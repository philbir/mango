import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type Theme = "dark" | "light";
export type UuidFormat = "canonical" | "short" | "compact" | "raw";
export type PageSize = 50 | 100 | 200 | 500;

export interface Settings {
  theme: Theme;
  uuidFormat: UuidFormat;
  pageSize: PageSize;
}

const DEFAULT: Settings = {
  theme: "dark",
  uuidFormat: "canonical",
  pageSize: 50,
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
  setUuidFormat: (f: UuidFormat) => void;
  setPageSize: (n: PageSize) => void;
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
  const setUuidFormat = useCallback(
    (uuidFormat: UuidFormat) => setSettings((s) => ({ ...s, uuidFormat })),
    [],
  );
  const setPageSize = useCallback(
    (pageSize: PageSize) => setSettings((s) => ({ ...s, pageSize })),
    [],
  );

  const value = useMemo(
    () => ({ ...settings, setTheme, setUuidFormat, setPageSize }),
    [settings, setTheme, setUuidFormat, setPageSize],
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
