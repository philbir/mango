import React from "react";
import { createRoot } from "react-dom/client";
import {
  IconBolt,
  IconBrandGithub,
  IconBrandOpenai,
  IconBrandWindows,
  IconChevronRight,
  IconCloudCode,
  IconDatabase,
  IconDeviceDesktop,
  IconFileCode,
  IconLock,
  IconPlugConnected,
  IconRocket,
  IconSearch,
  IconSparkles,
  IconTerminal2,
} from "@tabler/icons-react";
import "./styles.css";

const version = import.meta.env.VITE_MANGO_VERSION ?? "v0.1.0";
const repoUrl =
  import.meta.env.VITE_MANGO_REPO_URL ?? "https://github.com/philbir/mango";

type DocSection = {
  id: string;
  title: string;
  eyebrow: string;
  body: string;
};

const docs: DocSection[] = [
  {
    id: "quickstart",
    title: "Quick start",
    eyebrow: "Install",
    body: "Run Mango where your database already lives: next to Aspire, in Docker, or as a desktop app.",
  },
  {
    id: "ai",
    title: "AI features",
    eyebrow: "Schema aware",
    body: "Mango samples collection structure, builds a compact schema prompt, and asks your chosen provider for valid Mongo filters or shell commands.",
  },
  {
    id: "providers",
    title: "AI providers",
    eyebrow: "Bring your model",
    body: "Use GitHub Copilot, Claude Code, OpenAI, Azure OpenAI, GitHub Models, Ollama, or any endpoint that speaks the OpenAI chat API.",
  },
  {
    id: "aspire",
    title: "Aspire integration",
    eyebrow: "One line",
    body: "The Mango.Hosting package attaches the workbench to an Aspire MongoDB resource and forwards the connection string automatically.",
  },
  {
    id: "config",
    title: "Configuration",
    eyebrow: "Production notes",
    body: "Every runtime uses the same server binary and environment model, including encrypted connection storage and provider settings.",
  },
];

const providerCards = [
  {
    name: "GitHub Copilot",
    icon: IconBrandGithub,
    copy: "Use a GitHub token or an existing Copilot CLI session for schema-aware filters and generated Mongo shell expressions.",
    env: "AI_PROVIDER=copilot",
  },
  {
    name: "Claude Code",
    icon: IconCloudCode,
    copy: "Use ANTHROPIC_API_KEY or your local Claude Code login. Mango calls the Claude Agent SDK with a strict one-turn command contract.",
    env: "AI_PROVIDER=claude-code",
  },
  {
    name: "OpenAI compatible",
    icon: IconBrandOpenai,
    copy: "Point Mango at OpenAI, Azure OpenAI, GitHub Models, Ollama, or any compatible /v1 chat completions endpoint.",
    env: "AI_PROVIDER=openai",
  },
];

const features = [
  {
    title: "Natural language to filters",
    icon: IconSparkles,
    text: "Ask for records in plain English, review the proposed EJSON filter, then run it in the document browser.",
  },
  {
    title: "Intellisense for commands",
    icon: IconTerminal2,
    text: "The console knows db methods, collection names, sampled schema fields, and common Mongo command shapes.",
  },
  {
    title: "Fast document workbench",
    icon: IconBolt,
    text: "Browse collections, page through results, inspect nested BSON values, and edit documents without leaving the flow.",
  },
  {
    title: "Multi-connection by design",
    icon: IconDatabase,
    text: "Save multiple MongoDB connections with color labels and encrypted URIs, or lock Mango to one standalone connection.",
  },
  {
    title: "Aspire-native",
    icon: IconPlugConnected,
    text: "Drop Mango into a .NET Aspire AppHost with one extension method and no hand-written connection plumbing.",
  },
  {
    title: "Desktop, Docker, or web",
    icon: IconDeviceDesktop,
    text: "The same Hono server and React UI run as a container, a local web app, or a Tauri desktop bundle.",
  },
];

const commands = {
  aspire: `using Aspire.Hosting;

var builder = DistributedApplication.CreateBuilder(args);

var mongo = builder.AddMongoDB("mongo")
    .WithLifetime(ContainerLifetime.Persistent);

mongo.WithMango();

builder.Build().Run();`,
  docker: `docker run --rm -p 127.0.0.1:5180:5180 \\
  -e MONGO_URL="mongodb://host.docker.internal:27017/app" \\
  -e MANGO_MODE=standalone \\
  -v mango-data:/data \\
  ghcr.io/philbir/mango:latest`,
  aiOpenAi: `AI_PROVIDER=openai
AI_MODEL=gpt-4o-mini
AI_API_KEY=sk-...
AI_BASE_URL=https://api.openai.com/v1`,
  aiCopilot: `AI_PROVIDER=copilot
AI_MODEL=claude-sonnet-4.5
GITHUB_TOKEN=github_pat_...`,
  aiClaude: `AI_PROVIDER=claude-code
AI_MODEL=sonnet
ANTHROPIC_API_KEY=sk-ant-...`,
};

