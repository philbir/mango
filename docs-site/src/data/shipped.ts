import type { ChannelId, MarkId, PlatformId } from "../components/icons";
import { href } from "../router";
import { repoUrl } from "../site";

export type ShipLink = { label: string; href: string };

export type ShipItem = {
  name: string;
  /** Which part of Mango the artifact carries, when the name doesn't say it. */
  product?: string;
  note: string;
  /** Leading mark, for a row that already names its platform or its host. */
  mark?: MarkId;
  /** Platform chips, in reading order. */
  platforms?: PlatformId[];
  /** Chips beyond the platforms — what else runs this artifact for you. */
  badges?: MarkId[];
  /** File extensions the artifact arrives as. */
  formats?: string[];
  /** One command that gets it. */
  cmd?: string;
  link?: ShipLink;
};

export type ShipGroup = {
  id: string;
  channel: ChannelId;
  title: string;
  blurb: string;
  /** Where the artifacts are published, when the whole group shares one place. */
  source?: ShipLink & { channel: ChannelId };
  /** How to install it, in prose docs. */
  install?: ShipLink;
  items: ShipItem[];
  /** Commands that belong to the group rather than to one item. */
  cmds?: string[];
  note?: string;
  /** Mark shown against the note, when the note is about one particular host. */
  noteMark?: MarkId;
};

/**
 * Everything Mango publishes, grouped by the shape it arrives in. The desktop
 * bundles come from `.github/workflows/desktop-build.yml`, the image from
 * `docker-publish.yml`, and the package from `nuget-publish.yml` — keep this in
 * step with those, it is the reader-facing copy of what they actually publish.
 */
export const shipGroups: ShipGroup[] = [
  {
    id: "ship-desktop",
    channel: "desktop",
    title: "Desktop app",
    blurb:
      "The full multi-connection workbench as a native application. The server is compiled into the app, so there is no Node, Docker, or runtime to install first.",
    source: { channel: "github", label: "GitHub Releases", href: `${repoUrl}/releases/latest` },
    install: { label: "Read the desktop guide", href: href("guide", "desktop") },
    items: [
      {
        name: "macOS",
        mark: "macos",
        formats: [".dmg", ".app"],
        note: "Apple silicon build, signed and notarised. Intel Macs run it under Rosetta.",
        link: { label: "Download", href: href("download", "desktop") },
      },
      {
        name: "Windows",
        mark: "windows",
        formats: [".msi", "setup.exe"],
        note: "An MSI installer and an NSIS setup executable, x64. Pre-release builds ship NSIS only.",
        link: { label: "Download", href: href("download", "desktop") },
      },
      {
        name: "Linux",
        mark: "linux",
        formats: [".deb"],
        note: "A Debian package for x64 — Ubuntu, Debian, and derivatives.",
        link: { label: "Download", href: href("download", "desktop") },
      },
    ],
    note: "Every desktop build updates itself in place from a signed manifest.",
  },
  {
    id: "ship-docker",
    channel: "docker",
    title: "Docker image",
    blurb:
      "One image for a dev box, a homelab, or a cluster — env-driven configuration, state in a volume, and the MongoDB Database Tools baked in for import, export, dump, and restore.",
    source: {
      channel: "github",
      label: "GitHub Container Registry",
      href: `${repoUrl}/pkgs/container/mango`,
    },
    install: { label: "Read the Docker guide", href: href("guide", "docker") },
    items: [
      {
        name: "ghcr.io/philbir/mango",
        note: "Serves the UI and the API on port 5180. Standalone mode pins it to one database from MONGO_URL.",
        platforms: ["linux"],
        cmd: "docker pull ghcr.io/philbir/mango:latest",
      },
    ],
  },
  {
    id: "ship-nuget",
    channel: "nuget",
    title: "Aspire package",
    blurb:
      "A .NET Aspire hosting integration. One extension method on your MongoDB resource adds Mango to the AppHost, already pointed at the database.",
    source: {
      channel: "nuget",
      label: "nuget.org",
      href: "https://www.nuget.org/packages/Mango.Aspire.Hosting",
    },
    install: { label: "Read the Aspire guide", href: href("guide", "aspire") },
    items: [
      {
        name: "Mango.Aspire.Hosting",
        note: "Adds WithMango() to IResourceBuilder<MongoDBServerResource>. Runs the published container next to your Mongo.",
        badges: ["aspire"],
        cmd: "dotnet add package Mango.Aspire.Hosting",
      },
    ],
  },
];
