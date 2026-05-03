import { IconAlertTriangle, IconX } from "@tabler/icons-react";

interface Props {
  title: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog = ({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: Props) => (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    onClick={(e) => {
      if (e.target === e.currentTarget && !busy) onCancel();
    }}
  >
    <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
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
      {message && (
        <div className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300">
          {message}
        </div>
      )}
      <footer className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-700">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className={`rounded px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${
            danger
              ? "bg-red-500 hover:bg-red-400"
              : "bg-sky-500 hover:bg-sky-400"
          }`}
        >
          {busy ? "…" : confirmLabel}
        </button>
      </footer>
    </div>
  </div>
);
