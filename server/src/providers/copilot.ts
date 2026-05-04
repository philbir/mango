import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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
const locateCli = (): string | null => {
  if (process.env.MANGO_COPILOT_CLI && existsSync(process.env.MANGO_COPILOT_CLI)) {
    return process.env.MANGO_COPILOT_CLI;
  }
  const candidates = [
    "/opt/homebrew/bin/copilot",
    "/usr/local/bin/copilot",
    path.join(homedir(), ".local", "bin", "copilot"),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  // Fall back to PATH resolution at spawn time.
  return "copilot";
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
}

export const buildCopilotProvider = (
  opts: CopilotBuildOptions = {},
): AiProvider => {
  const model = opts.model ?? process.env.AI_MODEL ?? "claude-sonnet-4.5";
  const cliPath = locateCli();
  const cliFound = cliPath !== null && cliPath !== "copilot" && existsSync(cliPath);

  return {
    name: "copilot",
    configured: detectCopilotAuth(),
    model,
    setupHint: cliFound
      ? "Either set GITHUB_TOKEN with Copilot access, or run `copilot` once to log in. Mango will spawn the CLI for each request."
      : "Install the GitHub Copilot CLI (https://docs.github.com/copilot/github-copilot-cli) and log in once. Mango spawns `copilot` as a subprocess — set MANGO_COPILOT_CLI to override the binary path.",
    async listModels(): Promise<ModelOption[]> {
      // Copilot's CLI doesn't expose a non-interactive `model list` — fall
      // back to a static set covering the commonly-available SKUs.
      return [
        { id: "gpt-5", name: "GPT-5" },
        { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
        { id: "claude-sonnet-4", name: "Claude Sonnet 4" },
        { id: "gpt-4o", name: "GPT-4o" },
      ];
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
        cliPath ?? "copilot",
      );
      return { text, model: modelOut };
    },
  };
};
