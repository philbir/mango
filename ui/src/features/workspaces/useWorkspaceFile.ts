import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "../../api/client";

const fileKey = (workspaceId: string, path: string) =>
  ["ws-file", workspaceId, path] as const;

export const useWorkspaceFile = (workspaceId: string, path: string) => {
  return useQuery({
    queryKey: fileKey(workspaceId, path),
    queryFn: () => api.readWorkspaceFile(workspaceId, path),
    enabled: !!workspaceId && !!path,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
};

export const useSaveWorkspaceFile = (workspaceId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      path: string;
      raw: string;
      expectedMtime?: number | null;
    }) =>
      api.writeWorkspaceFile(
        workspaceId,
        input.path,
        input.raw,
        input.expectedMtime,
      ),
    onSuccess: (data, input) => {
      // Write the just-saved raw + new mtime into the cache atomically.
      // We MUST NOT just `invalidateQueries` here: the refetch races with
      // the binding's mtime update — seeders observing `mtime` advance
      // before the new `raw` arrives can overwrite the user's edit with
      // the previously-cached body.
      qc.setQueryData(fileKey(workspaceId, input.path), {
        path: data.path,
        raw: input.raw,
        mtime: data.mtime,
        size: data.size,
      });
      // Tree of the parent dir may show a new file or a new mtime.
      const parent = input.path.includes("/")
        ? input.path.slice(0, input.path.lastIndexOf("/"))
        : "";
      qc.invalidateQueries({ queryKey: ["ws-tree", workspaceId, parent] });
    },
  });
};

export const useDeleteWorkspacePath = (workspaceId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) =>
      api.deleteWorkspacePath(workspaceId, path).then(() => path),
    onSuccess: (path) => {
      qc.invalidateQueries({ queryKey: fileKey(workspaceId, path) });
      const parent = path.includes("/")
        ? path.slice(0, path.lastIndexOf("/"))
        : "";
      qc.invalidateQueries({ queryKey: ["ws-tree", workspaceId, parent] });
    },
  });
};

/**
 * Polls the file's mtime on disk every `intervalMs` and reports whether the
 * disk version is newer than `lastReadMtime`. The hook silently treats 404 as
 * "file deleted" and stops polling.
 */
export const useExternalChangeWatch = (
  workspaceId: string,
  path: string,
  lastReadMtime: number | null,
  enabled: boolean,
  intervalMs = 4000,
): { externallyChangedAt: number | null; deleted: boolean } => {
  const [externallyChangedAt, setExternally] = useState<number | null>(null);
  const [deleted, setDeleted] = useState(false);
  const lastReadRef = useRef(lastReadMtime);
  lastReadRef.current = lastReadMtime;

  useEffect(() => {
    setExternally(null);
    setDeleted(false);
  }, [workspaceId, path]);

  useEffect(() => {
    if (!enabled || !lastReadMtime) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const f = await api.readWorkspaceFile(workspaceId, path);
        if (cancelled) return;
        const baseline = lastReadRef.current ?? 0;
        if (f.mtime > baseline + 1) setExternally(f.mtime);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          setDeleted(true);
          cancelled = true;
        }
      }
    };
    const id = window.setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [workspaceId, path, enabled, lastReadMtime, intervalMs]);

  return { externallyChangedAt, deleted };
};
