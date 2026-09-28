import type { PlatformId } from "../components/icons";

/**
 * What the download page offers, and how each row finds itself in a release.
 *
 * Every pattern matches an asset name `.github/workflows/desktop-build.yml`
 * actually uploads (tauri-action names them `Mango_<version>_<arch>.<ext>`).
 * Change a name there and the matching pattern has to move with it.
 */
export type AssetSpec = {
  label: string;
  /** Matched against the release asset name. */
  pattern: RegExp;
  /** The one to offer first for this platform. */
  primary?: boolean;
};

export type DesktopTarget = {
  platform: PlatformId;
  /** What the reader needs to know before clicking. */
  note: string;
  /** Requirement or caveat, shown under the note. */
  detail: string;
  assets: AssetSpec[];
};

/** The desktop app. One card per platform. */
export const desktopTargets: DesktopTarget[] = [
  {
    platform: "macos",
    note: "Apple silicon build, signed and notarised.",
    detail: "Intel Macs run it under Rosetta. The .app archive is what the updater consumes.",
    assets: [
      { label: "Disk image (.dmg)", pattern: /_aarch64\.dmg$/, primary: true },
      { label: "App archive (.app.tar.gz)", pattern: /_aarch64\.app\.tar\.gz$/ },
    ],
  },
  {
    platform: "windows",
    note: "x64, as an MSI or an NSIS setup executable.",
    detail: "Either installs the same app; pre-release builds ship the NSIS setup only.",
    assets: [
      { label: "Installer (.msi)", pattern: /_x64_en-US\.msi$/, primary: true },
      { label: "Setup (.exe)", pattern: /_x64-setup\.exe$/ },
    ],
  },
  {
    platform: "linux",
    note: "A Debian package for x64.",
    detail: "Ubuntu, Debian, and derivatives. Install with apt: sudo apt install ./<file>.deb",
    assets: [{ label: "Debian package (.deb)", pattern: /_amd64\.deb$/, primary: true }],
  },
];

/** The signed manifest the desktop updater polls. */
export const updateManifestPattern = /^latest\.json$/;

/**
 * The platform to offer first. Deliberately a hint rather than a gate: every
 * platform stays one scroll away, and an unrecognised agent simply gets none.
 */
export const detectPlatform = (): PlatformId | null => {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  // Android and iOS both carry a desktop-looking token; neither has a build.
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return null;
  if (/Mac|Darwin/i.test(ua)) return "macos";
  if (/Win/i.test(ua)) return "windows";
  if (/Linux|X11|CrOS/i.test(ua)) return "linux";
  return null;
};
