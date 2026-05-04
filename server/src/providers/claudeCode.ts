import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  type AiChatInput,
  type AiChatResult,
  type AiProvider,
  type ModelOption,
} from "./types.js";

const FALLBACK_MODELS: ModelOption[] = [
  { id: "sonnet", name: "Claude Sonnet (latest)", vendor: "anthropic" },
  { id: "opus", name: "Claude Opus (latest)", vendor: "anthropic" },
  { id: "haiku", name: "Claude Haiku (latest)", vendor: "anthropic" },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", vendor: "anthropic" },
  { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", vendor: "anthropic" },
  { id: "claude-opus-4-6", name: "Claude Opus 4.6", vendor: "anthropic" },
  { id: "claude-opus-4-5", name: "Claude Opus 4.5", vendor: "anthropic" },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", vendor: "anthropic" },
];

interface LocatedCli {
  command: string;
  found: boolean;
  source: "override" | "env" | "candidate" | "where" | "path" | "fallback";
}

export interface ClaudeCliDetection {
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
      ? ["claude.cmd", "claude.exe", "claude"]
      : ["claude"];
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
      ? [["where", ["claude"]]]
      : [
          ["zsh", ["-lc", "where claude"]],
          ["sh", ["-lc", "command -v claude"]],
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

// Locate the user's `claude` CLI: their installed Claude Code, ideally on PATH
// or in the well-known per-user install location. We invoke it as a subprocess
// instead of using `@anthropic-ai/claude-agent-sdk` so the desktop sidecar (a
// bun-compiled single binary) doesn't have to ship the 70MB SDK + bundled
// CLI + ripgrep + wasm tree as Tauri resources.
const locateCli = (override?: string | null): LocatedCli => {
  const cleanedOverride = override?.trim();
  if (cleanedOverride) {
    return {
      command: cleanedOverride,
      found: isExecutableFile(cleanedOverride),
      source: "override",
    };
  }

  const envOverride = process.env.MANGO_CLAUDE_CLI?.trim();
  if (envOverride) {
    return {
      command: envOverride,
      found: isExecutableFile(envOverride),
      source: "env",
    };
  }
  const home = homedir();
  const candidates = [
    path.join(home, ".claude", "local", "claude"),
    path.join(home, ".npm-global", "bin", "claude"),
    path.join(home, ".bun", "bin", "claude"),
    path.join(home, ".local", "bin", "claude"),
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
  ];
  for (const c of candidates) {
    if (isExecutableFile(c)) return { command: c, found: true, source: "candidate" };
  }

  const whereCli = findCliWithWhere();
  if (whereCli) return { command: whereCli, found: true, source: "where" };

  const pathCli = findCliOnPath();
  if (pathCli) return { command: pathCli, found: true, source: "path" };

  return { command: "claude", found: false, source: "fallback" };
};

const detectClaudeAuth = (): boolean => {
  if (process.env.ANTHROPIC_API_KEY) return true;
  const home = homedir();
  const candidates = [
    path.join(home, ".claude"),
    path.join(home, ".config", "claude"),
    path.join(home, "Library", "Application Support", "Claude"),
  ];
  return candidates.some((p) => existsSync(p));
};

interface ClaudeCliResult {
  type: "result";
  subtype?: string;
  is_error?: boolean;
  result?: string;
  modelUsage?: Record<string, unknown>;
}

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
      reject(new Error(`Claude CLI version check timed out for "${cliPath}".`));
    }, 5_000);

    child.stdout.on("data", (b: Buffer) => (stdout += b.toString()));
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`Could not run Claude CLI at "${cliPath}": ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const output = `${stdout}\n${stderr}`
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const versionLine = output.find((line) => /claude/i.test(line)) ?? output[0];
      if (code === 0 && versionLine) return resolve(versionLine);
      reject(
        new Error(
          `Claude CLI version check failed with ${code}: ${stderr.trim() || stdout.trim() || "(no output)"}`,
        ),
      );
    });
  });

export const detectClaudeCli = async (
  override?: string | null,
): Promise<ClaudeCliDetection> => {
  const cli = locateCli(override);
  if (!cli.found) {
    return {
      ok: false,
      path: cli.source === "fallback" ? null : cli.command,
      source: cli.source,
      version: null,
      error:
        cli.source === "fallback"
          ? "Could not find Claude Code CLI in common install paths or PATH."
          : `Claude Code CLI path "${cli.command}" does not exist or is not executable.`,
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
  const args = [
    "-p",
    "--output-format",
    "json",
    "--system-prompt",
    systemPrompt,
    "--allowed-tools",
    "",
    "--no-session-persistence",
  ];
  if (modelId) args.push("--model", modelId);

  return await new Promise((resolve, reject) => {
    const child = spawn(cliPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => (stdout += b.toString()));
    child.stderr.on("data", (b) => (stderr += b.toString()));
    child.on("error", (e) =>
      reject(
        new Error(
          `Could not spawn Claude CLI at "${cliPath}": ${e.message}. Install Claude Code (https://claude.com/claude-code) or set MANGO_CLAUDE_CLI to its full path.`,
        ),
      ),
    );
    child.on("close", (code) => {
      if (code !== 0 && !stdout.trim()) {
        return reject(
          new Error(
            `Claude CLI exited with ${code}: ${stderr.trim() || "(no stderr)"}`,
          ),
        );
      }
      let parsed: ClaudeCliResult;
      try {
        parsed = JSON.parse(stdout.trim()) as ClaudeCliResult;
      } catch (e) {
        return reject(
          new Error(
            `Claude CLI output was not valid JSON: ${e instanceof Error ? e.message : String(e)}. First 200 chars: ${stdout.slice(0, 200)}`,
          ),
        );
      }
      if (parsed.is_error) {
        return reject(
          new Error(
            `Claude CLI reported an error: ${parsed.result ?? "(no detail)"}`,
          ),
        );
      }
      const text = typeof parsed.result === "string" ? parsed.result : "";
      const modelOut =
        parsed.modelUsage && Object.keys(parsed.modelUsage)[0]
          ? (Object.keys(parsed.modelUsage)[0] as string)
          : (modelId ?? "claude");
      resolve({ text, model: modelOut });
    });
    child.stdin.write(userPrompt);
    child.stdin.end();
  });
};