const App = () => (
  <div>
    <SiteNav />
    <main>
      <Hero />
      <FeatureGrid />
      <Screenshots />
      <Docs />
      <FinalCta />
    </main>
  </div>
);

const SiteNav = () => (
  <header className="site-nav">
    <a className="brand" href="#top" aria-label="Mango home">
      <img src="./mango-mark.svg" alt="" />
      <span>Mango</span>
    </a>
    <nav aria-label="Main">
      <a href="#features">Features</a>
      <a href="#ai">AI</a>
      <a href="#aspire">Aspire</a>
      <a href="#docs">Docs</a>
      <a className="nav-cta" href={repoUrl}>
        GitHub
      </a>
    </nav>
  </header>
);

const Hero = () => (
  <section className="hero" id="top">
    <div className="hero-copy">
      <div className="eyebrow">
        <IconRocket size={16} />
        MongoDB workbench with AI-native querying
      </div>
      <h1>Simple, fast, AI-enabled MongoDB workbench.</h1>
      <p className="lead">
        Mango helps you browse collections, write Mongo commands with schema-aware
        intellisense, and turn natural language into precise filters or shell
        expressions using your AI provider.
      </p>
      <div className="hero-actions">
        <a className="button primary" href="#quickstart">
          Start building <IconChevronRight size={17} />
        </a>
        <a className="button ghost" href="#ai">
          See AI features
        </a>
        <a className="button ghost" href={repoUrl}>
          <IconBrandGithub size={17} />
          View code
        </a>
      </div>
      <div className="proof-row">
        <span>AI Assistant</span>
        <span>Aspire</span>
        <span>Docker</span>
        <span>Desktop</span>
      </div>
    </div>
    <div className="hero-visual" aria-label="Mango hero artwork">
      <img
        className="mango-hero-image"
        src="./mango-hero.png"
        alt="Purple Mango database illustration"
      />
    </div>
  </section>
);

const FeatureGrid = () => (
  <section className="section" id="features">
    <div className="section-heading">
      <span className="kicker">Key features</span>
      <h2>Everything you need for daily MongoDB work, without the ceremony.</h2>
      <p>
        Mango is intentionally small: a focused workbench, a typed API, and an AI
        layer that stays close to your schema.
      </p>
    </div>
    <div className="feature-grid">
      {features.map((feature) => (
        <article className="feature-card" key={feature.title}>
          <feature.icon size={22} />
          <h3>{feature.title}</h3>
          <p>{feature.text}</p>
        </article>
      ))}
    </div>
  </section>
);

const Screenshots = () => (
  <section className="section screenshots" id="ai">
    <div className="section-heading">
      <span className="kicker">AI screenshots</span>
      <h2>Ask in plain language. Keep the generated MongoDB visible.</h2>
      <p>
        Mango treats AI as a drafting assistant, not a hidden executor. You see
        the filter or command before it changes what you are looking at.
      </p>
    </div>
    <div className="shot-stack">
      <ScreenshotCard
        label="Natural language filter"
        title="Schema-aware filters for document browsing"
        body="Mango samples field paths and BSON types, then asks the provider for a canonical EJSON filter that can be applied directly."
      >
        <RealScreenshot
          src="./screenshots/mango-ai-filter.png"
          alt="Mango collection query view with the AI filter tab selected"
        />
      </ScreenshotCard>
      <ScreenshotCard
        label="AI command generator"
        title="Mongo shell expressions with intellisense"
        body="Use AI to draft db.collection.method(...) commands, then refine them in a Monaco editor with collection and field completions."
      >
        <RealScreenshot
          src="./screenshots/mango-console-ai.png"
          alt="Mango console with the AI command prompt open"
        />
      </ScreenshotCard>
      <ScreenshotCard
        label="Workbench"
        title="Real collection browsing, paging, and JSON views"
        body="The same focused interface handles query builder flows, table results, JSON inspection, and Mongo shell work."
      >
        <RealScreenshot
          src="./screenshots/mango-collection-view.png"
          alt="Mango collection browser showing department documents"
        />
      </ScreenshotCard>
    </div>
  </section>
);

const ScreenshotCard = ({
  label,
  title,
  body,
  children,
}: {
  label: string;
  title: string;
  body: string;
  children: React.ReactNode;
}) => (
  <article className="screenshot-card">
    <div className="screenshot-copy">
      <span className="kicker">{label}</span>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
    <div className="screenshot-frame">{children}</div>
  </article>
);

const Docs = () => (
  <section className="docs-wrap" id="docs">
    <aside className="docs-sidebar" aria-label="Docs navigation">
      <span className="kicker">Docs</span>
      {docs.map((doc) => (
        <a href={`#${doc.id}`} key={doc.id}>
          {doc.title}
        </a>
      ))}
    </aside>
    <div className="docs-content">
      {docs.map((doc) => (
        <DocBlock key={doc.id} doc={doc} />
      ))}
    </div>
  </section>
);

