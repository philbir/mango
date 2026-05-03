import { useMutation, useQueryClient } from "@tanstack/react-query";
import { IconPencil, IconPlus, IconTrash, IconX } from "@tabler/icons-react";
import { useState } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ApiError, api, type ConnectionPublic } from "../../api/client";
import { useActiveConnection } from "./useActiveConnection";
import { ConnectionFormModal } from "./ConnectionFormModal";
import { SourceBadge } from "./ConnectionPicker";

interface Props {
  onClose: () => void;
}

export const ConnectionsManagerModal = ({ onClose }: Props) => {
  const queryClient = useQueryClient();
  const { connections, activeId, setActiveId } = useActiveConnection();
  const [editing, setEditing] = useState<ConnectionPublic | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmingDelete, setConfirmingDelete] =
    useState<ConnectionPublic | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteConnection(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connections"] });
      setConfirmingDelete(null);
    },
  });

  const removeError =
    remove.error instanceof ApiError
      ? remove.error.message
      : remove.error instanceof Error
        ? remove.error.message
        : null;

  return (
    <>
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
        <div className="flex h-[36rem] max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <header className="flex items-start gap-3 border-b border-slate-200 px-5 pb-3 pt-4 dark:border-slate-700">
            <div className="flex-1">
              <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Manage connections
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {connections.length}{" "}
                {connections.length === 1 ? "connection" : "connections"}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <IconX size={16} />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {connections.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-slate-500">
                No connections yet.
              </div>
            )}
            <ul className="divide-y divide-slate-200 dark:divide-slate-800">
              {connections.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center gap-3 rounded px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                >
                  <span
                    className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                    style={{ background: c.color ?? "#94a3b8" }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                        {c.name}
                      </span>
                      {c.id === activeId && (
                        <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-700 dark:text-sky-300">
                          Active
                        </span>
                      )}
                      <SourceBadge conn={c} />
                    </div>
                    <div className="truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">
                      {c.uriRedacted}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditing(c)}
                    className="rounded p-1.5 text-slate-500 hover:bg-slate-200 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
                    title="Edit"
                  >
                    <IconPencil size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(c)}
                    className="rounded p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                    title="Delete"
                  >
                    <IconTrash size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <footer className="flex items-center gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex items-center gap-1.5 rounded bg-sky-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-400"
            >
              <IconPlus size={14} />
              New connection
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Close
            </button>
          </footer>
        </div>
      </div>

      {editing && (
        <ConnectionFormModal
          mode="edit"
          existing={editing}
          onClose={() => setEditing(null)}
        />
      )}

      {creating && (
        <ConnectionFormModal
          mode="create"
          onClose={() => setCreating(false)}
          onCreated={(c) => setActiveId(c.id)}
        />
      )}

      {confirmingDelete && (
        <ConfirmDialog
          title={`Delete connection "${confirmingDelete.name}"?`}
          message={
            <>
              <p>
                This removes the saved connection and its encrypted URI. It will
                not affect the underlying MongoDB database.
              </p>
              {removeError && (
                <p className="mt-2 text-red-600 dark:text-red-400">
                  {removeError}
                </p>
              )}
            </>
          }
          confirmLabel="Delete"
          danger
          busy={remove.isPending}
          onConfirm={() => remove.mutate(confirmingDelete.id)}
          onCancel={() => {
            remove.reset();
            setConfirmingDelete(null);
          }}
        />
      )}
    </>
  );
};
