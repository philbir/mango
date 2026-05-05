import { IconDownload, IconX } from "@tabler/icons-react";
import { useUpdater } from "./useUpdater";

/**
 * Renders nothing when running outside Tauri or when the app is up to date.
 * When a newer version is available, shows a slim top banner with an
 * "Install & Restart" button and a dismiss option.
 */
export const UpdateBanner = () => {
  const { available, installing, error, install, dismiss } = useUpdater();

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
    <div className="border-b border-green-300 bg-green-50 px-4 py-2 text-[13px] text-green-900 dark:border-green-700/60 dark:bg-green-900/20 dark:text-green-100">
      <div className="flex items-center gap-2">
        <IconDownload size={15} className="flex-shrink-0" />
        <span className="flex-1">
          <span className="font-medium">Mango {available!.version} is available</span>
          {available!.body && (
            <span className="ml-2 opacity-70">{available!.body}</span>
          )}
        </span>
        <button
          type="button"
          onClick={() => void install()}
          disabled={installing}
          className="rounded bg-green-600 px-2 py-1 text-[12px] font-medium text-white hover:bg-green-700 disabled:opacity-50"
        >
          {installing ? "Installing…" : "Install & Restart"}
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="rounded p-0.5 hover:bg-green-200 dark:hover:bg-green-800/40"
          aria-label="Dismiss update notification"
        >
          <IconX size={14} />
        </button>
      </div>
    </div>
  );
};
