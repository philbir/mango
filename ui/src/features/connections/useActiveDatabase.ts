import { useEffect, useState } from "react";
import { useActiveConnection } from "./useActiveConnection";

const storageKey = (cid: string) => `mango:active-database:${cid}`;

const readStored = (cid: string): string | null => {
  try {
    return window.localStorage.getItem(storageKey(cid));
  } catch {
    return null;
  }
};

const writeStored = (cid: string, db: string | null) => {
  try {
    if (db) window.localStorage.setItem(storageKey(cid), db);
    else window.localStorage.removeItem(storageKey(cid));
  } catch {
    /* ignore */
  }
};

/**
 * Resolves the active database for the active connection.
 *
 *   1. localStorage (last picked by the user, per cid)
 *   2. connection.effectiveDefaultDatabase (explicit default, or URI-embedded)
 *   3. null — sidebar should prompt the user to pick one
 */
export const useActiveDatabase = () => {
  const { active, activeId } = useActiveConnection();
  const [database, setDatabaseState] = useState<string | null>(null);

  useEffect(() => {
    if (!activeId) {
      setDatabaseState(null);
      return;
    }
    const stored = readStored(activeId);
    if (stored) {
      setDatabaseState(stored);
      return;
    }
    setDatabaseState(active?.effectiveDefaultDatabase ?? null);
  }, [activeId, active?.effectiveDefaultDatabase]);

  const setDatabase = (db: string | null) => {
    if (activeId) writeStored(activeId, db);
    setDatabaseState(db);
  };

  return { database, setDatabase, activeId, active };
};
