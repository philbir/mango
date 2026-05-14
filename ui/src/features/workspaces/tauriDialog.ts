/**
 * Best-effort native folder picker. Returns null if not running under Tauri or
 * if the user cancelled. Imports the dialog plugin lazily so a web/Aspire
 * build doesn't fail when the plugin isn't installed.
 */
export const isTauri = (): boolean => {
  if (typeof window === "undefined") return false;
  // Tauri 2 sets __TAURI_INTERNALS__ on the global.
  return "__TAURI_INTERNALS__" in window;
};

export const homeDir = async (): Promise<string | null> => {
  if (!isTauri()) return null;
  try {
    const mod = (await import(
      /* @vite-ignore */ "@tauri-apps/api/path"
    )) as { homeDir: () => Promise<string> };
    return await mod.homeDir();
  } catch {
    return null;
  }
};

export const pickFolder = async (
  defaultPath?: string,
): Promise<string | null> => {
  if (!isTauri()) return null;
  try {
    // Vite externalises this when the plugin isn't installed; we tolerate the
    // import failing and fall back to the manual text input.
    const mod = (await import(
      /* @vite-ignore */ "@tauri-apps/plugin-dialog"
    )) as {
      open: (opts: {
        directory: boolean;
        defaultPath?: string;
      }) => Promise<string | string[] | null>;
    };
    // When the caller didn't supply a starting point, open at $HOME so the
    // user isn't dropped at the OS root or the last-app-cwd (which can be the
    // bundled .app's resource dir).
    const start = defaultPath ?? (await homeDir()) ?? undefined;
    const picked = await mod.open({ directory: true, defaultPath: start });
    if (!picked) return null;
    return Array.isArray(picked) ? picked[0] ?? null : picked;
  } catch {
    return null;
  }
};