export interface ClaudeCodeBuildOptions {
  model?: string;
  cliPath?: string | null;
}

export const buildClaudeCodeProvider = (
  opts: ClaudeCodeBuildOptions = {},
): AiProvider => {
  const model = opts.model ?? process.env.AI_MODEL ?? "sonnet";
  const cli = locateCli(opts.cliPath);
  const authFound = detectClaudeAuth();

  const setupHint = !cli.found
    ? cli.source === "override" || cli.source === "env"
      ? `Claude Code CLI path "${cli.command}" does not exist. Set the full path in AI settings or MANGO_CLAUDE_CLI.`
      : "Install the Claude Code CLI (https://claude.com/claude-code) and log in once. Mango checks common locations and PATH, and you can set the full path in AI settings or MANGO_CLAUDE_CLI."
    : authFound
      ? `Claude Code CLI found at ${cli.command}. Mango will spawn it for each request.`
      : `Claude Code CLI found at ${cli.command}. Set ANTHROPIC_API_KEY, or run the CLI once to log in.`;

  return {
    name: "claude-code",
    configured: cli.found && authFound,
    model,
    setupHint,
    async validate(): Promise<Record<string, string | number | boolean | null>> {
      const detection = await detectClaudeCli(cli.command);
      if (!detection.ok) throw new Error(detection.error ?? "Claude Code CLI not found.");
      return {
        cliPath: detection.path,
        cliVersion: detection.version,
        modelSource: "built-in Claude Code model catalog",
      };
    },
    async listModels(): Promise<ModelOption[]> {
      return FALLBACK_MODELS;
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
          ? `Conversation so far:\n\n${history}\n\nReply to the latest user message in markdown.`
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
