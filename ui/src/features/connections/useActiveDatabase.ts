import { useEffect, useState } from "react";
import { useActiveConnection } from "./useActiveConnection";

/**
 * Resolves the active database for the active connection.
 *
 * Whenever the active connection changes, the database resets to that
 * connection's `effectiveDefaultDatabase` (or null). We deliberately don't
 * remember the previously-picked database across connection switches —
 * carrying it over showed stale collection lists when the database didn't
 * exist on the new connection. The sidebar always reflects the current
 * connection's state.
 */
export const useActiveDatabase = () => {
  const { active, activeId } = useActiveConnection();
  const [database, setDatabaseState] = useState<string | null>(
    active?.effectiveDefaultDatabase ?? null,
  );

  useEffect(() => {
    setDatabaseState(active?.effectiveDefaultDatabase ?? null);
  }, [activeId, active?.effectiveDefaultDatabase]);

  return { database, setDatabase: setDatabaseState, activeId, active };
};
