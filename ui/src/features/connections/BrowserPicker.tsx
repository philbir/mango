import { IconDeviceDesktop } from "@tabler/icons-react";
import type { BrowserOption, OidcBrowser } from "../../api/client";

const BROWSER_LABELS: Record<Exclude<OidcBrowser, null>, string> = {
  chrome: "Google Chrome",
  edge: "Microsoft Edge",
  firefox: "Firefox",
  safari: "Safari",
};

interface Props {
  browsers: BrowserOption[];
  browser: OidcBrowser;
  browserProfile: string;
  onBrowserChange: (browser: OidcBrowser) => void;
  onBrowserProfileChange: (profile: string) => void;
  includeSystemDefault?: boolean;
}

export const BrowserPicker = ({
  browsers,
  browser,
  browserProfile,
  onBrowserChange,
  onBrowserProfileChange,
  includeSystemDefault = false,
}: Props) => {
  const selectedBrowser =
    browser ? browsers.find((entry) => entry.id === browser) ?? null : null;
  const selectedProfiles = selectedBrowser?.profiles ?? [];
  const missingSelectedProfile =
    browserProfile.trim() &&
    selectedBrowser?.supportsProfiles &&
    !selectedProfiles.some((profile) => profile.key === browserProfile.trim());

  const availableBrowsers = browsers.filter((entry) => entry.available);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {includeSystemDefault && (
          <BrowserButton
            active={browser === null}
            disabled={false}
            label="System default"
            icon={
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">
                <IconDeviceDesktop size={18} className="text-slate-500 dark:text-slate-300" />
              </div>
            }
            onClick={() => {
              onBrowserChange(null);
              onBrowserProfileChange("");
            }}
          />
        )}
        {availableBrowsers.map((entry) => (
          <BrowserButton
            key={entry.id}
            active={browser === entry.id}
            disabled={false}
            label={entry.label}
            icon={
              <img
                src={`/assets/browser/${entry.id}.svg`}
                alt=""
                className="h-9 w-9 rounded-lg bg-white object-contain p-1 dark:bg-slate-800"
                draggable={false}
              />
            }
            onClick={() => {
              onBrowserChange(entry.id);
              if (!entry.supportsProfiles) onBrowserProfileChange("");
            }}
          />
        ))}
      </div>

      {selectedBrowser?.supportsProfiles && (
        <div className="space-y-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Profiles
          </div>
          <div className="flex flex-wrap gap-2">
            <ProfileButton
              active={browserProfile === ""}
              onClick={() => onBrowserProfileChange("")}
            >
              Default profile
            </ProfileButton>
            {selectedProfiles.map((profile) => (
              <ProfileButton
                key={profile.key}
                active={browserProfile === profile.key}
                onClick={() => onBrowserProfileChange(profile.key)}
              >
                {profile.label}
              </ProfileButton>
            ))}
            {missingSelectedProfile && (
              <ProfileButton active onClick={() => onBrowserProfileChange(browserProfile)}>
                {browserProfile} (unavailable)
              </ProfileButton>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const BrowserButton = ({
  active,
  disabled,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={[
      "flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border p-2 text-center transition",
      active
        ? "border-sky-500 bg-sky-50 dark:bg-sky-500/10"
        : "border-slate-300 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:hover:bg-slate-900",
      disabled ? "cursor-not-allowed opacity-50" : "",
    ].join(" ")}
  >
    {icon}
    <div className="w-full truncate text-xs font-medium text-slate-900 dark:text-slate-100">{label}</div>
  </button>
);

const ProfileButton = ({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={[
      "rounded-full border px-3 py-1.5 text-xs",
      active
        ? "border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300"
        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900",
    ].join(" ")}
  >
    {children}
  </button>
);

export const labelForOidcBrowser = (browser: OidcBrowser): string =>
  browser ? BROWSER_LABELS[browser] : "System default";
