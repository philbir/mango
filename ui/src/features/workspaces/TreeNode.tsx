import {
  IconChevronDown,
  IconChevronRight,
  IconFile,
  IconFolder,
  IconFolderOpen,
  IconLeaf,
} from "@tabler/icons-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { WorkspaceTreeEntry } from "../../api/client";
import {
  ensureMangoFileExt,
  isMangoFile,
  mangoFileDisplayName,
} from "./markdownDoc";
import { useWorkspaceMutations, useWorkspaceTree } from "./useWorkspaceTree";

interface Props {
  workspaceId: string;
  parentPath: string;
  entry: WorkspaceTreeEntry;
  level: number;
  isActive: boolean;
  onOpenFile: (relPath: string) => void;
  /** Inline-renaming state lifted to parent so only one node renames at a time. */
  renamingPath: string | null;
  setRenamingPath: (p: string | null) => void;
  /** New-folder/new-file in-progress state, if a sibling here is being created. */
  pendingChildOf: string | null;
  setPendingChildOf: (p: string | null) => void;
  pendingKind: "file" | "dir";
  /** Drag-over feedback comes from the parent so only one folder highlights. */
  dragOverPath: string | null;
  setDragOverPath: (p: string | null) => void;
}

export const TreeNode = ({
  workspaceId,
  parentPath,
  entry,
  level,
  isActive,
  onOpenFile,
  renamingPath,
  setRenamingPath,
  pendingChildOf,
  setPendingChildOf,
  pendingKind,
  dragOverPath,
  setDragOverPath,
}: Props) => {
  const fullPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
  const isDir = entry.kind === "dir";
  const [open, setOpen] = useState(false);

  const child = useWorkspaceTree(workspaceId, fullPath, isDir && open);
  const muts = useWorkspaceMutations(workspaceId);

  const isMd = !isDir && isMangoFile(entry.name);
  const renaming = renamingPath === fullPath;

  const onActivate = () => {
    if (isDir) setOpen((o) => !o);
    else if (isMd) onOpenFile(fullPath);
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    // Minimal "menu" — for v1 we rely on the keyboard (F2 rename, Delete)
    // and the small icon row revealed on hover. A richer popover can come
    // later. Keep here to suppress the native menu so right-click on a node
    // is consistent with left-click semantics.
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "F2") {
      e.preventDefault();
      setRenamingPath(fullPath);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        if (confirm(`Delete ${entry.name}?`)) muts.deletePath.mutate(fullPath);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      onActivate();
    }
  };

  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("application/x-mango-ws-path", fullPath);
    e.dataTransfer.effectAllowed = "move";
  };

  const onDragOver = (e: React.DragEvent) => {
    if (!isDir) return;
    if (!e.dataTransfer.types.includes("application/x-mango-ws-path")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverPath(fullPath);
  };

  const onDragLeave = () => {
    if (dragOverPath === fullPath) setDragOverPath(null);
  };

  const onDrop = (e: React.DragEvent) => {
    if (!isDir) return;
    const from = e.dataTransfer.getData("application/x-mango-ws-path");
    setDragOverPath(null);
    if (!from || from === fullPath) return;
    if (from.startsWith(fullPath + "/")) return;
    const baseName = from.split("/").pop()!;
    const to = `${fullPath}/${baseName}`;
    muts.move.mutate({ from, to });
    setOpen(true);
  };

  const isDragOver = dragOverPath === fullPath;

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        draggable
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={onActivate}
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
        className={[
          "group flex items-center gap-1 rounded px-1 py-[2px] text-[12.5px] leading-tight focus:outline-none focus:ring-1 focus:ring-sky-400",
          isActive
            ? "bg-sky-500/15 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200"
            : "text-slate-700 hover:bg-slate-200 dark:text-slate-200 dark:hover:bg-slate-800",
          isDragOver ? "ring-1 ring-sky-400" : "",
        ].join(" ")}
        style={{ paddingLeft: 4 + level * 12 }}
      >
        {isDir ? (
          <span className="text-slate-400">
            {open ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
          </span>
        ) : (
          <span className="w-3" />
        )}
        {isDir ? (
          open ? (
            <IconFolderOpen size={13} className="text-amber-500" />
          ) : (
            <IconFolder size={13} className="text-amber-500" />
          )
        ) : isMd ? (
          <IconLeaf size={13} className="text-emerald-500" />
        ) : (
          <IconFile size={13} className="text-slate-400" />
        )}
        {renaming ? (
          <RenameInput
            initial={isMd ? mangoFileDisplayName(entry.name) : entry.name}
            onCommit={(next) => {
              setRenamingPath(null);
              if (!next) return;
              const finalName = isDir ? next : ensureMangoFileExt(next);
              if (finalName === entry.name) return;
              const to = parentPath ? `${parentPath}/${finalName}` : finalName;
              muts.move.mutate({ from: fullPath, to });
            }}
            onCancel={() => setRenamingPath(null)}
          />
        ) : (
          <span
            className={[
              "flex-1 truncate font-mono",
              isMd ? "" : isDir ? "" : "text-slate-400 dark:text-slate-500",
            ].join(" ")}
          >
            {isMd ? mangoFileDisplayName(entry.name) : entry.name}
          </span>
        )}
      </div>

      {isDir && open && (
        <>
          {child.isLoading && (
            <div
              className="px-2 py-0.5 text-[11px] text-slate-400"
              style={{ paddingLeft: 16 + level * 12 }}
            >
              Loading…
            </div>
          )}
          {child.isError && (
            <div
              className="px-2 py-0.5 text-[11px] text-red-500"
              style={{ paddingLeft: 16 + level * 12 }}
            >
              {(child.error as Error)?.message ?? "Failed"}
            </div>
          )}
          {pendingChildOf === fullPath && (
            <NewChildInput
              level={level + 1}
              kind={pendingKind}
              onCommit={async (name) => {
                setPendingChildOf(null);
                if (!name) return;
                if (pendingKind === "dir") {
                  await muts.createFolder.mutateAsync(`${fullPath}/${name}`);
                } else {
                  // file — we don't have a "create empty file" endpoint, so
                  // write a notebook skeleton. Imported lazily to keep this
                  // module light.
                  const { serializeMd, ensureMangoFileExt } = await import(
                    "./markdownDoc"
                  );
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
                  const childPath = `${fullPath}/${ensureMangoFileExt(name)}`;
                  const { api } = await import("../../api/client");
                  await api.writeWorkspaceFile(workspaceId, childPath, raw);
                }
              }}
              onCancel={() => setPendingChildOf(null)}
            />
          )}
          {child.data?.entries.map((e) => (
            <TreeNode
              key={e.name}
              workspaceId={workspaceId}
              parentPath={fullPath}
              entry={e}
              level={level + 1}
              isActive={false}
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
        </>
      )}
    </div>
  );
};

const RenameInput = ({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (next: string) => void;
  onCancel: () => void;
}) => {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      type="text"
      defaultValue={initial}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => onCommit(e.target.value.trim())}
      onKeyDown={(e) => {
        e.stopPropagation();
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
  );
};

const NewChildInput = ({
  level,
  kind,
  onCommit,
  onCancel,
}: {
  level: number;
  kind: "file" | "dir";
  onCommit: (name: string) => void;
  onCancel: () => void;
}) => {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div
      className="flex items-center gap-1 rounded px-1 py-[2px]"
      style={{ paddingLeft: 4 + level * 12 }}
    >
      <span className="w-3" />
      {kind === "dir" ? (
        <IconFolder size={13} className="text-amber-500" />
      ) : (
        <IconLeaf size={13} className="text-emerald-500" />
      )}
      <input
        ref={ref}
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
