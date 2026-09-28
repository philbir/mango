import { AspireMark, DesktopMark, DockerMark } from "../components/icons";
import {
  Callout,
  CodeBlock,
  ConfigTable,
  DocList,
  ModeGrid,
  SectionHeading,
  type DocSection,
} from "../components/ui";
import { commands } from "../data/commands";
import { href } from "../router";

const runModes = [
  {
    Mark: DesktopMark,
    title: "Desktop",
    when: "Your local workbench across every database you touch.",
    text: "A native app for macOS, Windows, and Linux with the server compiled in. Multi-connection, workspaces enabled, updates itself.",
    link: href("guide", "desktop"),
  },
  {
    Mark: AspireMark,
    title: "Aspire",
    when: "You build on .NET Aspire and want Mango beside your Mongo.",
    text: "One call — mongo.WithMango() — adds the Mango container to the AppHost with the connection string already wired in.",
    link: href("guide", "aspire"),
  },
  {
    Mark: DockerMark,
    title: "Docker",
    when: "A shared dev box, a homelab, or a cluster.",
    text: "One image, configured by environment, with state in a volume and the MongoDB Database Tools included.",
    link: href("guide", "docker"),
  },
];

const docs: DocSection[] = [
  {
    id: "desktop",
    eyebrow: "Install",
    title: "Desktop app",
    body: "Download the installer for your platform and run it. The server is a self-contained binary inside the app, so there is nothing else to install.",
    content: () => (
      <>
        <ModeGrid
          items={[
            ["Updates in place", "The app checks GitHub Releases on start and offers Install & Restart when a newer version is out. Updates are verified against a signing key before they install."],
            ["Your data, your app folder", "Connections, AI settings, workspaces, and UI preferences live as JSON files in the OS app-data folder. The encryption key is generated there on first run."],
            ["Workspaces enabled", "The desktop server shares your filesystem, so workspaces use the native folder picker."],
            ["Logs one click away", "Open logs from the app when something needs a closer look."],
          ]}
        />
        <p className="ships-more">
          <a className="button primary" href={href("download", "desktop")}>
            Download the desktop app
          </a>
        </p>
        <div className="section-gap">
          <CodeBlock title="Or build it yourself" code={commands.buildDesktop} />
        </div>
      </>
    ),
  },
  {
    id: "aspire",
    eyebrow: "One line",
    title: "Aspire integration",
    body: "The Mango.Aspire.Hosting package adds WithMango() to a MongoDB resource. It runs the published Mango container next to your database and hands it the connection string — no hand-written plumbing.",
    content: () => (
      <>
        <div className="code-grid">
          <CodeBlock title="AppHost.cs" code={commands.aspire} />
          <CodeBlock title="Install" code={commands.aspireInstall} />
        </div>
        <Callout title="What WithMango() does">
          It adds a container resource for <code>ghcr.io/philbir/mango</code>, sets{" "}
          <code>MONGO_URL</code> from the Mongo resource's connection string (Aspire rewrites the
          host to the container's network alias), runs in standalone mode, persists state in a named
          volume at <code>/data</code>, and forwards <code>Mango:MasterKey</code> and{" "}
          <code>Mango:Ai:*</code> configuration as environment variables.
        </Callout>
        <div className="code-grid section-gap">
          <CodeBlock title="Options" code={commands.aspireOptions} />
          <CodeBlock title="appsettings.json (AppHost)" code={commands.aspireConfig} />
        </div>
      </>
    ),
  },
  {
    id: "docker",
    eyebrow: "Container",
    title: "Docker",
    body: "The image serves the UI and the API on port 5180 and keeps its state in /data. Bind it to 127.0.0.1 unless you have put authentication in front of it.",
    content: () => (
      <div className="code-grid">
        <CodeBlock title="docker run" code={commands.docker} />
        <CodeBlock title="docker-compose.yml" code={commands.compose} />
      </div>
    ),
  },
  {
    id: "standalone",
    eyebrow: "Run modes",
    title: "Standalone vs multi-connection",
    body: "MANGO_MODE decides whether Mango is a workbench for many databases or a window onto one.",
    content: () => (
      <ModeGrid
        items={[
          ["multi (default)", "The connection manager is shown and connections are saved, encrypted, in connections.json. If none exist and MONGO_URL is set, a Default connection is created from it on first boot."],
          ["standalone", "Set MANGO_MODE=standalone with MONGO_URL. Mango pins one connection from the environment on every boot, hides the connection manager, and refuses to add, edit, or delete connections. Aspire uses this mode by default."],
        ]}
      />
    ),
  },
  {
    id: "config",
    eyebrow: "Reference",
    title: "Configuration",
    body: "Every run mode reads the same environment variables.",
    content: () => (
      <ConfigTable
        label="Server configuration"
        rows={[
          ["MONGO_URL", "MongoDB connection string. Required in standalone mode."],
          ["MONGO_DB", "Default database, overriding the one in the URI."],
          ["MANGO_MODE", "standalone, or unset for multi-connection."],
          ["MANGO_DATA_DIR", "Where the JSON state lives. ./.mango/ in dev, /data in Docker, OS app-data on the desktop."],
          ["MANGO_MASTER_KEY", "32-byte AES-256-GCM key (base64 or hex) for secrets at rest. Set it anywhere state must survive a restart."],
          ["PORT", "Server port. Default 5180."],
          ["HOST / MANGO_HOST", "Bind address. Default 127.0.0.1."],
          ["MANGO_CORS_ORIGINS", "Extra browser origins allowed to call the API, comma-separated."],
          ["MANGO_MONGO_MAX_TIME_MS", "Timeout for queries and commands. Default 10000."],
          ["MANGO_DISABLE_JS_CONSOLE", "true removes the JavaScript console."],
          ["MANGO_DEV_MODE", "true adds Clear all collections and Delete database to the database view."],
        ]}
      />
    ),
  },
  {
    id: "ai-config",
    eyebrow: "Reference",
    title: "AI configuration",
    body: "The assistant can be configured in the UI (Settings → Configure provider) or through the environment. Settings saved in the UI are encrypted and take precedence.",
    content: () => (
      <>
        <ConfigTable
          label="AI configuration"
          rows={[
            ["AI_PROVIDER", "openai, copilot, claude-code, or codex."],
            ["AI_MODEL", "Model id; leave unset to use the provider's default."],
            ["AI_API_KEY", "Key for the openai provider (OpenAI, Azure, GitHub Models, Ollama)."],
            ["AI_BASE_URL", "Endpoint for the openai provider."],
            ["MANGO_COPILOT_CLI", "Path to the copilot CLI when it isn't on PATH."],
            ["MANGO_CLAUDE_CLI", "Path to the claude CLI when it isn't on PATH."],
            ["MANGO_CODEX_CLI", "Path to the codex CLI when it isn't on PATH."],
          ]}
        />
        <p className="doc-note">
          Provider details and examples are on the <a href={href("ai", "providers")}>Mango AI</a>{" "}
          page.
        </p>
      </>
    ),
  },
  {
    id: "storage",
    eyebrow: "State",
    title: "Storage and encryption",
    body: "There is no database behind Mango — just a few human-readable JSON files in MANGO_DATA_DIR, written atomically.",
    content: () => (
      <>
        <ConfigTable
          label="State files"
          rows={[
            ["connections.json", "Names, colours, default databases — and URIs encrypted with AES-256-GCM."],
            ["ai-settings.json", "The provider choice, with the API key encrypted."],
            ["workspaces.json", "Registered workspace folders."],
            ["ui-settings.json", "Desktop only: theme and preferences, so they survive a WebView cache clear."],
          ]}
        />
        <div className="code-grid section-gap">
          <CodeBlock title="Generate a master key" code={commands.masterKey} />
          <Callout title="No key, no memory">
            Without MANGO_MASTER_KEY the server warns and uses an ephemeral key, so saved secrets
            can't be read after a restart. Mango notices, shows a banner, and offers to reset the
            unreadable entries. The desktop app generates and keeps its own key.
          </Callout>
        </div>
      </>
    ),
  },
  {
    id: "telemetry",
    eyebrow: "Observability",
    title: "OpenTelemetry",
    body: "Telemetry is opt-in and goes only where you point it. Without an endpoint, the SDK never starts.",
    content: () => (
      <ConfigTable
        label="OpenTelemetry"
        rows={[
          ["OTEL_EXPORTER_OTLP_ENDPOINT", "OTLP/gRPC endpoint. When set, the server exports traces, metrics, and logs — HTTP, fetch, and MongoDB driver calls are auto-instrumented."],
          ["OTEL_SERVICE_NAME", "Service name in your backend. Default mango-server."],
        ]}
      />
    ),
  },
  {
    id: "security",
    eyebrow: "Trust",
    title: "Security",
    body: "Mango is a privileged database tool with no built-in user authentication. Treat it like the database it points at.",
    content: () => (
      <>
        <Callout tone="warning" title="Keep it local or private">
          Run Mango on your own machine or inside a trusted private network. The server binds to
          127.0.0.1 by default. If you need remote access, put it behind an authenticating reverse
          proxy with TLS and an allowlist — never expose it directly to the internet.
        </Callout>
        <ModeGrid
          gap
          items={[
            ["Least privilege", "Give Mango a database user with the roles the job needs. A read-only user makes a read-only Mango."],
            ["Lock down scripting", "MANGO_DISABLE_JS_CONSOLE=true removes the JavaScript console for shared deployments."],
            ["Secrets at rest", "Set MANGO_MASTER_KEY from your secret store so connection strings stay encrypted and survive restarts."],
            ["Standalone for shared installs", "Standalone mode pins the connection from the environment and disables adding, editing, and revealing connections in the UI."],
          ]}
        />
      </>
    ),
  },
];

export const GuidePage = () => (
  <>
    <section className="product-hero single" id="run-modes">
      <div className="product-hero-copy">
        <span className="kicker product-eyebrow">
          <span className="product-index large">03</span> Guide
        </span>
        <h1>Run Mango wherever your database lives.</h1>
        <p className="lead">
          The same server and the same UI ship three ways. Pick the one that matches how you already
          work — you can use more than one.
        </p>
      </div>
    </section>

    <section className="section">
      <SectionHeading kicker="Run modes" title="Desktop, Aspire, or Docker." />
      <div className="runmode-grid">
        {runModes.map(({ Mark, title, when, text, link }) => (
          <a className="runmode-card" href={link} key={title}>
            <span className="runmode-mark" aria-hidden="true">
              <Mark />
            </span>
            <h3>{title}</h3>
            <strong>{when}</strong>
            <p>{text}</p>
            <span className="text-link">Set it up</span>
          </a>
        ))}
      </div>
    </section>

    <section className="docs-wrap">
      <DocList docs={docs} />
    </section>
  </>
);
