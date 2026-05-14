import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import {
  type MangoFrontmatter,
  parseMd,
  serializeMd,
} from "./markdownDoc";
import {
  useExternalChangeWatch,
  useSaveWorkspaceFile,
  useWorkspaceFile,
} from "./useWorkspaceFile";

export interface WorkspaceFileBindingArgs {
  /**
   * Tuple of `(workspaceId, filePath)`. When either is missing, the hook
   * returns a no-op binding so callers don't have to branch.
   */
  workspaceId: string | null | undefined;
  filePath: string | null | undefined;
}

export interface WorkspaceFileBinding {
  bound: boolean;
  loading: boolean;
  loadError: string | null;
  /** Latest parsed frontmatter from disk. */
  frontmatter: MangoFrontmatter;
  /** Latest description (Markdown above the script sentinel) from disk. */
  description: string;
  /** Latest script body from disk — the seed value for the editor. */
  script: string;
  /** Last known mtime for optimistic-concurrency saves. */
  mtime: number | null;
  /** External change indicator; banner-worthy if non-null. */
  externallyChangedAt: number | null;
  /** True when the file was deleted on disk. */
  deleted: boolean;
  /**
   * Save the current document back to the bound file. Returns the new mtime
   * on success; throws on failure (e.g. 409 conflict).
   */
  save: (input: {
    frontmatter: MangoFrontmatter;
    description: string;
    script: string;
  }) => Promise<number>;
  /** Whether a save is in flight. */
  saving: boolean;
  /** Force a re-read from disk, e.g. after the user clicks "Reload". */
  reload: () => Promise<void>;
}

const EMPTY_FM: MangoFrontmatter = {
  collection: null,
  connection: null,
  connectionId: null,
  database: null,
  fields: null,
};

/**
 * Connects an editor view to a workspace file: loads the file, exposes
 * parsed parts as seed values, and offers a `save()` that round-trips
 * through `serializeMd` so frontmatter / description / script land in their
 * canonical positions on disk.
 *
 * The hook deliberately doesn't own the editor's state — views keep their
 * existing local state and pass current values into `save()`. That keeps
 * the integration surface small (one effect to seed initial values, one
 * call on save) and avoids forcing every view to re-architect its state.
 */
export const useWorkspaceFileBinding = ({
  workspaceId,
  filePath,
}: WorkspaceFileBindingArgs): WorkspaceFileBinding => {
  const bound = !!workspaceId && !!filePath;
  const fileQuery = useWorkspaceFile(workspaceId ?? "", filePath ?? "");
  const saveMut = useSaveWorkspaceFile(workspaceId ?? "");

  const [mtime, setMtime] = useState<number | null>(null);

  const parsed =
    bound && fileQuery.data?.raw
      ? parseMd(fileQuery.data.raw)
      : null;

  // Track mtime of the last successfully-loaded read. Saves bump this so the
  // external-change watcher doesn't false-alarm on our own writes.
  useEffect(() => {
    if (fileQuery.data) setMtime(fileQuery.data.mtime);
  }, [fileQuery.data?.mtime]);

  const watch = useExternalChangeWatch(
    workspaceId ?? "",
    filePath ?? "",
    mtime,
    bound,
  );

  const save = useCallback(
    async (input: {
      frontmatter: MangoFrontmatter;
      description: string;
      script: string;
    }): Promise<number> => {
      if (!bound) throw new Error("Not bound to a file.");
      const raw = serializeMd({
        frontmatter: input.frontmatter,
        description: input.description,
        script: input.script,
      });
      const res = await saveMut.mutateAsync({
        path: filePath!,
        raw,
        expectedMtime: mtime,
      });
      setMtime(res.mtime);
      return res.mtime;
    },
    [bound, filePath, mtime, saveMut],
  );

  const reload = useCallback(async () => {
    if (!bound) return;
    await fileQuery.refetch();
  }, [bound, fileQuery]);

  return {
    bound,
    loading: bound ? fileQuery.isLoading : false,
    loadError:
      bound && fileQuery.isError
        ? fileQuery.error instanceof ApiError
          ? fileQuery.error.message
          : (fileQuery.error as Error)?.message ?? "Failed to load file."
        : null,
    frontmatter: parsed?.frontmatter ?? EMPTY_FM,
    description: parsed?.description ?? "",
    script: parsed?.script ?? "",
    mtime,
    externallyChangedAt: watch.externallyChangedAt,
    deleted: watch.deleted,
    save,
    saving: saveMut.isPending,
    reload,
  };
};
