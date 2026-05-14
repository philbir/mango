import { IconX } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { ApiError, api } from "../../api/client";
import { useActiveDatabase } from "../connections/useActiveDatabase";
import { useTabs } from "../tabs/TabsContext";
import {
  type MangoFrontmatter,
  type MangoKind,
  ensureMangoFileExt,
  inferCollectionFromScript,
  mangoFileDisplayName,
  serializeMd,
  suggestFilenameFromScript,
} from "./markdownDoc";
import { useWorkspaces } from "./useWorkspaces";

interface Props {
  /** Connection id this script ran against — saved as informational hint. */
  connectionId: string | null;
  /** File kind. Drives the on-disk extension and the view we open after save. */
  kind: MangoKind;
  /** Script body — filter JSON for query, full DB command for console. */
  script: string;
  /**
   * Collection this file is scoped to. Required for kind="console" (it's
   * what we route to after save) and conventionally set for kind="query"
   * too. Inferred from the script as a last resort.
   */
  collection?: string | null;
  /** Selected projection fields, persisted to frontmatter for kind="query". */
  fields?: string[] | null;
  /** Optional description (Markdown above the script fence). */
  description?: string;
  /**
   * Suggested filename stem (no extension). Used when the script body isn't
   * a `db.<col>.<verb>(…)` call we can guess from — e.g. a query file whose
   * body is just the filter JSON.
   */
  suggestedFilename?: string;
  onClose: () => void;
}

export const SaveToWorkspaceDialog = ({
  connectionId,
  kind,
  script,
  collection,
  fields = null,
  description = "",
  suggestedFilename,
  onClose,
}: Props) => {
  const { workspaces, enabled } = useWorkspaces();
  const { openCollection, openNotebook } = useTabs();
  const { database } = useActiveDatabase();
  const [workspaceId, setWorkspaceId] = useState<string>(
    workspaces[0]?.id ?? "",
  );
  // Workspaces load async — pick the first one as soon as it's available so
  // the dropdown's visible default actually matches state on submit.
  useEffect(() => {
    if (!workspaceId && workspaces.length > 0) {
      setWorkspaceId(workspaces[0]!.id);
    }
  }, [workspaceId, workspaces]);
  const [folder, setFolder] = useState("");
  const [filename, setFilename] = useState(() =>
    suggestedFilename
      ? mangoFileDisplayName(ensureMangoFileExt(suggestedFilename, kind))
      : mangoFileDisplayName(suggestFilenameFromScript(script, kind)),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Look up active connection's name for the frontmatter `connection` hint.
  const [connectionName, setConnectionName] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!connectionId) {
      setConnectionName(null);
      return;
    }
    api
      .listConnections()
      .then((r) => {
        if (cancelled) return;
        setConnectionName(
          r.connections.find((c) => c.id === connectionId)?.name ?? null,
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [connectionId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!workspaceId) {
      setError("Pick a workspace.");
      return;
    }
    let name = filename.trim();
    if (!name) {
      setError("Name is required.");
      return;
    }
    name = ensureMangoFileExt(name, kind);
    const folderClean = folder.trim().replace(/^\/+|\/+$/g, "");
    const relPath = folderClean ? `${folderClean}/${name}` : name;
    const resolvedCollection =
      collection ?? inferCollectionFromScript(script);
    if ((kind === "query" || kind === "console") && !resolvedCollection) {
      setError("This file needs a collection. Pick one before saving.");
      return;
    }
    const fm: MangoFrontmatter = {
      collection: resolvedCollection,
      connection: connectionName,
      connectionId: connectionId ?? null,
      database: database ?? null,
      fields: fields && fields.length > 0 ? fields : null,
    };
    const raw = serializeMd({
      frontmatter: fm,
      description,
      script,
    });
    setBusy(true);
    try {
      await api.writeWorkspaceFile(workspaceId, relPath, raw);
      if (connectionId) {
        if (kind === "notebook") {
          openNotebook(connectionId, workspaceId, relPath);
        } else if (resolvedCollection) {
          openCollection(connectionId, resolvedCollection, {
            workspaceFile: { workspaceId, filePath: relPath },
            initialPageMode: kind === "console" ? "console" : "query",
          });
        }
      }
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40">
      <form
        onSubmit={onSubmit}
        className="w-[460px] rounded-lg border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Save to workspace
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
          >
            <IconX size={14} />
          </button>
        </div>

        {!enabled && (
          <div className="mb-3 rounded border border-amber-200 bg-amber-50 p-2 text-[11.5px] text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
            Workspaces are disabled in this mode.
          </div>
        )}

        {enabled && workspaces.length === 0 && (
          <div className="mb-3 rounded border border-slate-200 bg-slate-50 p-2 text-[11.5px] text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            You don't have any workspaces yet. Add one from the sidebar first.
          </div>
        )}

        <label className="mb-2 block">
          <span className="block text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Workspace
          </span>
          <select
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
            disabled={!enabled || workspaces.length === 0}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>

        <label className="mb-2 block">
          <span className="block text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Folder (within workspace, optional)
          </span>
          <input
            type="text"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder="queries/users"
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 font-mono text-[12px] text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </label>

        <label className="mb-3 block">
          <span className="block text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Name
          </span>
          <input
            type="text"
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 font-mono text-[12px] text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            autoFocus
          />
        </label>

        {error && (
          <div className="mb-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-[11.5px] text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !enabled || workspaces.length === 0}
            className="rounded bg-sky-500 px-3 py-1 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
};
