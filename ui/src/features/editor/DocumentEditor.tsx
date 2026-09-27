import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  IconAlertTriangle,
  IconDeviceFloppy,
  IconPencil,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  api,
  extractIdString,
  stringifyEJSON,
} from "../../api/client";
import { MonacoJsonInput } from "../../components/MonacoJsonInput";
import { MONGO_SHELL_LANGUAGE } from "../../monaco-mongo";
import { useSettings } from "../../settings";
import { useActiveConnection } from "../connections/useActiveConnection";
import { useActiveDatabase } from "../connections/useActiveDatabase";
import {
  type FormatOptions,
  editFormatFor,
  formatDocument,
  isShellFormat,
  parseDocument,
} from "../documents/docFormats";

interface Props {
  collectionName: string;
  document: Record<string, unknown>;
  onClose: () => void;
  readOnly?: boolean;
  /** Called after a successful save — lets the host refresh its own queries
   * (e.g. a notebook re-runs its query) on top of the built-in ["docs"] invalidation. */
  onSaved?: (document: Record<string, unknown>) => void;
}

type Mode = "view" | "edit";

const stripId = (doc: Record<string, unknown>): Record<string, unknown> => {
  const { _id: _ignored, ...rest } = doc;
  return rest;
};

export const DocumentEditor = ({
  collectionName,
  document: doc,
  onClose,
  readOnly = false,
  onSaved,
}: Props) => {
  const { activeId } = useActiveConnection();
  const { database } = useActiveDatabase();
  const { jsonFormat, formatOptions } = useSettings();
  const queryClient = useQueryClient();

  const id = extractIdString(doc._id);
  // View and edit both render in the global format (Settings → Configure
  // formats), so what you read is what you edit. Plain JSON can't round-trip
  // BSON types, so editing falls back to the shell format for it.
  const editFormat = editFormatFor(jsonFormat);
  const fullJson = useMemo(() => {
    const text = formatDocument(doc, jsonFormat, formatOptions);
    if (!isShellFormat(jsonFormat)) return text;
    const ns = database ? `${database}.${collectionName}` : collectionName;
    return `// collection: ${ns}\n${text}`;
  }, [doc, jsonFormat, formatOptions, database, collectionName]);
  const editJson = useMemo(
    () => formatDocument(stripId(doc), editFormat, formatOptions),
    [doc, editFormat, formatOptions],
  );

  const [mode, setMode] = useState<Mode>("view");
  const [editText, setEditText] = useState(editJson);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [preview, setPreview] = useState<
    | { kind: "update"; edited: Record<string, unknown> }
    | { kind: "delete" }
    | null
  >(null);

  // Reset state when the document changes (different row clicked).
  useEffect(() => {
    setMode("view");
    setEditText(editJson);
    setError(null);
    setSavedAt(null);
    setPreview(null);
  }, [editJson]);

  // Confirm dialogs show the command in shell syntax — `ObjectId("…")`, not
  // `{ "$oid": … }` — regardless of the editor format.
  const idShell = useMemo(
    () => formatDocument(doc._id, "shell", formatOptions),
    [doc._id, formatOptions],
  );

  const onSaveSuccess = (result: { document: Record<string, unknown> }) => {
    setEditText(formatDocument(stripId(result.document), editFormat, formatOptions));
    setSavedAt(Date.now());
    setError(null);
    setMode("view");
    queryClient.invalidateQueries({ queryKey: ["docs", activeId] });
    onSaved?.(result.document);
  };

  const onSaveError = (e: unknown) => {
    const message =
      e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
    setError(message);
  };

  const save = useMutation({
    mutationFn: async (mergedBody: string) => {
      if (!activeId) throw new Error("No active connection");
      return api.putDocument(
        activeId,
        collectionName,
        id,
        mergedBody,
        database ?? undefined,
      );
    },
    onSuccess: onSaveSuccess,
    onError: onSaveError,
  });

  const patch = useMutation({
    mutationFn: async (updateBody: string) => {
      if (!activeId) throw new Error("No active connection");
      return api.patchDocument(
        activeId,
        collectionName,
        id,
        updateBody,
        database ?? undefined,
      );
    },
    onSuccess: onSaveSuccess,
    onError: onSaveError,
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!activeId) throw new Error("No active connection");
      return api.deleteDocument(
        activeId,
        collectionName,
        id,
        database ?? undefined,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["docs", activeId] });
      onClose();
    },
    onError: (e) => {
      const message =
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
      setError(message);
    },
  });

  const onClickDelete = () => {
    setError(null);
    setPreview({ kind: "delete" });
  };

  const onClickSave = () => {
    setError(null);
    let parsed: unknown;
    try {
      parsed = parseDocument(editText, editFormat, formatOptions);
    } catch (e) {
      setError(
        `Invalid document: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setError("Body must be a JSON object.");
      return;
    }
    setPreview({
      kind: "update",
      edited: parsed as Record<string, unknown>,
    });
  };

  const onConfirmUpdate = (variant: "update" | "replace", body: string) => {
    if (variant === "replace") {
      save.mutate(body, { onSettled: () => setPreview(null) });
    } else {
      patch.mutate(body, { onSettled: () => setPreview(null) });
    }
  };

  const onConfirmDelete = () => {
    remove.mutate(undefined, { onSettled: () => setPreview(null) });
  };

  const onCancelEdit = () => {
    setEditText(editJson);
    setMode("view");
    setError(null);
  };

  const isViewing = mode === "view";
  const busy = save.isPending || patch.isPending || remove.isPending;

  // Esc closes the confirm dialog if one is open, otherwise the drawer. Edit
  // mode ignores it so a stray Esc (e.g. dismissing Monaco's suggest widget)
  // can't throw away unsaved changes. Monaco marks keys it handled itself
  // (find widget, etc.) as defaultPrevented.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (preview) {
        if (!busy) setPreview(null);
        return;
      }
      if (mode === "view") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [preview, busy, mode, onClose]);

  return (
    <>
      {/* Non-modal drawer: no backdrop, so the result table stays clickable
          and keyboard-navigable while a document is open. */}
      <div
        className="fixed inset-y-0 right-0 z-30 flex w-1/2 min-w-[480px] flex-col border-l border-slate-300 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        data-doc-editor-locked={!isViewing || preview ? "" : undefined}
      >
        <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-500">
              {collectionName}
              {!isViewing && (
                <span className="ml-1.5 rounded bg-amber-500/15 px-1.5 py-px text-[9px] font-semibold text-amber-700 dark:text-amber-300">
                  EDITING
                </span>
              )}
            </div>
            <div className="truncate font-mono text-sm text-slate-900 dark:text-slate-100">
              {id}
            </div>
          </div>

          {isViewing && !readOnly && (
            <>
              <button
                type="button"
                onClick={() => setMode("edit")}
                className="flex items-center gap-1.5 rounded border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <IconPencil size={13} />
                Update
              </button>
              <button
                type="button"
                onClick={onClickDelete}
                disabled={remove.isPending}
                className="flex items-center gap-1.5 rounded border border-red-300 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-700/40 dark:text-red-300 dark:hover:bg-red-900/20"
              >
                <IconTrash size={13} />
                {remove.isPending ? "Deleting…" : "Delete"}
              </button>
            </>
          )}
          {!isViewing && (
            <>
              <button
                type="button"
                onClick={onCancelEdit}
                className="rounded border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onClickSave}
                disabled={save.isPending}
                className="flex items-center gap-1.5 rounded bg-sky-500 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-sky-400 disabled:opacity-50"
              >
                <IconDeviceFloppy size={13} />
                {save.isPending ? "Saving…" : "Save"}
              </button>
            </>
          )}

          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            title="Close (Esc)"
          >
            <IconX size={18} />
          </button>
        </header>

        {!isViewing && (
          <div className="flex items-center gap-1.5 border-b border-amber-200 bg-amber-50 px-4 py-1 text-[11px] text-amber-800 dark:border-amber-700/30 dark:bg-amber-900/20 dark:text-amber-200">
            <IconAlertTriangle size={11} />
            <span>
              <span className="font-mono">_id</span> is hidden — it can't be
              changed.
            </span>
          </div>
        )}

        <div className="flex-1 overflow-hidden">
          {isViewing ? (
            <MonacoJsonInput
              key={`view-${id}-${jsonFormat}`}
              value={fullJson}
              language={isShellFormat(jsonFormat) ? MONGO_SHELL_LANGUAGE : "json"}
              onChange={() => {
                /* read-only */
              }}
              minHeight="100%"
              showLineNumbers
              readOnly
            />
          ) : (
            <MonacoJsonInput
              key={`edit-${id}-${editFormat}`}
              value={editText}
              language={isShellFormat(editFormat) ? MONGO_SHELL_LANGUAGE : "json"}
              onChange={setEditText}
              minHeight="100%"
              showLineNumbers
            />
          )}
        </div>

        {(error || savedAt) && (
          <footer className="border-t border-slate-200 px-4 py-2 text-xs dark:border-slate-800">
            {error && (
              <div className="rounded border border-red-300 bg-red-50 px-2 py-1 text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
                {error}
              </div>
            )}
            {!error && savedAt && (
              <div className="text-emerald-600 dark:text-emerald-400">
                Saved {new Date(savedAt).toLocaleTimeString()}
              </div>
            )}
          </footer>
        )}
      </div>

      {preview?.kind === "delete" && (
        <DeleteConfirm
          command={`db.${collectionName}.deleteOne({ "_id" : ${idShell} })`}
          busy={remove.isPending}
          onCancel={() => setPreview(null)}
          onConfirm={onConfirmDelete}
        />
      )}

      {preview?.kind === "update" && (
        <UpdateConfirm
          collectionName={collectionName}
          idShell={idShell}
          original={doc}
          edited={preview.edited}
          formatOptions={formatOptions}
          busy={save.isPending || patch.isPending}
          onCancel={() => setPreview(null)}
          onConfirm={onConfirmUpdate}
        />
      )}
    </>
  );
};

const DeleteConfirm = ({
  command,
  busy,
  onCancel,
  onConfirm,
}: {
  command: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) => (
  <PreviewShell
    title="Confirm delete"
    danger
    busy={busy}
    onCancel={onCancel}
    footer={
      <button
        type="button"
        onClick={onConfirm}
        disabled={busy}
        className="rounded bg-red-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-400 disabled:opacity-50"
      >
        {busy ? "…" : "Delete"}
      </button>
    }
  >
    <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
      Will execute
    </div>
    <pre className="overflow-auto rounded [tab-size:2] border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[11.5px] leading-relaxed text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
      {command}
    </pre>
  </PreviewShell>
);

/**
 * Shallow diff: compares each top-level key (excluding _id) by stringifying its
 * value through canonical EJSON. Sub-document changes therefore turn into a full
 * $set of the top-level field — fine for typical user edits, and avoids the
 * thorny problem of computing safe dot-notation paths through arrays.
 */
const computeUpdateOperators = (
  original: Record<string, unknown>,
  edited: Record<string, unknown>,
): { $set?: Record<string, unknown>; $unset?: Record<string, ""> } => {
  const $set: Record<string, unknown> = {};
  const $unset: Record<string, ""> = {};
  const editKeys = Object.keys(edited).filter((k) => k !== "_id");
  const origKeys = Object.keys(original).filter((k) => k !== "_id");
  for (const k of editKeys) {
    const before = stringifyEJSON(original[k]);
    const after = stringifyEJSON(edited[k]);
    if (!(k in original) || before !== after) {
      $set[k] = edited[k];
    }
  }
  for (const k of origKeys) {
    if (!(k in edited)) $unset[k] = "";
  }
  const out: { $set?: Record<string, unknown>; $unset?: Record<string, ""> } = {};
  if (Object.keys($set).length > 0) out.$set = $set;
  if (Object.keys($unset).length > 0) out.$unset = $unset;
  return out;
};

const UpdateConfirm = ({
  collectionName,
  idShell,
  original,
  edited,
  formatOptions,
  busy,
  onCancel,
  onConfirm,
}: {
  collectionName: string;
  idShell: string;
  original: Record<string, unknown>;
  edited: Record<string, unknown>;
  formatOptions: FormatOptions;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (variant: "update" | "replace", body: string) => void;
}) => {
  const [variant, setVariant] = useState<"update" | "replace">("update");
  const ops = useMemo(
    () => computeUpdateOperators(stripId(original), edited),
    [original, edited],
  );
  const hasChanges = ops.$set !== undefined || ops.$unset !== undefined;

  const replaceMerged = useMemo(
    () => ({ _id: original._id, ...edited }),
    [original._id, edited],
  );
  const replaceBody = useMemo(() => stringifyEJSON(replaceMerged), [replaceMerged]);
  const updateBody = useMemo(() => stringifyEJSON(ops), [ops]);

  const command = useMemo(() => {
    if (variant === "replace") {
      const previewBody = indentTail(
        formatDocument(replaceMerged, "shell", formatOptions),
      );
      return `db.${collectionName}.replaceOne(\n\t{ "_id" : ${idShell} },\n\t${previewBody}\n)`;
    }
    if (!hasChanges) {
      return `// No changes — nothing to $set or $unset.`;
    }
    const previewOps = indentTail(formatDocument(ops, "shell", formatOptions));
    return `db.${collectionName}.updateOne(\n\t{ "_id" : ${idShell} },\n\t${previewOps}\n)`;
  }, [variant, collectionName, idShell, replaceMerged, ops, hasChanges, formatOptions]);

  const canConfirm = variant === "replace" || hasChanges;

  return (
    <PreviewShell
      title="Confirm update"
      busy={busy}
      onCancel={onCancel}
      footer={
        <>
          <div className="flex rounded border border-slate-300 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900">
            <VariantTab
              value="update"
              current={variant}
              onChange={setVariant}
              label="Update"
              hint="updateOne with $set / $unset of changed fields only"
            />
            <VariantTab
              value="replace"
              current={variant}
              onChange={setVariant}
              label="Replace"
              hint="replaceOne with the full document"
            />
          </div>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() =>
              onConfirm(variant, variant === "replace" ? replaceBody : updateBody)
            }
            disabled={busy || !canConfirm}
            className="rounded bg-sky-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50"
          >
            {busy ? "…" : variant === "replace" ? "Replace" : "Update"}
          </button>
        </>
      }
    >
      <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Will execute
      </div>
      <pre className="overflow-auto rounded [tab-size:2] border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[11.5px] leading-relaxed text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
        {command}
      </pre>
    </PreviewShell>
  );
};

