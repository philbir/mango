import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Workspace } from "../../api/client";

const KEY = ["workspaces"] as const;

export const useWorkspaces = () => {
  const q = useQuery({
    queryKey: KEY,
    queryFn: () => api.listWorkspaces(),
    staleTime: 30_000,
  });
  return {
    workspaces: q.data?.workspaces ?? [],
    enabled: q.data?.enabled ?? false,
    isLoading: q.isLoading,
    error: q.error as Error | null,
    refetch: q.refetch,
  };
};

export const useCreateWorkspace = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name: string;
      folderPath: string;
      color?: string | null;
      createIfMissing?: boolean;
    }) => api.createWorkspace(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
};

export const useUpdateWorkspace = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      name?: string;
      color?: string | null;
      folderPath?: string;
    }) =>
      api.updateWorkspace(input.id, {
        name: input.name,
        color: input.color,
        folderPath: input.folderPath,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      // folderPath change re-roots every tree query and invalidates open file
      // contents; safest to nuke the whole workspace-scoped cache so views
      // refetch against the new root.
      qc.invalidateQueries({ queryKey: ["ws-tree"] });
      qc.invalidateQueries({ queryKey: ["ws-file"] });
    },
  });
};

export const useDeleteWorkspace = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteWorkspace(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
};

export type { Workspace };
