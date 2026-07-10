import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type OidcBrowser = "chrome" | "edge" | "firefox" | "safari" | null;

export interface BrowserProfile {
  key: string;
  label: string;
  isDefault: boolean;
}

export interface BrowserOption {
  id: Exclude<OidcBrowser, null>;
  label: string;
  available: boolean;
  supportsProfiles: boolean;
  profiles: BrowserProfile[];
}

export interface BrowserPreference {
  browser: OidcBrowser;
  profile: string | null;
}

const home = os.homedir();

const readUtf8IfExists = (filePath: string): string | null => {
  if (!existsSync(filePath)) return null;
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
};

interface ChromiumProfileRecord {
  name?: string;
  user_name?: string;
}

interface ChromiumLocalState {
  profile?: {
    info_cache?: Record<string, ChromiumProfileRecord>;
  };
}

export const parseChromiumProfiles = (json: string): BrowserProfile[] => {
  try {
    const parsed = JSON.parse(json) as ChromiumLocalState;
    const infoCache = parsed.profile?.info_cache;
    if (!infoCache) return [];
    return Object.entries(infoCache).map(([key, value], index) => {
      const name = value.name?.trim() || key;
      const email = value.user_name?.trim();
      return {
        key,
        label: email ? `${name} (${email})` : name,
        isDefault: index === 0 || key === "Default",
      };
    });
  } catch {
    return [];
  }
};

export const parseFirefoxProfiles = (ini: string): BrowserProfile[] => {
  const lines = ini.split(/\r?\n/);
  const profiles: BrowserProfile[] = [];
  let currentName: string | null = null;
  let isDefault = false;

  const flush = () => {
    if (!currentName) return;
    profiles.push({
      key: currentName,
      label: isDefault ? `${currentName} (Default)` : currentName,
      isDefault,
    });
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("[Profile") && line.endsWith("]")) {
      flush();
      currentName = null;
      isDefault = false;
      continue;
    }
    if (line.startsWith("Name=")) {
      currentName = line.slice("Name=".length).trim() || null;
      continue;
    }
    if (line === "Default=1") {
      isDefault = true;
    }
  }

  flush();
  return profiles;
};

const resolveCommand = (candidates: string[]): string | null => {
  for (const candidate of candidates) {
    if (candidate.includes(path.sep)) {
      if (existsSync(candidate)) return candidate;
      continue;
    }
    const result = spawnSync("which", [candidate], { stdio: "ignore" });
    if (result.status === 0) return candidate;
  }
  return null;
};

const chromiumLocalStatePaths = (browser: "chrome" | "edge"): string[] => {
  if (process.platform === "darwin") {
    return [
      path.join(
        home,
        "Library",
        "Application Support",
        browser === "chrome" ? "Google/Chrome" : "Microsoft Edge",
        "Local State",
      ),
    ];
  }
  if (process.platform === "win32") {
    return [
      path.join(
        process.env.LOCALAPPDATA ?? "",
        browser === "chrome" ? "Google/Chrome/User Data" : "Microsoft/Edge/User Data",
        "Local State",
      ),
    ];
  }
  if (process.platform === "linux") {
    return [
      path.join(
        home,
        ".config",
        browser === "chrome" ? "google-chrome" : "microsoft-edge",
        "Local State",
      ),
      path.join(
        home,
        ".config",
        browser === "chrome" ? "chromium" : "microsoft-edge-beta",
        "Local State",
      ),
    ];
  }
  return [];
};

const firefoxProfilesPaths = (): string[] => {
  if (process.platform === "darwin") {
    return [path.join(home, "Library", "Application Support", "Firefox", "profiles.ini")];
  }
  if (process.platform === "win32") {
    return [path.join(process.env.APPDATA ?? "", "Mozilla", "Firefox", "profiles.ini")];
  }
  if (process.platform === "linux") {
    return [path.join(home, ".mozilla", "firefox", "profiles.ini")];
  }
  return [];
};

const getChromiumProfiles = (browser: "chrome" | "edge"): BrowserProfile[] => {
  for (const filePath of chromiumLocalStatePaths(browser)) {
    const raw = readUtf8IfExists(filePath);
    if (!raw) continue;
    const profiles = parseChromiumProfiles(raw);
    if (profiles.length > 0) return profiles;
  }
  return [];
};

const getFirefoxProfiles = (): BrowserProfile[] => {
  for (const filePath of firefoxProfilesPaths()) {
    const raw = readUtf8IfExists(filePath);
    if (!raw) continue;
    const profiles = parseFirefoxProfiles(raw);
    if (profiles.length > 0) return profiles;
  }
  return [];
};

