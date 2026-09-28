import {
  Callout,
  CodeBlock,
  ConfigTable,
  DocList,
  FeatureGrid,
  FlowDiagram,
  ModeGrid,
  ProviderDetail,
  Screenshot,
  SectionHeading,
  type DocSection,
} from "../components/ui";
import type { Feature } from "../data/features";
import { commands } from "../data/commands";
import { href } from "../router";

const aiFeatures: Feature[] = [
  {
    title: "Plain English to EJSON",
    text: "Describe the documents you want; get a canonical EJSON filter built from your real field names and types, ready to apply.",
    glyph: "F",
  },
  {
    title: "Pipelines and commands",
    text: "Ask for a report and get the aggregation — or the updateMany, createIndex, or runCommand — sent straight to the console.",
    glyph: "P",
  },
  {
    title: "Index advice from the plan",
    text: "The assistant reads your explain output and existing indexes, and answers with the index to create and why.",
    glyph: "I",
  },
  {
    title: "Knows where you are",
    text: "In a collection it samples that collection; in a console or shell it samples the database. No pasting schemas into a chat window.",
    glyph: "C",
  },
  {
    title: "Nothing runs on its own",
    text: "Answers are code blocks with Apply, Send to console, and Copy. The model never executes anything against your database.",
    glyph: "N",
  },
  {
    title: "Your provider, your bill",
    text: "GitHub Copilot, Claude Code, OpenAI Codex, any OpenAI-compatible endpoint, or a local model. No AI subscription from us.",
    glyph: "Y",
  },
];

