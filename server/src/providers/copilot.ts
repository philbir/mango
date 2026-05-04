import { spawn, spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import {
  type AiChatInput,
  type AiChatResult,
  type AiProvider,
  type ModelOption,
} from "./types.js";

// Locate the user's `copilot` CLI (GitHub Copilot CLI). We invoke it as a
// subprocess instead of using `@github/copilot-sdk` so the desktop sidecar
// doesn't have to bundle 250MB+ of per-platform native binaries — and so
// bun-compile doesn't choke on the SDK's Windows-only native addons (keytar,
// conpty, pty) that previously crashed the bundled binary on startup.
interface LocatedCli {
  command: string;
  found: boolean;
  source: "override" | "env" | "candidate" | "where" | "path" | "fallback";
}

export interface CopilotCliDetection {
  ok: boolean;
  path: string | null;
  source: LocatedCli["source"];
  version: string | null;
  error?: string;
}

const isExecutableFile = (candidate: string): boolean => {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const findCliOnPath = (): string | null => {
  const names =
    process.platform === "win32"
      ? ["copilot.cmd", "copilot.exe", "copilot"]
      : ["copilot"];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (isExecutableFile(candidate)) return candidate;
    }
  }
  return null;
};

const findCliWithWhere = (): string | null => {
  const attempts: Array<[string, string[]]> =
    process.platform === "win32"
      ? [["where", ["copilot"]]]
      : [
          ["zsh", ["-lc", "where copilot"]],
          ["sh", ["-lc", "command -v copilot"]],
        ];

  for (const [command, args] of attempts) {
    const result = spawnSync(command, args, {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    });
    if (result.status !== 0) continue;
    const candidate = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && isExecutableFile(line));
    if (candidate) return candidate;
  }
  return null;
};

const locateCli = (override?: string | null): LocatedCli => {
  const cleanedOverride = override?.trim();
  if (cleanedOverride) {
    return {
      command: cleanedOverride,
      found: isExecutableFile(cleanedOverride),
      source: "override",
    };
  }

  const envOverride = process.env.MANGO_COPILOT_CLI?.trim();
  if (envOverride) {
    return {
      command: envOverride,
      found: isExecutableFile(envOverride),
      source: "env",
    };
  }
  const home = homedir();
  const candidates = [
    "/opt/homebrew/bin/copilot",
    "/usr/local/bin/copilot",
    path.join(home, ".npm-global", "bin", "copilot"),
    path.join(home, ".local", "bin", "copilot"),
  ];
  for (const c of candidates) {
    if (isExecutableFile(c)) return { command: c, found: true, source: "candidate" };
  }

  const whereCli = findCliWithWhere();
  if (whereCli) return { command: whereCli, found: true, source: "where" };

  const pathCli = findCliOnPath();
  if (pathCli) return { command: pathCli, found: true, source: "path" };

  return { command: "copilot", found: false, source: "fallback" };
};

const detectCopilotAuth = (): boolean => {
  if (process.env.GITHUB_TOKEN) return true;
  const home = homedir();
  const candidates = [
    path.join(home, ".copilot"),
    path.join(home, ".config", "github-copilot"),
    path.join(home, "Library", "Application Support", "GitHub Copilot"),
  ];
  return candidates.some((p) => existsSync(p));
};

// We point the CLI at an empty config dir so it doesn't try to load the user's
// MCP servers / agents on every request — that's where most of the startup
// cost lives. Created lazily, persists for the process lifetime.
let isolatedConfigDir: string | null = null;
const getIsolatedConfigDir = (): string => {
  if (isolatedConfigDir) return isolatedConfigDir;
  const dir = path.join(tmpdir(), "mango-copilot-cfg");
  try {
    mkdirSync(dir, { recursive: true });
    const mcpPath = path.join(dir, "mcp-config.json");
    if (!existsSync(mcpPath)) writeFileSync(mcpPath, "{}\n", "utf8");
  } catch {
    // Fall through — CLI will use the user's default config dir.
  }
  isolatedConfigDir = dir;
  return dir;
};

interface CopilotEvent {
  type: string;
  data?: { content?: string };
}

