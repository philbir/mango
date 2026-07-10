import { useSyncExternalStore } from "react";
import type { ConnectionPublic, OidcBrowser } from "../../api/client";

interface PendingOidcPrompt {
  connection: ConnectionPublic;
  mode: "activate" | "retry";
  onConfirm: (selection: {
    oidcBrowser: OidcBrowser;
    oidcBrowserProfile: string | null;
    forceRestart: boolean;
  }) => Promise<void> | void;
}

const acknowledgedConnectionIds = new Set<string>();
let pendingPrompt: PendingOidcPrompt | null = null;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

export const requiresOidcAuthPrompt = (connection: ConnectionPublic | null): boolean =>
  !!connection &&
  connection.oidcProvider === "azure-browser" &&
  !acknowledgedConnectionIds.has(connection.id);

export const requestOidcAuthPrompt = (
  connection: ConnectionPublic,
  onConfirm: PendingOidcPrompt["onConfirm"],
  mode: PendingOidcPrompt["mode"] = "activate",
): void => {
  pendingPrompt = { connection, onConfirm, mode };
  emit();
};

export const confirmOidcAuthPrompt = async (selection: {
  oidcBrowser: OidcBrowser;
  oidcBrowserProfile: string | null;
  forceRestart: boolean;
}): Promise<void> => {
  if (!pendingPrompt) return;
  const { connection, onConfirm } = pendingPrompt;
  acknowledgedConnectionIds.add(connection.id);
  await onConfirm(selection);
  pendingPrompt = null;
  emit();
};

export const cancelOidcAuthPrompt = (): void => {
  if (!pendingPrompt) return;
  pendingPrompt = null;
  emit();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = (): PendingOidcPrompt | null => pendingPrompt;

export const usePendingOidcAuthPrompt = (): PendingOidcPrompt | null =>
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