const DocBlock = ({ doc }: { doc: DocSection }) => {
  if (doc.id === "quickstart") {
    return (
      <section className="doc-block" id={doc.id}>
        <DocHeader doc={doc} />
        <div className="code-grid">
          <CodeBlock title="Aspire AppHost" code={commands.aspire} />
          <CodeBlock title="Docker" code={commands.docker} />
        </div>
      </section>
    );
  }

  if (doc.id === "ai") {
    return (
      <section className="doc-block" id={doc.id}>
        <DocHeader doc={doc} />
        <div className="how-grid">
          <MiniStep icon={IconSearch} title="1. Sample schema">
            Mango samples up to 30 documents for query generation and includes
            field paths, observed types, and safe examples in the prompt.
          </MiniStep>
          <MiniStep icon={IconSparkles} title="2. Generate">
            The provider returns structured tool output: a filter document or a
            db.collection.method(...) expression plus a short explanation.
          </MiniStep>
          <MiniStep icon={IconFileCode} title="3. Review and run">
            You apply the generated filter or edit the command in the console
            before running it against the active connection.
          </MiniStep>
        </div>
        <CodeBlock
          title="Generated filter example"
          code={`Prompt: "active users created in the last 30 days"

{
  "status": "active",
  "createdAt": { "$gte": { "$date": "2026-04-02T00:00:00Z" } }
}`}
        />
      </section>
    );
  }

  if (doc.id === "providers") {
    return (
      <section className="doc-block" id={doc.id}>
        <DocHeader doc={doc} />
        <div className="provider-grid">
          {providerCards.map((provider) => (
            <article className="provider-card" key={provider.name}>
              <provider.icon size={24} />
              <h3>{provider.name}</h3>
              <p>{provider.copy}</p>
              <code>{provider.env}</code>
            </article>
          ))}
        </div>
        <div className="code-grid three">
          <CodeBlock title="OpenAI compatible" code={commands.aiOpenAi} />
          <CodeBlock title="GitHub Copilot" code={commands.aiCopilot} />
          <CodeBlock title="Claude Code" code={commands.aiClaude} />
        </div>
      </section>
    );
  }

  if (doc.id === "aspire") {
    return (
      <section className="doc-block" id={doc.id}>
        <DocHeader doc={doc} />
        <div className="callout">
          <IconPlugConnected size={22} />
          <div>
            <strong>What WithMango() does</strong>
            <p>
              It registers Mango as a JavaScript app, wires the MongoDB
              connection string into MONGO_URL, forwards Mango configuration,
              and starts the same server/UI used by Docker and desktop builds.
            </p>
          </div>
        </div>
        <CodeBlock title="Install" code="dotnet add package Mango.Hosting" />
      </section>
    );
  }

  return (
    <section className="doc-block" id={doc.id}>
      <DocHeader doc={doc} />
      <div className="config-table" role="table" aria-label="Configuration">
        {[
          ["MONGO_URL", "MongoDB connection string for standalone mode."],
          ["MANGO_MODE", "Set standalone to hide the multi-connection manager."],
          ["MANGO_DATA_DIR", "SQLite data directory for connections and settings."],
          ["MANGO_MASTER_KEY", "32-byte AES-GCM key for persistent encrypted secrets."],
          ["AI_PROVIDER", "openai, copilot, or claude-code."],
          ["AI_BASE_URL", "OpenAI-compatible endpoint override."],
        ].map(([key, value]) => (
          <div className="config-row" role="row" key={key}>
            <code role="cell">{key}</code>
            <span role="cell">{value}</span>
          </div>
        ))}
      </div>
      <div className="callout warn">
        <IconLock size={22} />
        <div>
          <strong>Security note</strong>
          <p>
            Mango is a privileged database management tool. Run it locally or
            inside a trusted private network, and set MANGO_MASTER_KEY when
            saved connections must survive restarts.
          </p>
        </div>
      </div>
    </section>
  );
};

const DocHeader = ({ doc }: { doc: DocSection }) => (
  <div className="doc-header">
    <span className="kicker">{doc.eyebrow}</span>
    <h2>{doc.title}</h2>
    <p>{doc.body}</p>
  </div>
);

const MiniStep = ({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof IconBolt;
  title: string;
  children: React.ReactNode;
}) => (
  <article className="mini-step">
    <Icon size={22} />
    <h3>{title}</h3>
    <p>{children}</p>
  </article>
);

const CodeBlock = ({ title, code }: { title: string; code: string }) => (
  <figure className="code-block">
    <figcaption>{title}</figcaption>
    <pre>
      <code>{code}</code>
    </pre>
  </figure>
);

const RealScreenshot = ({ src, alt }: { src: string; alt: string }) => (
  <img className="real-screenshot" src={src} alt={alt} loading="lazy" />
);

const FinalCta = () => (
  <section className="final-cta">
    <div>
      <span className="kicker">Ship it beside your database</span>
      <h2>Give your team a MongoDB workbench they can actually enjoy using.</h2>
      <p>
        Mango keeps setup light, query writing fast, and AI assistance visible
        enough to trust.
      </p>
    </div>
    <a className="button primary" href={repoUrl}>
      View on GitHub <IconChevronRight size={17} />
    </a>
  </section>
);

createRoot(document.getElementById("root")!).render(<App />);
