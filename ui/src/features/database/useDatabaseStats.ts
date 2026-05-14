import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

export const useDatabaseStats = (cid: string, database: string) =>
  useQuery({
    queryKey: ["database-stats", cid, database],
    queryFn: () => api.getDatabaseStats(cid, database),
    enabled: !!cid && !!database,
  });
