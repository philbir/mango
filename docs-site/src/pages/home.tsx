import { DownloadButton } from "../components/DownloadButton";
import { FeatureGrid, SectionHeading, ShipGroupCard, ShotFeature } from "../components/ui";
import type { Feature } from "../data/features";
import { shipGroups } from "../data/shipped";
import { href } from "../router";
import { repoUrl } from "../site";

const principles: Feature[] = [
  {
    title: "Local-first, no account",
    text: "Mango runs on your machine or next to your database. No cloud workspace, no sign-up, no telemetry, and nothing that phones home to count seats.",
    glyph: "L",
  },
  {
    title: "AI you can read before it runs",
    text: "The assistant drafts filters, pipelines, and commands in the open. You see the EJSON or the shell code, and nothing touches your data until you press Apply or Run.",
    glyph: "A",
  },
  {
    title: "Plain text, in your repo",
    text: "Saved queries, console scripts, and notebooks are Markdown files in a folder you choose. They diff, review, and branch like the rest of your code.",
    glyph: "T",
  },
  {
    title: "Secrets encrypted at rest",
    text: "Connection strings and AI keys are sealed with AES-256-GCM before they touch disk. OIDC tokens come from the sign-in you already have, not a copied password.",
    glyph: "S",
  },
];

/** The things that tend to live behind a paid tier elsewhere. All included here. */
const included: [string, string][] = [
  ["Unlimited connections", "Save as many as you like, colour-coded, encrypted at rest."],
  ["AI assistant", "Schema-aware chat in every view — on the provider you already use."],
  ["Natural language filters", "Plain English in, a canonical EJSON filter out, one click to apply."],
  ["AI command generation", "Aggregations and shell commands drafted straight into the console."],
  ["AI index advice", "Explain output plus your indexes, turned into concrete recommendations."],
  ["Visual query builder", "AND/OR conditions with schema-aware field suggestions."],
  ["JavaScript console", "Variables, loops, and multi-statement scripts, mongosh-style."],
  ["IntelliSense", "Collections, methods, fields, and operators, completed as you type."],
  ["Document editing", "Diffed $set/$unset updates or full replaces, previewed first."],
  ["Batch update and delete", "Select across pages, preview the count, then run."],
  ["Workspaces", "Queries and notebooks as Markdown, with the Git branch in view."],
  ["Index management", "Usage stats, create, drop, and an explain-plan playground."],
  ["Import, export, dump, restore", "JSON and mongodump archives, straight from the UI."],
  ["GridFS browser", "Preview images, text, and PDFs; download or delete files."],
  ["OIDC and Microsoft Entra", "MONGODB-OIDC through Azure CLI or an interactive browser sign-in."],
  ["Atlas, replica sets, TLS", "SRV, replica sets, SCRAM, and TLS from a form or a raw URI."],
  ["Docker and Aspire discovery", "Find running Mongo containers and AppHost resources."],
  ["Aspire integration", "One line in your AppHost: mongo.WithMango()."],
  ["OpenTelemetry", "Traces, metrics, and logs to the Aspire dashboard or any OTLP collector."],
  ["Desktop app", "macOS, Windows, and Linux — self-updating."],
];

const highlights: { title: string; text: string; chips: string[] }[] = [
  {
    title: "AI without a second subscription",
    text: "Mango's assistant runs on the AI you already have. Point it at the GitHub Copilot CLI, Claude Code, or OpenAI Codex you are signed in to, any OpenAI-compatible endpoint — OpenAI, Azure OpenAI, GitHub Models — or a local model through Ollama. There is no AI seat to buy from us, no tokens billed through a middleman, and nothing leaves your machine except what your own provider receives.",
    chips: ["GitHub Copilot", "Claude Code", "OpenAI Codex", "Azure OpenAI", "Ollama"],
  },
  {
    title: "Every MongoDB you touch, one workbench",
    text: "Local containers, Atlas clusters, replica sets, and corporate databases behind Microsoft Entra all sit in one picker, each with its own colour so production never looks like dev. There is no connection limit, because there is no plan to upsell.",
    chips: ["Unlimited connections", "Atlas / SRV", "OIDC", "Entra ID", "TLS"],
  },
  {
    title: "Wherever your database lives",
    text: "Install the desktop app, drop one line into a .NET Aspire AppHost, or run the Docker image next to the database. It is the same server and the same UI in all three, so a query you save on your laptop means the same thing everywhere.",
    chips: ["Desktop", "Aspire", "Docker", "Standalone mode"],
  },
];

