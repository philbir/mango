import { spawn, spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
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

// Used only when the live query below fails (old CLI without ACP, not logged
// in, …). `auto` is always accepted; users can still type any explicit ID.
const FALLBACK_MODELS: ModelOption[] = [
  { id: "auto", name: "Auto", description: "Let Copilot pick the best model" },
];

interface AcpModel {
  modelId?: unknown;
  name?: unknown;
  description?: unknown;
}

interface AcpMessage {
  id?: number;
  result?: { sessionId?: string; models?: { availableModels?: AcpModel[] } };
  error?: { message?: string };
}

// The Copilot model catalog is per-account and changes server-side, so there's
// no static list worth shipping. The CLI's ACP server (`copilot --acp`) reports
// the account's available models in its `session/new` response — spin one up,
// read the list, close the session and exit.
const queryModelsViaAcp = async (cliPath: string): Promise<ModelOption[]> =>
  await new Promise((resolve, reject) => {
    const child = spawn(
      cliPath,
      ["--acp", "--no-color", "--config-dir", getIsolatedConfigDir()],
      {
        cwd: tmpdir(),
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, NO_COLOR: "1" },
      },
    );
    let buffered = "";
    let stderr = "";
    let settled = false;
    const finish = (err: Error | null, models?: ModelOption[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.end();
      child.kill();
      if (err) reject(err);
      else resolve(models ?? []);
    };
    const send = (msg: Record<string, unknown>) =>
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);
    const timer = setTimeout(
      () => finish(new Error("Copilot CLI model list timed out.")),
      30_000,
    );

    child.stdout.on("data", (b: Buffer) => {
      buffered += b.toString();
      let nl: number;
      while ((nl = buffered.indexOf("\n")) !== -1) {
        const line = buffered.slice(0, nl).trim();
        buffered = buffered.slice(nl + 1);
        if (!line) continue;
        let msg: AcpMessage;
        try {
          msg = JSON.parse(line) as AcpMessage;
        } catch {
          continue;
        }
        if (msg.id !== 1 && msg.id !== 2) continue;
        if (msg.error) {
          return finish(
            new Error(`Copilot CLI: ${msg.error.message ?? "ACP request failed"}`),
          );
        }
        if (msg.id === 1) {
          send({
            id: 2,
            method: "session/new",
            params: { cwd: tmpdir(), mcpServers: [] },
          });
          continue;
        }
        const sessionId = msg.result?.sessionId;
        if (sessionId) send({ id: 3, method: "session/close", params: { sessionId } });
        const models = (msg.result?.models?.availableModels ?? []).flatMap(
          (m): ModelOption[] =>
            typeof m.modelId === "string"
              ? [
                  {
                    id: m.modelId,
                    name: typeof m.name === "string" ? m.name : m.modelId,
                    ...(typeof m.description === "string" &&
                    m.description !== m.name
                      ? { description: m.description }
                      : {}),
                  },
                ]
              : [],
        );
        if (models.length === 0) {
          return finish(new Error("Copilot CLI returned no models."));
        }
        return finish(null, models);
      }
    });
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString()));
    child.on("error", (e) =>
      finish(new Error(`Could not run Copilot CLI at "${cliPath}": ${e.message}`)),
    );
    child.on("close", (code) =>
      finish(
        new Error(
          `Copilot CLI exited with ${code} before listing models: ${stderr.trim() || "(no stderr)"}`,
        ),
      ),
    );

    send({
      id: 1,
      method: "initialize",
      params: { protocolVersion: 1, clientCapabilities: {} },
    });
  });

// Spawning the ACP server takes a few seconds, so cache per CLI path. Failures
// aren't cached — the next call retries.
const MODEL_CACHE_TTL_MS = 10 * 60_000;
const modelCache = new Map<string, { at: number; models: ModelOption[] }>();

const listCliModels = async (cliPath: string): Promise<ModelOption[]> => {
  const hit = modelCache.get(cliPath);
  if (hit && Date.now() - hit.at < MODEL_CACHE_TTL_MS) return hit.models;
  const models = await queryModelsViaAcp(cliPath);
  modelCache.set(cliPath, { at: Date.now(), models });
  return models;
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
  const model = opts.model ?? process.env.AI_MODEL ?? "auto";
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
      // Surface a live-query failure here instead of silently showing the
      // fallback list — a stale catalog is what made Test look "connected".
      await listCliModels(cli.command);
      return {
        cliPath: detection.path,
        cliVersion: detection.version,
        modelSource: "Copilot CLI (live account catalog)",
      };
    },
    async listModels(): Promise<ModelOption[]> {
      try {
        return await listCliModels(cli.command);
      } catch {
        return FALLBACK_MODELS;
      }
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
