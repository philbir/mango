import { detected, downloadMeta, useDetectedDownload } from "../components/DownloadButton";
import { platforms } from "../components/icons";
import { Callout, CodeBlock, SectionHeading, ShipGroupCard } from "../components/ui";
import { commands } from "../data/commands";
import { desktopTargets, updateManifestPattern, type AssetSpec, type DesktopTarget } from "../data/downloads";
import { findAsset, formatSize, useLatestRelease, type ReleaseState } from "../data/release";
import { shipGroups } from "../data/shipped";
import { href } from "../router";
import { repoUrl } from "../site";

const shipGroup = (id: string) => shipGroups.find((group) => group.id === id) ?? null;

export const DownloadPage = () => {
  const state = useLatestRelease();

  return (
    <>
      <Hero state={state} />
      <Desktop state={state} />
      <Docker />
      <Aspire />
      <Verify state={state} />
    </>
  );
};

/**
 * One downloadable file. Until the release answers — and if it never does — the
 * row points at the release page instead, which carries every asset. There is
 * no state in which this renders a dead link.
 */
const AssetLink = ({ spec, state }: { spec: AssetSpec; state: ReleaseState }) => {
  const asset = state.status === "ready" ? findAsset(state.release, spec.pattern) : null;

  return (
    <a
      className={spec.primary ? "dl-asset primary" : "dl-asset"}
      href={asset ? asset.url : `${repoUrl}/releases/latest`}
    >
      <span className="dl-asset-label">{spec.label}</span>
      {asset ? <span className="dl-asset-meta">{formatSize(asset.size)}</span> : null}
      {state.status === "unavailable" ? <span className="dl-asset-meta">on GitHub</span> : null}
    </a>
  );
};

const Hero = ({ state }: { state: ReleaseState }) => {
  const { target, asset } = useDetectedDownload(state);
  const Mark = target ? platforms[target.platform].Mark : null;

  return (
    <section className="download-hero" id="top">
      <span className="kicker">Download</span>
      <h1>Get Mango. Free, with every feature.</h1>
      <p className="lead">
        One release, three channels: the <strong>desktop app</strong> for macOS, Windows, and Linux,
        a <strong>Docker image</strong>, and a <strong>.NET Aspire</strong> package. All of it is
        free, forever — the whole bill is itemised on the{" "}
        <a href={href("home", "pricing")}>pricing page</a>.
      </p>
      <div className="hero-actions">
        {target && asset && Mark ? (
          <a className="button primary dl-cta" href={asset.url}>
            <Mark />
            Download for {platforms[target.platform].label}
          </a>
        ) : (
          <a className="button primary" href={`${repoUrl}/releases/latest`}>
            Download the latest release
          </a>
        )}
        <a className="button ghost" href={href("download", "desktop")}>
          All platforms
        </a>
      </div>
      <p className="download-meta">{downloadMeta(state, asset?.name ?? null)}</p>
      <div className="proof-row">
        <span>$0</span>
        <span>No account</span>
        <span>Unlimited connections</span>
        <span>AI included</span>
        <span>macOS</span>
        <span>Windows</span>
        <span>Linux</span>
      </div>
    </section>
  );
};

const DesktopCard = ({ target, state }: { target: DesktopTarget; state: ReleaseState }) => {
  const { label, Mark } = platforms[target.platform];

  return (
    <article className={target.platform === detected ? "dl-card detected" : "dl-card"}>
      <header className="dl-card-head">
        <span className="dl-card-mark" aria-hidden="true">
          <Mark />
        </span>
        <h3>{label}</h3>
        {target.platform === detected ? <span className="dl-card-badge">Your platform</span> : null}
      </header>
      <p>{target.note}</p>
      <div className="dl-assets">
        {target.assets.map((spec) => (
          <AssetLink key={spec.label} spec={spec} state={state} />
        ))}
      </div>
      <p className="dl-detail">{target.detail}</p>
    </article>
  );
};

const Desktop = ({ state }: { state: ReleaseState }) => (
  <section className="section" id="desktop">
    <SectionHeading kicker="Desktop app" title="Mango, as a native application.">
      The full multi-connection workbench with the server compiled in, so there is no runtime to
      install first. Every link below points straight at a file the latest release carries — the
      names are read from the release itself, so they never drift from what is actually published.
    </SectionHeading>
    <div className="dl-grid">
      {desktopTargets.map((target) => (
        <DesktopCard key={target.platform} target={target} state={state} />
      ))}
    </div>
    <Callout title="It keeps itself current">
      The app checks for a new release on start and updates in place from a signed manifest.
      Installing it once is the last visit this page needs.
    </Callout>
  </section>
);

const Docker = () => {
  const group = shipGroup("ship-docker");

  return (
    <section className="section" id="docker">
      <SectionHeading kicker="Docker image" title="Run it next to the database." />
      {group ? (
        <div className="ship-groups">
          <ShipGroupCard group={group} />
        </div>
      ) : null}
      <div className="code-grid section-gap">
        <CodeBlock title="docker run" code={commands.docker} />
        <CodeBlock title="docker-compose.yml" code={commands.compose} />
      </div>
    </section>
  );
};

const Aspire = () => {
  const group = shipGroup("ship-nuget");

  return (
    <section className="section" id="nuget">
      <SectionHeading kicker="Aspire package" title="One line in your AppHost." />
      {group ? (
        <div className="ship-groups">
          <ShipGroupCard group={group} />
        </div>
      ) : null}
      <div className="code-grid section-gap">
        <CodeBlock title="AppHost.cs" code={commands.aspire} />
        <CodeBlock title="Options" code={commands.aspireOptions} />
      </div>
    </section>
  );
};

const Verify = ({ state }: { state: ReleaseState }) => (
  <section className="section" id="verify">
    <SectionHeading kicker="Updates and releases" title="Every build, every version.">
      Stable releases are what this page offers. Pre-releases, older versions, and the release notes
      live on GitHub.
    </SectionHeading>
    <div className="dl-assets row">
      <AssetLink
        spec={{ label: "latest.json — update manifest", pattern: updateManifestPattern }}
        state={state}
      />
      <a className="dl-asset" href={`${repoUrl}/releases`}>
        <span className="dl-asset-label">All releases and notes</span>
      </a>
      <a className="dl-asset" href={`${repoUrl}/pkgs/container/mango`}>
        <span className="dl-asset-label">Container tags</span>
      </a>
    </div>
    <p className="doc-note">
      The macOS bundle is signed and notarised by Apple, so Gatekeeper opens it without a
      right-click. The Windows installers are unsigned today; SmartScreen will warn on first run.
    </p>
  </section>
);