export const HomePage = () => (
  <>
    <Hero />
    <Tour />
    <Promise />
    <Highlights />
    <Paywall />
    <Pricing />
    <Included />
    <Ships />
    <Principles />
    <FinalCta />
  </>
);

const Hero = () => (
  <section className="hero" id="top">
    <div className="hero-copy">
      <div className="eyebrow">
        <span className="spark" />
        Free forever · every feature · unlimited connections
      </div>
      <h1>Mango. The AI-native MongoDB workbench.</h1>
      <p className="lead">
        Browse collections, edit documents, script the console, and ask for data in plain language.
        <strong> Mango</strong> reads your schema, drafts the filter, pipeline, or index you meant,
        and shows it to you before anything runs — on the AI provider you already use.
      </p>
      <DownloadButton />
      <div className="proof-row">
        <span>$0</span>
        <span>No account</span>
        <span>No seats</span>
        <span>MIT</span>
        <span>macOS</span>
        <span>Windows</span>
        <span>Linux</span>
        <span>Docker</span>
        <span>Aspire</span>
      </div>
    </div>
    <div className="hero-visual hero-shot">
      <a className="shot-feature-frame" href="./screenshots/mango-assistant-filter.png">
        <img
          src="./screenshots/mango-assistant-filter.png"
          alt="Mango's assistant turning a plain-English request into an EJSON filter applied to the orders collection"
        />
      </a>
    </div>
  </section>
);

const Tour = () => (
  <section className="section" id="tour">
    <SectionHeading kicker="A quick tour" title="Ask for the data. Keep the MongoDB visible.">
      Mango treats AI as a drafting partner, not a hidden executor. Every answer arrives as the
      filter, pipeline, or command it would run, with an Apply button beside it — and everything
      else a daily MongoDB tool needs sits one tab away.
    </SectionHeading>
    <div className="shot-stack">
      <ShotFeature
        kicker="Three ways to ask"
        title="Type it, click it, or say it."
        src="./screenshots/mango-query-builder.png"
        alt="Mango's visual query builder with three AND conditions on the customers collection"
        chips={["EJSON editor", "Query builder", "Assistant"]}
      >
        Write the EJSON filter with completion for your fields, click conditions together in the
        query builder, or describe it to the assistant — like the refunded-orders request above. All
        three land in the same filter editor, so you can start one way and finish another.
      </ShotFeature>
      <ShotFeature
        flip
        kicker="Console + AI"
        title="Pipelines drafted into a real console."
        src="./screenshots/mango-assistant-console.png"
        alt="The assistant drafting an aggregation pipeline that has been sent to the Mango console and run"
        chips={["Aggregations", "$lookup", "Send to console"]}
      >
        Ask for a report and get the aggregation, with the reasoning behind each stage. Send it to
        the console, tweak it with IntelliSense, and run it with ⌘/Ctrl + Enter.
      </ShotFeature>
      <ShotFeature
        kicker="Workspaces + notebooks"
        title="Your queries, as Markdown in your repo."
        src="./screenshots/mango-notebook.png"
        alt="A Mango notebook opened from a workspace folder, showing the Git branch and an aggregation result"
        chips={[".mnq.md", ".mnc.md", ".mnn.md", "Git branch"]}
      >
        Register a folder and every saved query, console script, and notebook becomes a plain
        Markdown file. The sidebar shows the branch you are on; the files diff like code.
      </ShotFeature>
      <ShotFeature
        flip
        kicker="Explain + AI"
        title="Index advice from the plan itself."
        src="./screenshots/mango-playground.png"
        alt="The query playground's explain output next to the assistant recommending a compound index"
        chips={["explain()", "executionStats", "ESR"]}
      >
        Run explain in the playground and ask why the query is slow. The assistant sees the plan
        and your current indexes, and answers with the index to create — and the trade-off.
      </ShotFeature>
    </div>
    <p className="ships-more">
      <a className="button primary" href={href("features")}>
        Tour the workbench
      </a>{" "}
      <a className="button ghost" href={href("ai")}>
        See the AI features
      </a>
    </p>
  </section>
);

