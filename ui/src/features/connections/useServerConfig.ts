import { useQuery } from "@tanstack/react-query";
import { api, type ServerConfig } from "../../api/client";

const FALLBACK: ServerConfig = { mode: "multi", standaloneConnectionId: null };

/**
 * Fetched once on boot — drives whether the connection manager is shown.
 */
export const useServerConfig = (): ServerConfig => {
  const q = useQuery({
    queryKey: ["server-config"],
    queryFn: () => api.getConfig(),
    staleTime: Infinity,
  });
  return q.data ?? FALLBACK;
};
