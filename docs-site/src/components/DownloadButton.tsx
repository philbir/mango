import { detectPlatform, desktopTargets } from "../data/downloads";
import { findAsset, useLatestRelease, type ReleaseState } from "../data/release";
import { href } from "../router";
import { repoUrl } from "../site";
import { DownloadArrow, platforms } from "./icons";

/** Read once: the reader's platform cannot change while the page is open. */
export const detected = detectPlatform();

/** The desktop build for this reader's platform, once the release has answered. */
export const useDetectedDownload = (state: ReleaseState) => {
  const target = desktopTargets.find((entry) => entry.platform === detected) ?? null;
  const spec = target?.assets.find((asset) => asset.primary) ?? target?.assets[0];
  const asset = state.status === "ready" && spec ? findAsset(state.release, spec.pattern) : null;
  return { target, asset };
};

/** The line under a download button: which build, how big, and where it came from. */
export const downloadMeta = (state: ReleaseState, assetName: string | null) => {
  if (state.status === "loading") return "Resolving the latest release…";
  if (state.status === "unavailable") {
    return "GitHub did not answer just now — the release page carries every build.";
  }
  return assetName
    ? `Mango ${state.release.tag} · ${assetName}`
    : `Latest release ${state.release.tag} · macOS, Windows, and Linux`;
};

/**
 * The one-click download: a direct link to this platform's installer when the
 * release names it, the download page otherwise. Never a dead link — until the
 * release answers it points at the page that lists every build.
 */
export const DownloadButton = ({ withMeta = true }: { withMeta?: boolean }) => {
  const state = useLatestRelease();
  const { target, asset } = useDetectedDownload(state);
  const Mark = target ? platforms[target.platform].Mark : null;

  return (
    <div className="download-cta">
      <div className="hero-actions">
        {target && asset && Mark ? (
          <a className="button primary dl-cta" href={asset.url}>
            <Mark />
            Download for {platforms[target.platform].label}
          </a>
        ) : (
          <a className="button primary dl-cta" href={href("download")}>
            <DownloadArrow />
            Download Mango
          </a>
        )}
        <a className="button ghost" href={href("download")}>
          All platforms
        </a>
      </div>
      {withMeta ? (
        <p className="download-meta">
          {downloadMeta(state, asset?.name ?? null)}
          {state.status === "unavailable" ? (
            <>
              {" "}
              <a href={`${repoUrl}/releases/latest`}>Open releases</a>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
};