const Promise = () => (
  <section className="promise" id="promise">
    <div className="promise-panel">
      <div className="promise-copy">
        <span className="kicker">The promise</span>
        <h2>Free forever — with every feature in it.</h2>
        <p>
          Database tools have a familiar shape: the free edition browses documents, and the things
          a team actually needs — AI, SSO, more connections, the good editor — sit behind a licence
          key. Mango is built the other way round. There is one build, it is free permanently, and
          no capability is held back to create a reason to upgrade.
        </p>
      </div>
      <ul className="promise-list">
        <li>
          <strong>Every feature, free.</strong> Not an introductory price, not a community edition
          with an asterisk.
        </li>
        <li>
          <strong>Enterprise features included.</strong> OIDC and Microsoft Entra, encrypted
          storage, import and export, OpenTelemetry — in the same build as everything else.
        </li>
        <li>
          <strong>Unlimited connections.</strong> No cap on databases, no seats, nothing counted per
          developer.
        </li>
        <li>
          <strong>AI included.</strong> The assistant is part of the app and runs on the provider
          you already pay for — or a local model that costs nothing.
        </li>
      </ul>
    </div>
  </section>
);

const Highlights = () => (
  <section className="section" id="highlights">
    <SectionHeading kicker="What that buys you" title="Free, because it runs on what you already have.">
      Mango is not a free tier propped up by a paid one. It is a local tool that drives your own
      databases, your own sign-in, and the AI subscription already on your invoice — which is why
      there is nothing left for us to charge for.
    </SectionHeading>
    <div className="highlight-grid">
      {highlights.map((item, index) => (
        <article className="highlight-card" key={item.title}>
          <span className="highlight-index">{String(index + 1).padStart(2, "0")}</span>
          <h3>{item.title}</h3>
          <p>{item.text}</p>
          <div className="product-tags">
            {item.chips.map((chip) => (
              <span key={chip}>{chip}</span>
            ))}
          </div>
        </article>
      ))}
    </div>
  </section>
);

const Paywall = () => (
  <section className="section" id="paywall">
    <SectionHeading kicker="What it costs" title="The licence you don't have to buy.">
      A MongoDB GUI with AI, SSO, and a proper shell usually means a per-developer licence — and an
      Enterprise column for the identity features your company actually requires. Mango ships all
      of it in the free build.
    </SectionHeading>
    <div className="compare-grid">
      <article className="compare-card">
        <span className="compare-label">The usual arrangement</span>
        <ul className="compare-list minus">
          <li>A per-seat licence, renewed every year</li>
          <li>A free edition with a connection or feature limit</li>
          <li>AI query help as a paid add-on, on its own meter</li>
          <li>SSO and LDAP priced as "Enterprise — contact us"</li>
          <li>Import, export, and code generation on the paid tier</li>
          <li>Saved queries living in the vendor's cloud</li>
        </ul>
      </article>
      <article className="compare-card highlight">
        <span className="compare-label">With Mango</span>
        <ul className="compare-list plus">
          <li>
            <strong>$0.</strong> Free and open source under the MIT licence
          </li>
          <li>
            <strong>Unlimited connections</strong>, on every machine you own
          </li>
          <li>The AI assistant runs on the Copilot, Claude, Codex, or Ollama you already have</li>
          <li>MONGODB-OIDC with Microsoft Entra in the same build as everything else</li>
          <li>Import, export, dump, and restore included</li>
          <li>Saved queries as Markdown in your own Git repository</li>
        </ul>
      </article>
    </div>
    <div className="callout">
      <strong>The whole bill, itemised</strong>
      <p>
        Mango: free. AI: whatever you already pay your provider — or nothing, with a local model.
        That is the complete list. There is no line item from us.
      </p>
    </div>
  </section>
);