const docs: DocSection[] = [
  {
    id: "assistant",
    eyebrow: "Chat",
    title: "The assistant",
    body: "A side panel next to whatever you are working on. Toggle it with ⌘/Ctrl + I; it follows you between tabs and changes what it knows as you go.",
    content: () => (
      <>
        <ConfigTable
          label="Assistant context modes"
          rows={[
            ["Collection", "In a collection's Query view. Samples 30 documents of that collection — field paths, types, and a couple of short example values."],
            ["Console / Shell", "In a console or shell tab. Samples every collection in the database (up to 25, a few documents each) so it can join across them."],
            ["Indexes", "In a collection's Info tab. Adds the current index list and the latest explain output from the playground."],
            ["General", "Nothing open yet. Answers MongoDB questions and suggests where to start."],
          ]}
        />
        <ModeGrid
          gap
          items={[
            ["Apply buttons", "Answers come back as tagged code blocks. A filter gets Apply filter; a projection, sort, or pipeline opens in the console as an aggregate; a console or shell command gets Send to console."],
            ["Model picker", "The footer lists the models your provider offers right now — read live from the Copilot, Claude Code, and Codex CLIs — and remembers your choice per provider."],
            ["Starter prompts", "Each mode offers a few suggestions to get going: show recent documents, find documents missing a field, explain why a query is a COLLSCAN."],
            ["Stays out of the way", "The panel is resizable and closes with the same shortcut. Your conversation is per tab, so the orders chat doesn't leak into customers."],
          ]}
        />
      </>
    ),
  },
  {
    id: "filters",
    eyebrow: "Query view",
    title: "Natural language filters",
    body: "The fastest way to a filter you'd otherwise look up: describe it, check it, apply it.",
    content: () => (
      <>
        <Screenshot
          src="./screenshots/mango-assistant-filter.png"
          alt="The assistant answering a plain-English request with an EJSON filter that has been applied to the orders collection"
          caption="The filter uses the Decimal128 and date types the sampler found, and explains the choices it made. Apply filter wrote it into the editor and ran it — ten orders back."
        />
        <CodeBlock title="Prompt → filter" code={commands.aiFilterExample} />
      </>
    ),
  },
  {
    id: "commands",
    eyebrow: "Console",
    title: "Commands and pipelines",
    body: "In a console tab the assistant sees the whole database, so it can write aggregations with $lookup across collections, bulk updates, and admin commands.",
    content: () => (
      <Screenshot
        src="./screenshots/mango-assistant-console.png"
        alt="The assistant drafting an aggregation pipeline with $lookup, sent to the Mango console and run"
        caption="Top customers by spend, joined to their names and emails. Send to console dropped the pipeline into the editor; ⌘/Ctrl + Enter ran it."
      />
    ),
  },
  {
    id: "optimize",
    eyebrow: "Performance",
    title: "Index advice",
    body: "Optimize with AI — in the Indexes panel and the query playground — opens the assistant in Indexes mode with the plan and your indexes attached.",
    content: () => (
      <>
        <Screenshot
          src="./screenshots/mango-playground.png"
          alt="The query playground's explain plan beside the assistant recommending an ESR-ordered compound index"
          caption="The plan showed a blocking SORT and 3× more documents examined than returned. The assistant proposed an equality-sort-range compound index and spelled out the write-amplification trade-off."
        />
        <p className="doc-note">
          The recommendation is a <code>createIndex</code> command like any other — copy it, or send
          it to the console and run it when you agree with it.
        </p>
      </>
    ),
  },
  {
    id: "how",
    eyebrow: "Under the hood",
    title: "How it works",
    body: "Every request is one turn: Mango builds a prompt from what you are looking at, asks your provider, and renders the answer. There is no agent loop and no tool access to your database.",
    content: () => (
      <>
        <FlowDiagram
          label="Mango AI request flow"
          steps={["You ask", "Schema sampled", "Provider answers", "Code block", "You apply"]}
        />
        <ModeGrid
          gap
          items={[
            ["1. Sample", "Mango samples the collection (or database) and renders a compact schema: each field path, its observed BSON types, and up to two short examples."],
            ["2. Ask", "The schema, the mode's instructions, and your conversation go to the provider. CLI providers are spawned per request and answer in a single turn."],
            ["3. Review", "The answer is rendered as Markdown. Code blocks tagged mango-filter, mango-pipeline, mango-console, and friends get their Apply buttons."],
            ["4. Run", "Nothing happens until you click. Applying a filter runs a find; sending to the console waits for you to press Run."],
          ]}
        />
      </>
    ),
  },
  {
    id: "providers",
    eyebrow: "Bring your model",
    title: "Providers",
    body: "Four providers behind one interface. Three of them drive a coding CLI you already have installed and signed in to, so they run on the subscription you already pay for.",
    content: () => (
      <>
        <Screenshot
          src="./screenshots/mango-ai-settings.png"
          alt="The AI provider dialog with API, GitHub Copilot, Claude Code, and Codex options"
          caption="Settings → Configure provider. CLI paths are detected for you, Test sends a real request, and everything saved here is encrypted at rest."
        />
        <ProviderDetail
          id="provider-copilot"
          name="GitHub Copilot"
          type="copilot"
          mode="Your Copilot plan"
          blurb="Runs through the GitHub Copilot CLI with its existing login, or a GITHUB_TOKEN. The model list is read live from your account."
          settings={[
            ["MANGO_COPILOT_CLI", "Optional path to the copilot binary when it isn't on PATH."],
            ["GITHUB_TOKEN", "Optional token instead of the CLI's own login."],
          ]}
        />
        <ProviderDetail
          id="provider-claude"
          name="Claude Code"
          type="claude-code"
          mode="Your Claude plan"
          blurb="Spawns your installed claude CLI per request, using the login in ~/.claude or ANTHROPIC_API_KEY. Models come from the CLI's own catalogue."
          settings={[["MANGO_CLAUDE_CLI", "Optional path to the claude binary when it isn't on PATH."]]}
        />
        <ProviderDetail
          id="provider-codex"
          name="OpenAI Codex"
          type="codex"
          mode="Your ChatGPT plan"
          blurb="Talks to codex app-server with your Codex login or OPENAI_API_KEY. On macOS Mango falls back to the Codex bundled with the ChatGPT app."
          settings={[["MANGO_CODEX_CLI", "Optional path to a current codex build."]]}
        />
        <ProviderDetail
          id="provider-openai"
          name="OpenAI-compatible API"
          type="openai"
          mode="Any /v1 endpoint"
          blurb="OpenAI, Azure OpenAI, GitHub Models, Ollama, LM Studio — anything that speaks the chat completions API. Point it at a local Ollama and the whole loop stays on your machine."
          settings={[
            ["AI_API_KEY", "The provider key. Ollama ignores it, but Mango needs a value — any string will do."],
            ["AI_BASE_URL", "The endpoint, e.g. http://localhost:11434/v1 for Ollama."],
            ["AI_MODEL", "e.g. gpt-4o-mini, or llama3.1 on Ollama."],
          ]}
        />
      </>
    ),
  },
  {
    id: "provider-config",
    eyebrow: "Setup",
    title: "Configuring a provider",
    body: "Pick a provider in the UI, or set it through the environment for a container or an Aspire resource. Saved UI settings win over the environment.",
    content: () => (
      <div className="code-grid">
        <CodeBlock title="GitHub Copilot" code={commands.aiCopilot} />
        <CodeBlock title="Claude Code" code={commands.aiClaude} />
        <CodeBlock title="OpenAI Codex" code={commands.aiCodex} />
        <CodeBlock title="Ollama (local)" code={commands.aiOllama} />
      </div>
    ),
  },
  {
    id: "privacy",
    eyebrow: "Data access",
    title: "What the model sees",
    body: "A database tool with AI should be explicit about what leaves the machine. Here is the whole list.",
    content: () => (
      <>
        <ConfigTable
          label="What is sent to the AI provider"
          rows={[
            ["Always", "Your messages, field paths and their BSON types, and up to two short example values per field (strings over 60 characters are truncated)."],
            ["Indexes mode", "Index definitions and the explain plan you just ran."],
            ["Opt-in", "Let AI sample collection values runs distinct() on up to eight low-cardinality string and boolean fields and includes the values — better filters for status-like enums. Off by default."],
            ["Never", "Whole documents, connection strings, credentials, or anything from collections you are not looking at (outside console mode's database sampling)."],
          ]}
        />
        <Callout title="Keep it local if you need to">
          With the OpenAI-compatible provider pointed at Ollama or LM Studio on your own machine,
          nothing is sent anywhere. For a hosted provider, the data goes where your existing Copilot,
          Claude, or OpenAI agreement already says it goes — Mango adds no service in between.
        </Callout>
      </>
    ),
  },
];

