import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

export const useWorkspaceGit = (workspaceId: string, enabled: boolean) =>
  useQuery({
    queryKey: ["ws-git", workspaceId],
    queryFn: () => api.getWorkspaceGit(workspaceId),
    enabled,
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
