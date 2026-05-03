import { IconAlertTriangle, IconCheck, IconInfoCircle, IconX } from "@tabler/icons-react";
import { dismissToast, useToasts, type Toast } from "./toasts";

const KIND_STYLES: Record<
  Toast["kind"],
  { ring: string; bg: string; icon: typeof IconAlertTriangle }
> = {
  error: {
    ring: "border-red-300 dark:border-red-700/60",
    bg: "bg-red-50 dark:bg-red-900/20",
    icon: IconAlertTriangle,
  },
  info: {
    ring: "border-slate-200 dark:border-slate-700",
    bg: "bg-white dark:bg-slate-900",
    icon: IconInfoCircle,
  },
  success: {
    ring: "border-emerald-300 dark:border-emerald-700/60",
    bg: "bg-emerald-50 dark:bg-emerald-900/20",
    icon: IconCheck,
  },
};

export const Toaster = () => {
  const toasts = useToasts();
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2">
      {toasts.map((t) => {
        const style = KIND_STYLES[t.kind];
        const Icon = style.icon;
        return (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-md border ${style.ring} ${style.bg} p-3 shadow-lg`}
          >
            <div className="flex items-start gap-2">
              <Icon
                size={16}
                className={
                  t.kind === "error"
                    ? "mt-0.5 flex-shrink-0 text-red-600 dark:text-red-400"
                    : t.kind === "success"
                      ? "mt-0.5 flex-shrink-0 text-emerald-600 dark:text-emerald-400"
                      : "mt-0.5 flex-shrink-0 text-slate-500"
                }
              />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-slate-900 dark:text-slate-100">
                  {t.title}
                </div>
                {t.detail && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[11px] text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
                      Details
                    </summary>
                    <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-100 p-2 text-[11px] text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      {t.detail}
                    </pre>
                  </details>
                )}
                {t.actions && t.actions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {t.actions.map((a, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => {
                          void a.onClick();
                        }}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => dismissToast(t.id)}
                className="ml-1 flex-shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
              >
                <IconX size={14} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
