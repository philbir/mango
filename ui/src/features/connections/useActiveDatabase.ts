import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { type ConnectionPublic } from "../../api/client";
import { useActiveConnection } from "./useActiveConnection";

interface ActiveDatabaseValue {
  database: string | null;
  setDatabase: (db: string | null) => void;
  activeId: string | null;
  active: ConnectionPublic | null;
}

const ActiveDatabaseContext = createContext<ActiveDatabaseValue | null>(null);

/**
 * Provides the active database for the active connection. Backed by a single
 * piece of state so every consumer (sidebar, collection view, console, etc.)
 * sees the same value — without this, each call site held its own useState
 * copy and selecting a database in the sidebar didn't propagate to query
 * components, which then silently fell through to the server's default ("test").
 *
 * Whenever the active connection changes, the database resets to that
 * connection's `effectiveDefaultDatabase` (or null). We deliberately don't
 * remember the previously-picked database across connection switches —
 * carrying it over showed stale collection lists when the database didn't
 * exist on the new connection.
 */
export const ActiveDatabaseProvider = ({ children }: { children: ReactNode }) => {
  const { active, activeId } = useActiveConnection();
  const [database, setDatabase] = useState<string | null>(
    active?.effectiveDefaultDatabase ?? null,
  );

  useEffect(() => {
    setDatabase(active?.effectiveDefaultDatabase ?? null);
  }, [activeId, active?.effectiveDefaultDatabase]);

  const value = useMemo<ActiveDatabaseValue>(
    () => ({ database, setDatabase, activeId, active }),
    [database, activeId, active],
  );

  return createElement(ActiveDatabaseContext.Provider, { value }, children);
};

export const useActiveDatabase = (): ActiveDatabaseValue => {
  const ctx = useContext(ActiveDatabaseContext);
  if (!ctx) {
    throw new Error(
      "useActiveDatabase must be used within ActiveDatabaseProvider",
    );
  }
  return ctx;
};