const resolveBrowserExecutable = (browser: Exclude<OidcBrowser, null>): string | null => {
  switch (browser) {
    case "chrome":
      return resolveCommand(
        process.platform === "darwin"
          ? [
              "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
              "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
              "/Applications/Chromium.app/Contents/MacOS/Chromium",
            ]
          : process.platform === "win32"
            ? [
                path.join(
                  process.env.PROGRAMFILES ?? "",
                  "Google",
                  "Chrome",
                  "Application",
                  "chrome.exe",
                ),
                path.join(
                  process.env["PROGRAMFILES(X86)"] ?? "",
                  "Google",
                  "Chrome",
                  "Application",
                  "chrome.exe",
                ),
                path.join(
                  process.env.LOCALAPPDATA ?? "",
                  "Google",
                  "Chrome",
                  "Application",
                  "chrome.exe",
                ),
              ]
            : ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"],
      );
    case "edge":
      return resolveCommand(
        process.platform === "darwin"
          ? [
              "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
              "/Applications/Microsoft Edge Beta.app/Contents/MacOS/Microsoft Edge Beta",
              "/Applications/Microsoft Edge Dev.app/Contents/MacOS/Microsoft Edge Dev",
              "/Applications/Microsoft Edge Canary.app/Contents/MacOS/Microsoft Edge Canary",
            ]
          : process.platform === "win32"
            ? [
                path.join(
                  process.env.PROGRAMFILES ?? "",
                  "Microsoft",
                  "Edge",
                  "Application",
                  "msedge.exe",
                ),
                path.join(
                  process.env["PROGRAMFILES(X86)"] ?? "",
                  "Microsoft",
                  "Edge",
                  "Application",
                  "msedge.exe",
                ),
              ]
            : [
                "microsoft-edge",
                "microsoft-edge-stable",
                "microsoft-edge-beta",
                "microsoft-edge-dev",
              ],
      );
    case "firefox":
      return resolveCommand(
        process.platform === "darwin"
          ? [
              "/Applications/Firefox.app/Contents/MacOS/firefox",
              "/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox",
              "/Applications/Firefox Nightly.app/Contents/MacOS/firefox",
            ]
          : process.platform === "win32"
            ? [
                path.join(process.env.PROGRAMFILES ?? "", "Mozilla Firefox", "firefox.exe"),
                path.join(
                  process.env["PROGRAMFILES(X86)"] ?? "",
                  "Mozilla Firefox",
                  "firefox.exe",
                ),
              ]
            : ["firefox"],
      );
    case "safari":
      if (process.platform !== "darwin") return null;
      return resolveCommand(["/Applications/Safari.app/Contents/MacOS/Safari"]);
  }
};

const launch = async (command: string, args: string[]): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}: ${stderr.trim() || "(no stderr)"}`));
    });
  });
};

const openWithDefaultBrowser = async (url: string): Promise<void> => {
  if (process.platform === "darwin") return launch("open", [url]);
  if (process.platform === "win32") return launch("explorer.exe", [url]);
  if (process.platform === "linux") return launch("xdg-open", [url]);
  throw new Error(`Unsupported platform: ${process.platform}`);
};

export const listAvailableBrowsers = (): BrowserOption[] => {
  const chromeProfiles = getChromiumProfiles("chrome");
  const edgeProfiles = getChromiumProfiles("edge");
  const firefoxProfiles = getFirefoxProfiles();

  return [
    {
      id: "chrome",
      label: "Google Chrome",
      available: resolveBrowserExecutable("chrome") !== null,
      supportsProfiles: true,
      profiles: chromeProfiles,
    },
    {
      id: "edge",
      label: "Microsoft Edge",
      available: resolveBrowserExecutable("edge") !== null,
      supportsProfiles: true,
      profiles: edgeProfiles,
    },
    {
      id: "firefox",
      label: "Firefox",
      available: resolveBrowserExecutable("firefox") !== null,
      supportsProfiles: true,
      profiles: firefoxProfiles,
    },
    {
      id: "safari",
      label: "Safari",
      available: resolveBrowserExecutable("safari") !== null,
      supportsProfiles: false,
      profiles: [],
    },
  ];
};

const findBrowserOption = (browser: Exclude<OidcBrowser, null>): BrowserOption | null =>
  listAvailableBrowsers().find((entry) => entry.id === browser) ?? null;

export const openUrlInBrowser = async (
  url: string,
  preference: BrowserPreference,
): Promise<void> => {
  if (!preference.browser) {
    await openWithDefaultBrowser(url);
    return;
  }

  const option = findBrowserOption(preference.browser);
  if (!option?.available) {
    throw new Error(`${option?.label ?? preference.browser} is not available on this machine.`);
  }

  const executable = resolveBrowserExecutable(preference.browser);
  if (!executable) {
    throw new Error(`Could not resolve the ${option.label} executable.`);
  }

  if (preference.browser === "safari") {
    await launch("open", ["-a", "Safari", url]);
    return;
  }

  const args: string[] = [];
  if (preference.profile) {
    if (preference.browser === "firefox") {
      const profile = option.profiles.find((entry) => entry.key === preference.profile);
      if (!profile) {
        throw new Error(`Firefox profile "${preference.profile}" is not available.`);
      }
      args.push("-P", profile.key);
    } else {
      const profile = option.profiles.find((entry) => entry.key === preference.profile);
      if (!profile) {
        throw new Error(`${option.label} profile "${preference.profile}" is not available.`);
      }
      args.push(`--profile-directory=${profile.key}`);
    }
  }
  args.push(url);
  await launch(executable, args);
};
