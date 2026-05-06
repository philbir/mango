import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";

const treeKey = (workspaceId: string, dirPath: string) =>
  ["ws-tree", workspaceId, dirPath] as const;

export const useWorkspaceTree = (
  workspaceId: string,
  dirPath: string,
  enabled: boolean,
) => {
  return useQuery({
    queryKey: treeKey(workspaceId, dirPath),
    queryFn: () => api.listWorkspaceTree(workspaceId, dirPath),
    enabled,
    staleTime: 5_000,
  });
};

const collectAffectedDirs = (paths: string[]) => {
  const dirs = new Set<string>();
  for (const p of paths) {
    const parent = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    dirs.add(parent);
  }
  return Array.from(dirs);
};

export const useWorkspaceMutations = (workspaceId: string) => {
  const qc = useQueryClient();
  const invalidate = (paths: string[]) => {
    for (const dir of collectAffectedDirs(paths)) {
      qc.invalidateQueries({ queryKey: treeKey(workspaceId, dir) });
    }
  };
  return {
    createFolder: useMutation({
      mutationFn: (relPath: string) =>
        api.createWorkspaceFolder(workspaceId, relPath),
      onSuccess: (_data, relPath) => invalidate([relPath]),
    }),
    deletePath: useMutation({
      mutationFn: (relPath: string) =>
        api.deleteWorkspacePath(workspaceId, relPath),
      onSuccess: (_data, relPath) => invalidate([relPath]),
    }),
    move: useMutation({
      mutationFn: (input: { from: string; to: string }) =>
        api.moveWorkspacePath(workspaceId, input.from, input.to),
      onSuccess: (_data, input) => invalidate([input.from, input.to]),
    }),
  };
};
