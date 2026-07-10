import { useQuery } from "@tanstack/react-query";
import { ApiError, api } from "../../api/client";

export type ConnectionHealthStatus = "ok" | "error" | "loading" | "idle";

export interface ConnectionHealth {
  status: ConnectionHealthStatus;
  error: string | null;
  refetch: () => Promise<void>;
  isFetching: boolean;
}

/**
 * Polls `/api/connections/:id/test` (Mongo `ping`) so the UI can show a
 * connected/disconnected indicator without waiting for the next data query
 * to fail. Returns "idle" when no `cid` is selected.
 *
 * Cadence: poll every 60s on success, retry every 15s on failure — long
 * enough that a healthy desktop connection doesn't flood the cluster with
 * pings, short enough that a transient drop is visible quickly.
 */
export const useConnectionHealth = (cid: string | null): ConnectionHealth => {
  const q = useQuery({
    queryKey: ["connection-health", cid],
    queryFn: () => api.testConnection(cid!),
    enabled: !!cid,
    staleTime: 30_000,
    refetchInterval: (query) => (query.state.error ? 15_000 : 60_000),
    retry: 0,
  });
  const refetch = async (): Promise<void> => {
    await q.refetch({ throwOnError: true });
  };

  if (!cid) {
    return { status: "idle", error: null, refetch, isFetching: false };
  }
  if (q.isLoading) {
    return { status: "loading", error: null, refetch, isFetching: q.isFetching };
  }
  if (q.isError) {
    const message =
      q.error instanceof ApiError
        ? q.error.message
        : q.error instanceof Error
          ? q.error.message
          : "Connection failed";
    return { status: "error", error: message, refetch, isFetching: q.isFetching };
  }
  return { status: "ok", error: null, refetch, isFetching: q.isFetching };
};