const COPILOT_MODELS: ModelOption[] = [
  { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
  { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
  { id: "claude-haiku-4.5", name: "Claude Haiku 4.5" },
  { id: "claude-opus-4.6", name: "Claude Opus 4.6" },
  { id: "claude-opus-4.6-fast", name: "Claude Opus 4.6 Fast" },
  { id: "claude-opus-4.6-1m", name: "Claude Opus 4.6 1M" },
  { id: "claude-opus-4.5", name: "Claude Opus 4.5" },
  { id: "claude-sonnet-4", name: "Claude Sonnet 4" },
  { id: "gemini-3-pro-preview", name: "Gemini 3 Pro Preview" },
  { id: "gpt-5.4", name: "GPT-5.4" },
  { id: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
  { id: "gpt-5.2-codex", name: "GPT-5.2 Codex" },
  { id: "gpt-5.2", name: "GPT-5.2" },
  { id: "gpt-5.1-codex-max", name: "GPT-5.1 Codex Max" },
  { id: "gpt-5.1-codex", name: "GPT-5.1 Codex" },
  { id: "gpt-5.1", name: "GPT-5.1" },
  { id: "gpt-5.1-codex-mini", name: "GPT-5.1 Codex Mini" },
  { id: "gpt-5-mini", name: "GPT-5 Mini" },
  { id: "gpt-4.1", name: "GPT-4.1" },
];

const modelNameFromId = (id: string): string =>
  id
    .split("-")
    .map((part) =>
      /^(gpt|1m)$/i.test(part)
        ? part.toUpperCase()
        : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(" ");

const findSelectedModelEnum = (value: unknown): string[] | null => {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const selectedModel = record.selectedModel as
    | { enum?: unknown }
    | undefined;
  if (Array.isArray(selectedModel?.enum)) {
    const ids = selectedModel.enum.filter((id): id is string => typeof id === "string");
    if (ids.length > 0) return ids;
  }
  for (const child of Object.values(record)) {
    const found = findSelectedModelEnum(child);
    if (found) return found;
  }
  return null;
};

const readModelsFromCliSchema = (cliPath: string): ModelOption[] | null => {
  try {
    let current = path.dirname(realpathSync(cliPath));
    for (let depth = 0; depth < 6; depth += 1) {
      const schemaPath = path.join(current, "schemas", "session-events.schema.json");
      if (existsSync(schemaPath)) {
        const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as unknown;
        const ids = findSelectedModelEnum(schema);
        if (ids) return ids.map((id) => ({ id, name: modelNameFromId(id) }));
        return null;
      }
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  } catch {
    return null;
  }
  return null;
};

const runCliVersion = async (cliPath: string): Promise<string> =>
  await new Promise((resolve, reject) => {
    const child = spawn(cliPath, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Copilot CLI version check timed out for "${cliPath}".`));
    }, 5_000);

    child.stdout.on("data", (b: Buffer) => (stdout += b.toString()));
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`Could not run Copilot CLI at "${cliPath}": ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const combined = `${stdout}\n${stderr}`;
      const versionLine = combined
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => /^GitHub Copilot CLI\b/.test(line));
      if (code === 0 && versionLine) return resolve(versionLine);
      reject(
        new Error(
          `Copilot CLI version check failed with ${code}: ${stderr.trim() || stdout.trim() || "(no output)"}`,
        ),
      );
    });
  });

export const detectCopilotCli = async (
  override?: string | null,
): Promise<CopilotCliDetection> => {
  const cli = locateCli(override);
  if (!cli.found) {
    return {
      ok: false,
      path: cli.source === "fallback" ? null : cli.command,
      source: cli.source,
      version: null,
      error:
        cli.source === "fallback"
          ? "Could not find Copilot CLI in common install paths or PATH."
          : `Copilot CLI path "${cli.command}" does not exist or is not executable.`,
    };
  }

  try {
    return {
      ok: true,
      path: cli.command,
      source: cli.source,
      version: await runCliVersion(cli.command),
    };
  } catch (e) {
    return {
      ok: false,
      path: cli.command,
      source: cli.source,
      version: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
};

const runQuery = async (
  systemPrompt: string,
  userPrompt: string,
  modelId: string | undefined,
  cliPath: string,
): Promise<{ text: string; model: string }> => {
  // Copilot CLI has no `--system-prompt` flag, so we inline the system context
  // as a leading section of the user prompt. Headers visually separate it.
  const combined = `## Instructions\n\n${systemPrompt}\n\n## Request\n\n${userPrompt}`;

  const args = [
    "-p",
    combined,
    "--output-format",
    "json",
    "--no-color",
    "--allow-all-tools",
    "--config-dir",
    getIsolatedConfigDir(),
  ];
  if (modelId) args.push("--model", modelId);

  return await new Promise((resolve, reject) => {
    const child = spawn(cliPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" },
    });
    let buffered = "";
    let stderr = "";
    let assistantContent = "";
    let modelOut = modelId ?? "copilot";
    let errored: string | null = null;

    child.stdout.on("data", (b: Buffer) => {
      buffered += b.toString();
      let nl: number;
      while ((nl = buffered.indexOf("\n")) !== -1) {
        const line = buffered.slice(0, nl).trim();
        buffered = buffered.slice(nl + 1);
        if (!line) continue;
        let evt: CopilotEvent;
        try {
          evt = JSON.parse(line) as CopilotEvent;
        } catch {
          continue;
        }
        // The terminal `assistant.message` event carries the full reply text.
        // Earlier `assistant.message_delta` events stream incremental tokens —
        // we ignore them and rely on the final consolidated message.
        if (evt.type === "assistant.message") {
          const content = evt.data?.content;
          if (typeof content === "string") assistantContent = content;
        }
        if (evt.type === "session.tools_updated") {
          const m = (evt.data as { model?: string } | undefined)?.model;
          if (typeof m === "string") modelOut = m;
        }
        if (evt.type === "error" || evt.type === "session.error") {
          const msg = (evt.data as { message?: string } | undefined)?.message;
          if (typeof msg === "string") errored = msg;
        }
      }
    });
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString()));
    child.on("error", (e) =>
      reject(
        new Error(
          `Could not spawn Copilot CLI at "${cliPath}": ${e.message}. Install GitHub Copilot CLI (https://docs.github.com/copilot/github-copilot-cli) or set MANGO_COPILOT_CLI to its full path.`,
        ),
      ),
    );
    child.on("close", (code) => {
      if (errored) return reject(new Error(`Copilot CLI: ${errored}`));
      if (code !== 0 && !assistantContent) {
        return reject(
          new Error(
            `Copilot CLI exited with ${code}: ${stderr.trim() || "(no stderr)"}`,
          ),
        );
      }
      resolve({ text: assistantContent, model: modelOut });
    });
  });
};

export interface CopilotBuildOptions {
  model?: string;
  cliPath?: string | null;
}

export const buildCopilotProvider = (
  opts: CopilotBuildOptions = {},
): AiProvider => {
  const model = opts.model ?? process.env.AI_MODEL ?? "claude-sonnet-4.5";
  const cli = locateCli(opts.cliPath);
  const authFound = detectCopilotAuth();

  const setupHint = !cli.found
    ? cli.source === "override" || cli.source === "env"
      ? `Copilot CLI path "${cli.command}" does not exist. Set the full path in AI settings or MANGO_COPILOT_CLI, for example /Users/you/.npm-global/bin/copilot.`
      : "Install the GitHub Copilot CLI (https://docs.github.com/copilot/github-copilot-cli) and log in once. Mango checks common locations including ~/.npm-global/bin/copilot, and you can set the full path in AI settings or MANGO_COPILOT_CLI."
    : authFound
      ? `Copilot CLI found at ${cli.command}. Mango will spawn it for each request.`
      : `Copilot CLI found at ${cli.command}. Set GITHUB_TOKEN with Copilot access, or run the CLI once to log in.`;

  return {
    name: "copilot",
    configured: cli.found && authFound,
    model,
    setupHint,
    async validate(): Promise<Record<string, string | number | boolean | null>> {
      const detection = await detectCopilotCli(cli.command);
      if (!detection.ok) throw new Error(detection.error ?? "Copilot CLI not found.");
      return {
        cliPath: detection.path,
        cliVersion: detection.version,
        modelSource: readModelsFromCliSchema(cli.command)
          ? "installed Copilot CLI schema"
          : "built-in Copilot model catalog",
      };
    },
    async listModels(): Promise<ModelOption[]> {
      // Copilot CLI currently has no non-interactive model-list command.
      // Prefer the installed CLI's schema when available; users can still type
      // any explicit model ID in settings if their account exposes newer ones.
      return readModelsFromCliSchema(cli.command) ?? COPILOT_MODELS;
    },
    async chat(input: AiChatInput): Promise<AiChatResult> {
      const useModel = input.model ?? model;
      const history = input.messages
        .map((m) =>
          m.role === "user" ? `User: ${m.content}` : `Assistant: ${m.content}`,
        )
        .join("\n\n");
      const lastUser = input.messages
        .slice()
        .reverse()
        .find((m) => m.role === "user");
      if (!lastUser) {
        return { text: "", model: useModel };
      }
      const userPrompt =
        input.messages.length > 1
          ? `Conversation so far:\n\n${history}\n\nReply to the latest user message.`
          : lastUser.content;
      const { text, model: modelOut } = await runQuery(
        input.systemPrompt,
        userPrompt,
        useModel,
        cli.command,
      );
      return { text, model: modelOut };
    },
  };
};