const Pricing = () => (
  <section className="section" id="pricing">
    <SectionHeading kicker="Pricing" title="One plan. Everything is in it.">
      This is the entire pricing page. There is no second column, no feature matrix with grey ticks,
      and no "starting from".
    </SectionHeading>
    <div className="plan-grid">
      <article className="plan-card">
        <span className="plan-name">Mango</span>
        <div className="plan-price">
          <span className="plan-amount">$0</span>
          <span className="plan-period">forever</span>
        </div>
        <p className="plan-blurb">
          Every feature, on every machine you own, for personal and commercial use. Open source under
          the MIT licence.
        </p>
        <ul className="plan-list">
          <li>The complete workbench — console, notebooks, workspaces, GridFS</li>
          <li>Every AI feature, on the provider of your choice</li>
          <li>Unlimited connections and unlimited developers</li>
          <li>Enterprise authentication — OIDC and Microsoft Entra</li>
          <li>Desktop, Docker, and Aspire — all three</li>
        </ul>
        <a className="button primary" href={href("download")}>
          Download
        </a>
      </article>
      <article className="plan-card muted">
        <span className="plan-name">What we don't do</span>
        <ul className="plan-list minus">
          <li>No paid tier that unlocks the good parts</li>
          <li>No per-seat billing, ever</li>
          <li>No connection or query limits</li>
          <li>No AI add-on or token resale</li>
          <li>No "contact sales" for SSO</li>
          <li>No account, no cloud workspace, no telemetry</li>
        </ul>
        <p className="plan-note">
          Mango stays free. If something ever runs on our infrastructure rather than yours, it will be
          a separate, clearly-labelled thing — and it will not take features out of this column.
        </p>
      </article>
    </div>
  </section>
);

const Included = () => (
  <section className="flow-band" id="included">
    <SectionHeading kicker="What's included" title="The list is just… the feature list.">
      Everything below ships in the build you can download right now. It is worth writing out,
      because several of these are the exact lines that usually appear under a heading called
      Enterprise.
    </SectionHeading>
    <ul className="included-grid">
      {included.map(([name, note]) => (
        <li className="included-item" key={name}>
          <span className="included-check" aria-hidden="true">
            ✓
          </span>
          <span>
            <strong>{name}</strong>
            <span className="included-note">{note}</span>
          </span>
        </li>
      ))}
    </ul>
  </section>
);

const Ships = () => (
  <section className="section" id="ships">
    <SectionHeading kicker="What ships" title="Three ways to run the same workbench.">
      One release tag, three channels: a desktop app, a container image, and a .NET Aspire package.
      The same server and the same UI sit behind all three — what differs is who starts it and
      where it keeps its settings.
    </SectionHeading>
    <div className="ship-groups">
      {shipGroups.map((group) => (
        <ShipGroupCard group={group} key={group.id} />
      ))}
    </div>
    <p className="ships-more">
      <a className="button primary" href={href("download")}>
        Go to downloads
      </a>
    </p>
  </section>
);

const Principles = () => (
  <section className="section" id="principles">
    <SectionHeading kicker="Principles" title="A privileged tool that behaves like one.">
      Mango can read and write every database you point it at, so it is built to be boring about
      trust: local by default, explicit about what AI sees, and plain text wherever it can be.
    </SectionHeading>
    <FeatureGrid features={principles} />
  </section>
);

const FinalCta = () => (
  <section className="final-cta" id="start">
    <div className="final-cta-panel">
      <div>
        <span className="kicker">Get started</span>
        <h2>Install it, use all of it, pay nothing.</h2>
        <p>
          Grab the desktop app, add one line to your Aspire AppHost, or run the container — and if
          the free version turns out to be missing the feature you needed, tell us, because that is
          a bug rather than a business model.
        </p>
      </div>
      <div className="final-cta-actions">
        <a className="button primary" href={href("download")}>
          Download
        </a>
        <a className="button ghost" href={repoUrl}>
          View on GitHub
        </a>
      </div>
    </div>
  </section>
);
