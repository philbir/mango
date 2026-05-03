import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useState } from "react";
import { api } from "../../api/client";
import { showToast } from "../../components/toasts";

/**
 * Renders nothing when the master key can decrypt every saved row. When some
 * rows are stranded (key changed since they were written), shows a sticky red
 * banner explaining the situation and offering a reset.
 */
export const KeyHealthBanner = () => {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const health = useQuery({
    queryKey: ["key-health"],
    queryFn: () => api.getKeyHealth(),
    staleTime: Infinity,
    retry: 0,
  });

  const reset = useMutation({
    mutationFn: () => api.resetEncrypted(),
    onSuccess: (data) => {
      showToast({
        kind: "success",
        title: `Reset complete — ${data.removedConnections} connection(s) removed.`,
      });
      queryClient.invalidateQueries({ queryKey: ["key-health"] });
      queryClient.invalidateQueries({ queryKey: ["connections"] });
    },
  });

  if (!health.data || health.data.healthy) return null;

  return (
    <div className="border-b border-red-300 bg-red-50 px-4 py-2 text-[13px] text-red-900 dark:border-red-700/60 dark:bg-red-900/20 dark:text-red-100">
      <div className="flex items-start gap-2">
        <IconAlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <div className="font-medium">
            {health.data.undecryptableCount} saved connection
            {health.data.undecryptableCount === 1 ? "" : "s"} cannot be
            decrypted with the current encryption key.
          </div>
          <div className="mt-0.5 text-[12px] opacity-80">
            This usually means the master key changed since they were saved.
            The original URIs are unrecoverable. Reset to remove the stranded
            rows and start fresh.
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {confirming ? (
            <>
              <button
                type="button"
                onClick={() => reset.mutate()}
                disabled={reset.isPending}
                className="rounded bg-red-600 px-2 py-1 text-[12px] font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {reset.isPending ? "Resetting…" : "Confirm reset"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded border border-red-300 bg-white px-2 py-1 text-[12px] font-medium text-red-900 hover:bg-red-50 dark:border-red-700/60 dark:bg-slate-900 dark:text-red-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded border border-red-300 bg-white px-2 py-1 text-[12px] font-medium text-red-900 hover:bg-red-50 dark:border-red-700/60 dark:bg-slate-900 dark:text-red-100 dark:hover:bg-slate-800"
            >
              Reset encrypted data
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
