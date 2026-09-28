export const version = import.meta.env.VITE_MANGO_VERSION ?? "v0.1.0";
export const repoUrl = import.meta.env.VITE_MANGO_REPO_URL ?? "https://github.com/philbir/mango";

export type PageId = "home" | "features" | "ai" | "guide" | "download";

export type NavItem = {
  /** Section id on the page. Empty means the top of the page. */
  id: string;
  label: string;
};

export type PageMeta = {
  id: PageId;
  /** Label in the header switcher. */
  name: string;
  /** Switcher label once the header runs out of room. */
  shortName: string;
  /** One line under the switcher label. */
  tagline: string;
  /** Document title for this page. */
  title: string;
  /** Heading above the section list in the rail. */
  navLabel: string;
  nav: NavItem[];
};

/** The doc pages, in the order the header switcher lists them. */
export const switcherOrder: PageId[] = ["features", "ai", "guide"];

export const pages: Record<PageId, PageMeta> = {
  home: {
    id: "home",
    name: "Mango",
    shortName: "Mango",
    tagline: "MongoDB workbench",
    title: "Mango — the AI-native MongoDB workbench",
    navLabel: "Overview",
    nav: [
      { id: "", label: "Overview" },
      { id: "tour", label: "A quick tour" },
      { id: "promise", label: "The promise" },
      { id: "highlights", label: "What that buys you" },
      { id: "paywall", label: "The licence you skip" },
      { id: "pricing", label: "One plan" },
      { id: "included", label: "What's included" },
      { id: "ships", label: "What ships" },
      { id: "principles", label: "Principles" },
      { id: "start", label: "Get started" },
    ],
  },
  features: {
    id: "features",
    name: "Workbench",
    shortName: "Features",
    tagline: "Browse, query, edit",
    title: "Mango Workbench — browse, query, and edit MongoDB",
    navLabel: "Workbench docs",
    nav: [
      { id: "", label: "Overview" },
      { id: "browser", label: "Collection browser" },
      { id: "query-builder", label: "Query builder" },
      { id: "documents", label: "Editing documents" },
      { id: "batch", label: "Batch operations" },
      { id: "console", label: "JavaScript console" },
      { id: "shell", label: "Command shell" },
      { id: "workspaces", label: "Workspaces" },
      { id: "notebooks", label: "Notebooks" },
      { id: "indexes", label: "Indexes and explain" },
      { id: "stats", label: "Database stats" },
      { id: "import-export", label: "Import, export, dump" },
      { id: "gridfs", label: "GridFS" },
      { id: "connections", label: "Connections" },
      { id: "auth", label: "Authentication" },
      { id: "preferences", label: "Formats and preferences" },
      { id: "shortcuts", label: "Keyboard shortcuts" },
    ],
  },
  ai: {
    id: "ai",
    name: "Mango AI",
    shortName: "AI",
    tagline: "Schema-aware assistant",
    title: "Mango AI — a schema-aware assistant for MongoDB",
    navLabel: "AI docs",
    nav: [
      { id: "", label: "Overview" },
      { id: "assistant", label: "The assistant" },
      { id: "filters", label: "Natural language filters" },
      { id: "commands", label: "Commands and pipelines" },
      { id: "optimize", label: "Index advice" },
      { id: "how", label: "How it works" },
      { id: "providers", label: "Providers" },
      { id: "provider-config", label: "Configuring a provider" },
      { id: "privacy", label: "What the model sees" },
    ],
  },
  guide: {
    id: "guide",
    name: "Guide",
    shortName: "Guide",
    tagline: "Install + configure",
    title: "Mango Guide — run Mango on the desktop, in Aspire, or in Docker",
    navLabel: "Guide",
    nav: [
      { id: "", label: "Overview" },
      { id: "run-modes", label: "Run modes" },
      { id: "desktop", label: "Desktop app" },
      { id: "aspire", label: "Aspire integration" },
      { id: "docker", label: "Docker" },
      { id: "standalone", label: "Standalone vs multi" },
      { id: "config", label: "Configuration" },
      { id: "ai-config", label: "AI configuration" },
      { id: "storage", label: "Storage and encryption" },
      { id: "telemetry", label: "OpenTelemetry" },
      { id: "security", label: "Security" },
    ],
  },
  download: {
    id: "download",
    name: "Download",
    shortName: "Download",
    tagline: "Every channel",
    title: "Download Mango — desktop app, Docker image, and Aspire package",
    navLabel: "Download",
    nav: [
      { id: "", label: "Overview" },
      { id: "desktop", label: "Desktop app" },
      { id: "docker", label: "Docker image" },
      { id: "nuget", label: "Aspire package" },
      { id: "verify", label: "Updates and releases" },
    ],
  },
};

/**
 * Anchors from the previous one-page site. Everything used to live under a bare
 * `#section-id`; those links are in the README and other people's bookmarks, so
 * they are mapped onto the page that now owns the section.
 */
export const legacyAnchors: Record<string, string> = {
  top: "/home",
  features: "/features",
  quickstart: "/guide/run-modes",
  docs: "/guide",
  ai: "/ai",
  providers: "/ai/providers",
  aspire: "/guide/aspire",
  workspaces: "/features/workspaces",
  config: "/guide/config",
};