export const AiPage = () => (
  <>
    <section className="product-hero">
      <div className="product-hero-copy">
        <span className="kicker product-eyebrow">
          <span className="product-index large">02</span> Mango AI
        </span>
        <h1>An assistant that knows your schema.</h1>
        <p className="lead">
          Ask in plain language and get the filter, pipeline, command, or index you meant — built
          from your real fields and types, shown before it runs, and powered by the AI subscription
          you already have.
        </p>
        <div className="hero-actions">
          <a className="button primary" href={href("download")}>
            Download Mango
          </a>
          <a className="button ghost" href={href("ai", "providers")}>
            Choose a provider
          </a>
        </div>
        <div className="proof-row">
          <span>Included</span>
          <span>Copilot</span>
          <span>Claude Code</span>
          <span>Codex</span>
          <span>OpenAI</span>
          <span>Azure</span>
          <span>Ollama</span>
        </div>
      </div>
      <picture className="product-hero-visual">
        <img
          src="./screenshots/mango-assistant-filter.png"
          alt="Mango's assistant turning a plain-English request into an applied EJSON filter"
        />
      </picture>
    </section>

    <section className="section" id="ai-features">
      <SectionHeading kicker="What it does" title="AI as a drafting partner, not a hidden executor.">
        The assistant writes MongoDB; you decide whether it runs. Every AI feature is part of the
        free build, and none of them needs an AI subscription from us — Mango drives the one you
        already have.
      </SectionHeading>
      <FeatureGrid features={aiFeatures} />
    </section>

    <section className="docs-wrap">
      <DocList docs={docs} />
    </section>
  </>
);
