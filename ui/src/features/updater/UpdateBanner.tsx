import { IconDownload, IconX } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { Markdown } from "../assistant/Markdown";
import { useUpdater } from "./useUpdater";

export const UpdateBanner = () => {
  const { available, installing, error, install, dismiss } = useUpdater();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const titleRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!detailsOpen) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !installing) {
        setDetailsOpen(false);
        titleRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detailsOpen, installing]);

  const closeDetails = () => {
    setDetailsOpen(false);
    titleRef.current?.focus();
  };

  if (!available && !error) return null;

  if (error) {
    return (
      <div className="border-b border-yellow-300 bg-yellow-50 px-4 py-2 text-[13px] text-yellow-900 dark:border-yellow-700/60 dark:bg-yellow-900/20 dark:text-yellow-100">
        <div className="flex items-center gap-2">
          <span className="flex-1">Update check failed: {error}</span>
          <button
            type="button"
            onClick={dismiss}
            className="rounded p-0.5 hover:bg-yellow-200 dark:hover:bg-yellow-800/40"
            aria-label="Dismiss"
          >
            <IconX size={14} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="border-b border-green-300 bg-green-50 px-4 py-2 text-[13px] text-green-900 dark:border-green-700/60 dark:bg-green-900/20 dark:text-green-100">
        <div className="flex items-center gap-2">
          <IconDownload size={15} className="flex-shrink-0" />
          <button
            ref={titleRef}
            type="button"
            onClick={() => setDetailsOpen(true)}
            className="flex-1 text-left font-medium hover:underline"
            aria-haspopup="dialog"
          >
            Mango {available!.version} is available
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="btn-icon btn-ghost"
            aria-label="Dismiss update notification"
          >
            <IconX size={14} />
          </button>
        </div>
      </div>
      {detailsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget && !installing) closeDetails();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="update-title"
            className="flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
          >
            <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
              <h2 id="update-title" className="flex-1 text-base font-semibold text-slate-900 dark:text-slate-100">
                Mango {available!.version} is available
              </h2>
              <button
                ref={closeRef}
                type="button"
                onClick={closeDetails}
                disabled={installing}
                className="btn-icon btn-ghost"
                aria-label="Close update details"
              >
                <IconX size={16} />
              </button>
            </header>
            <div className="min-h-0 overflow-y-auto px-4 py-3">
              {available!.body ? <Markdown text={available!.body} /> : <p className="text-sm text-slate-600 dark:text-slate-300">A new version is ready to install.</p>}
            </div>
            <footer className="flex justify-end border-t border-slate-200 px-4 py-3 dark:border-slate-700">
              <button
                type="button"
                onClick={() => void install()}
                disabled={installing}
                className="btn btn-primary inline-flex items-center gap-2"
              >
                <IconDownload size={16} />
                {installing ? "Installing…" : "Install & Restart"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
};
