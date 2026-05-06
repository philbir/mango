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
    mutationFn: (input: { id: string; name?: string; color?: string | null }) =>
      api.updateWorkspace(input.id, { name: input.name, color: input.color }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
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