/** Indent every line but the first by one tab, for nesting inside a call. */
const indentTail = (text: string): string => text.replace(/\n/g, "\n\t");

const VariantTab = ({
  value,
  current,
  onChange,
  label,
  hint,
}: {
  value: "update" | "replace";
  current: "update" | "replace";
  onChange: (v: "update" | "replace") => void;
  label: string;
  hint: string;
}) => (
  <button
    type="button"
    onClick={() => onChange(value)}
    title={hint}
    className={`rounded px-2 py-0.5 text-[11px] ${
      current === value
        ? "bg-sky-500/15 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200"
        : "text-slate-600 dark:text-slate-300"
    }`}
  >
    {label}
  </button>
);

const PreviewShell = ({
  title,
  danger = false,
  busy,
  onCancel,
  children,
  footer,
}: {
  title: string;
  danger?: boolean;
  busy: boolean;
  onCancel: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) => (
  <div
    className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
    onClick={(e) => {
      if (e.target === e.currentTarget && !busy) onCancel();
    }}
  >
    <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
      <header className="flex items-start gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
        {danger && (
          <IconAlertTriangle
            size={18}
            className="mt-0.5 flex-shrink-0 text-red-500"
          />
        )}
        <div className="flex-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
          {title}
        </div>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
        >
          <IconX size={14} />
        </button>
      </header>
      <div className="flex-1 overflow-auto px-4 py-3">{children}</div>
      <footer className="flex items-center gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-700">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Cancel
        </button>
        {footer}
      </footer>
    </div>
  </div>
);
