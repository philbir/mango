import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
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
  { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", vendor: "anthropic" },
  { id: "claude-opus-4-5", name: "Claude Opus 4.5", vendor: "anthropic" },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", vendor: "anthropic" },
];

// Locate the user's `claude` CLI: their installed Claude Code, ideally on PATH
// or in the well-known per-user install location. We invoke it as a subprocess
// instead of using `@anthropic-ai/claude-agent-sdk` so the desktop sidecar (a
// bun-compiled single binary) doesn't have to ship the 70MB SDK + bundled
// CLI + ripgrep + wasm tree as Tauri resources.
const locateCli = (): string | null => {
  if (process.env.MANGO_CLAUDE_CLI && existsSync(process.env.MANGO_CLAUDE_CLI)) {
    return process.env.MANGO_CLAUDE_CLI;
  }
  const candidates = [
    path.join(homedir(), ".claude", "local", "claude"),
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
    path.join(homedir(), ".local", "bin", "claude"),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  // Fall back to PATH resolution at spawn time.
  return "claude";
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
}

export const buildClaudeCodeProvider = (
  opts: ClaudeCodeBuildOptions = {},
): AiProvider => {
  const model = opts.model ?? process.env.AI_MODEL ?? "sonnet";
  const cliPath = locateCli();
  const cliFound = cliPath !== null && cliPath !== "claude" && existsSync(cliPath);

  return {
    name: "claude-code",
    configured: detectClaudeAuth(),
    model,
    setupHint: cliFound
      ? "Either set ANTHROPIC_API_KEY, or run the Claude Code CLI once to log in (creds at ~/.claude). Mango will spawn the CLI for each request."
      : "Install the Claude Code CLI (https://claude.com/claude-code) and log in once. Mango spawns `claude` as a subprocess — set MANGO_CLAUDE_CLI to override the binary path.",
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
        cliPath ?? "claude",
      );
      return { text, model: modelOut };
    },
  };
};
