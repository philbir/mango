import {
  IconChevronDown,
  IconChevronRight,
  IconFilePlus,
  IconFolderPlus,
  IconRefresh,
  IconTrash,
} from "@tabler/icons-react";
import { useState } from "react";
import { useTabs } from "../tabs/TabsContext";
import { TreeNode } from "./TreeNode";
import { useDeleteWorkspace } from "./useWorkspaces";
import { useWorkspaceGit } from "./useWorkspaceGit";
import { useWorkspaceMutations, useWorkspaceTree } from "./useWorkspaceTree";
import { api, type Workspace } from "../../api/client";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { useActiveConnection } from "../connections/useActiveConnection";
import { useActiveDatabase } from "../connections/useActiveDatabase";
import { OpenFileConnectionDialog } from "./OpenFileConnectionDialog";
import { type MangoFrontmatter, parseMd } from "./markdownDoc";

interface Props {
  workspace: Workspace;
}

export const WorkspaceRoot = ({ workspace }: Props) => {
  const [open, setOpen] = useState(true);
  const tree = useWorkspaceTree(workspace.id, "", open);
  const git = useWorkspaceGit(workspace.id, open);
  const muts = useWorkspaceMutations(workspace.id);
  const del = useDeleteWorkspace();
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [pendingChildOf, setPendingChildOf] = useState<string | null>(null);
  const [pendingKind, setPendingKind] = useState<"file" | "dir">("file");
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);

  const { activeId, connections, setActiveId } = useActiveConnection();
  const { setDatabase } = useActiveDatabase();
  const {
    activeTab,
    openCollection,
    openConsole,
    openShell,
    openWorkspaceFile,
  } = useTabs();
  const [pendingOpen, setPendingOpen] = useState<{
    relPath: string;
    frontmatter: MangoFrontmatter;
    staleConnectionId: boolean;
  } | null>(null);
  const [resolvingPath, setResolvingPath] = useState<string | null>(null);
  const [confirmingUnregister, setConfirmingUnregister] = useState(false);

  /**
   * Open a workspace file in the matching runnable view rather than a
   * separate "workspace-file" tab kind. The view (CollectionView,
   * ConsoleView, or ShellView) detects the workspace binding via the tab
   * and seeds itself from the file via `useWorkspaceFileBinding`. This is
   * what makes a `kind: console` + `collection: …` file behave exactly
   * like clicking the collection in the sidebar — same UI, same shortcuts.
   */
  const routeToView = (
    connectionId: string,
    relPath: string,
    fm: MangoFrontmatter,
  ) => {
    const ws = { workspaceId: workspace.id, filePath: relPath };
    const kind = fm.kind ?? "console";
    // Free-form notebook → workspace-file tab; WorkspaceFileView delegates
    // to NotebookView once it parses the frontmatter.
    if (kind === "notebook") {
      openWorkspaceFile(connectionId, workspace.id, relPath);
      return;
    }
    if ((kind === "console" || kind === "query" || kind === "aggregation") && fm.collection) {
      openCollection(connectionId, fm.collection, {
        workspaceFile: ws,
        initialPageMode: kind === "console" ? "console" : "query",
      });
      return;
    }
    if (kind === "shell") {
      openShell(connectionId, { workspaceFile: ws });
      return;
    }
    if (kind === "console") {
      openConsole(connectionId, { workspaceFile: ws });
      return;
    }
    // Unknown / legacy kind without a collection — fall back to the dedicated
    // workspace-file view so the user can edit the script and pick a kind.
    openWorkspaceFile(connectionId, workspace.id, relPath);
  };

  /**
   * Open a workspace file, resolving the connection from the file's
   * frontmatter when possible:
   *   1. If `connectionId` matches a registered connection → open with it.
   *   2. Otherwise → prompt the user via OpenFileConnectionDialog (which
   *      suggests a connection by display-name or default-database match).
   * Falls back to the active connection only when there's no metadata at
   * all and one is already selected.
   */
  const onOpenFile = async (relPath: string) => {
    if (resolvingPath) return;
    setResolvingPath(relPath);
    try {
      const file = await api.readWorkspaceFile(workspace.id, relPath);
      const fm = parseMd(file.raw).frontmatter;
      const stored = fm.connectionId
        ? connections.find((c) => c.id === fm.connectionId)
        : null;
      if (stored) {
        setActiveId(stored.id);
        if (fm.database) setDatabase(fm.database);
        routeToView(stored.id, relPath, fm);
        return;
      }
      // Legacy file (no connectionId) AND we already have an active
      // connection — silently use it. The frontmatter `connection` hint
      // would surface as the existing mismatch banner if it's wrong.
      if (!fm.connectionId && activeId && connections.length > 0) {
        if (fm.database) setDatabase(fm.database);
        routeToView(activeId, relPath, fm);
        return;
      }
      // Either the stored connectionId no longer resolves, or we have no
      // active connection — let the user pick.
      setPendingOpen({
        relPath,
        frontmatter: fm,
        staleConnectionId: !!fm.connectionId,
      });
    } catch (e) {
      alert(
        `Could not read file: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setResolvingPath(null);
    }
  };

  const dotColor = workspace.color ?? "#94a3b8";
  // Workspace-file binding may live on any tab kind now that files route
  // to the matching view — match on workspaceId/filePath, not tab.kind.
  const activePath =
    activeTab?.workspaceId === workspace.id
      ? (activeTab.workspaceFilePath ?? null)
      : null;

  const startNew = (kind: "file" | "dir") => {
    setPendingKind(kind);
    setPendingChildOf("");
    setOpen(true);
  };

  return (
    <div className="border-b border-slate-200 last:border-b-0 dark:border-slate-800">
      <div className="flex items-center gap-1 px-2 py-1">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          title={open ? "Collapse" : "Expand"}
        >
          {open ? (
            <IconChevronDown size={12} />
          ) : (
            <IconChevronRight size={12} />
          )}
        </button>
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: dotColor }}
        />
        <span className="flex-1 truncate text-[11.5px] font-medium text-slate-700 dark:text-slate-200">
          {workspace.name}
        </span>
        {git.data?.rootIsRepo && (
          <span
            title={`${git.data.branch ?? "(detached)"} @ ${git.data.shortSha ?? "?"}${git.data.dirty ? " · dirty" : ""}`}
            className={[
              "rounded px-1 font-mono text-[10px]",
              git.data.dirty
                ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                : "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
            ].join(" ")}
          >
            {git.data.branch ?? "(no branch)"}
          </span>
        )}
        <button
          type="button"
          onClick={() => startNew("file")}
          className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          title="New file"
        >
          <IconFilePlus size={12} />
        </button>
        <button
          type="button"
          onClick={() => startNew("dir")}
          className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          title="New folder"
        >
          <IconFolderPlus size={12} />
        </button>
        <button
          type="button"
          onClick={() => tree.refetch()}
          className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          title="Refresh"
        >
          <IconRefresh size={12} className={tree.isFetching ? "animate-spin" : ""} />
        </button>
        <button
          type="button"
          onClick={() => setConfirmingUnregister(true)}
          className="rounded p-0.5 text-slate-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-950/50 dark:hover:text-red-300"
          title="Unregister workspace"
        >
          <IconTrash size={12} />
        </button>
      </div>

      {open && (
        <div className="px-1 pb-1">
          {tree.isLoading && (
            <div className="px-2 py-1 text-[11px] text-slate-400">Loading…</div>
          )}
          {tree.isError && (
            <div className="px-2 py-1 text-[11px] text-red-500">
              {(tree.error as Error)?.message ?? "Failed to read folder."}
            </div>
          )}
          {pendingChildOf === "" && (
            <NewRootChild
              kind={pendingKind}
              onCommit={async (name) => {
                setPendingChildOf(null);
                if (!name) return;
                if (pendingKind === "dir") {
                  await muts.createFolder.mutateAsync(name);
                } else {
                  const { serializeMd, ensureMangoFileExt } = await import("./markdownDoc");
                  const raw = serializeMd({
                    frontmatter: {
                      kind: "notebook",
                      collection: null,
                      connection: null,
                      connectionId: null,
                      database: null,
                      fields: null,
                    },
                    description: "",
                    script: "db.\n",
                  });
                  const { api } = await import("../../api/client");
                  await api.writeWorkspaceFile(
                    workspace.id,
                    ensureMangoFileExt(name),
                    raw,
                  );
                }
              }}
              onCancel={() => setPendingChildOf(null)}
            />
          )}
          {tree.data?.entries.map((e) => (
            <TreeNode
              key={e.name}
              workspaceId={workspace.id}
              parentPath=""
              entry={e}
              level={0}
              isActive={activePath === e.name}
              onOpenFile={onOpenFile}
              renamingPath={renamingPath}
              setRenamingPath={setRenamingPath}
              pendingChildOf={pendingChildOf}
              setPendingChildOf={setPendingChildOf}
              pendingKind={pendingKind}
              dragOverPath={dragOverPath}
              setDragOverPath={setDragOverPath}
            />
          ))}
          {tree.data && tree.data.entries.length === 0 && pendingChildOf !== "" && (
            <div className="px-2 py-1 text-[11px] text-slate-400">
              Empty folder.
            </div>
          )}
        </div>
      )}

      {pendingOpen && (
        <OpenFileConnectionDialog
          fileLabel={`${workspace.name}/${pendingOpen.relPath}`}
          frontmatter={pendingOpen.frontmatter}
          connections={connections}
          staleConnectionId={pendingOpen.staleConnectionId}
          onCancel={() => setPendingOpen(null)}
          onPick={(connectionId, database) => {
            setActiveId(connectionId);
            setDatabase(database);
            routeToView(connectionId, pendingOpen.relPath, pendingOpen.frontmatter);
            setPendingOpen(null);
          }}
        />
      )}

      {confirmingUnregister && (
        <ConfirmDialog
          title={`Unregister "${workspace.name}"?`}
          message={
            <div className="space-y-2">
              <div>
                The workspace will be removed from the sidebar.
              </div>
              <div className="text-[12px] text-slate-500 dark:text-slate-400">
                The folder{" "}
                <span className="font-mono">{workspace.folderPath}</span> on
                disk is not deleted.
              </div>
            </div>
          }
          confirmLabel="Unregister"
          danger
          busy={del.isPending}
          onConfirm={() => {
            del.mutate(workspace.id, {
              onSuccess: () => setConfirmingUnregister(false),
            });
          }}
          onCancel={() => {
            if (!del.isPending) setConfirmingUnregister(false);
          }}
        />
      )}
    </div>
  );
};

const NewRootChild = ({
  kind,
  onCommit,
  onCancel,
}: {
  kind: "file" | "dir";
  onCommit: (name: string) => void;
  onCancel: () => void;
}) => {
  return (
    <div className="flex items-center gap-1 rounded px-1 py-[2px] pl-4">
      <input
        autoFocus
        type="text"
        placeholder={kind === "dir" ? "new-folder" : "untitled"}
        onBlur={(e) => onCommit(e.target.value.trim())}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onCommit((e.target as HTMLInputElement).value.trim());
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        className="flex-1 rounded border border-sky-400 bg-white px-1 font-mono text-[12.5px] text-slate-900 focus:outline-none dark:bg-slate-900 dark:text-slate-100"
      />
    </div>
  );
};
