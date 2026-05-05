import { useCallback, useEffect, useState } from "react";

export interface UpdateInfo {
  version: string;
  current_version: string;
  body: string | null;
}

interface UpdaterState {
  available: UpdateInfo | null;
  checking: boolean;
  installing: boolean;
  error: string | null;
}

// Tauri 2 IPC bridge — injected into the webview by the Tauri runtime.
// Only present when the app is running as a desktop build; absent in
// Docker / Aspire mode so every call is guarded by `isTauri()`.
declare global {
  interface Window {
    __TAURI_INTERNALS__?: {
      invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
    };
  }
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;
}

function invoke<T>(cmd: string): Promise<T> {
  // isTauri() is always checked before calling this helper.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return window.__TAURI_INTERNALS__!.invoke<T>(cmd);
}

export function useUpdater() {
  const [state, setState] = useState<UpdaterState>({
    available: null,
    checking: false,
    installing: false,
    error: null,
  });

  const check = useCallback(async () => {
    if (!isTauri()) return;
    setState((s) => ({ ...s, checking: true, error: null }));
    try {
      const update = await invoke<UpdateInfo | null>("check_for_update");
      setState((s) => ({ ...s, checking: false, available: update }));
    } catch (e) {
      setState((s) => ({ ...s, checking: false, error: String(e) }));
    }
  }, []);

  const install = useCallback(async () => {
    if (!isTauri()) return;
    setState((s) => ({ ...s, installing: true, error: null }));
    try {
      await invoke<void>("install_update");
      // The app restarts automatically — this line is only reached on a
      // no-update race (install_update is a no-op when nothing is available).
      setState((s) => ({ ...s, installing: false }));
    } catch (e) {
      setState((s) => ({ ...s, installing: false, error: String(e) }));
    }
  }, []);

  const dismiss = useCallback(() => {
    setState((s) => ({ ...s, available: null, error: null }));
  }, []);

  // Check once on startup, after a short delay so the app is fully rendered.
  useEffect(() => {
    if (!isTauri()) return;
    const timer = setTimeout(check, 4000);
    return () => clearTimeout(timer);
  }, [check]);

  return { ...state, check, install, dismiss };
}
