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
  {
    id: "claude-sonnet-4-5",
    name: "Claude Sonnet 4.5",
    vendor: "anthropic",
  },
  {
    id: "claude-opus-4-5",
    name: "Claude Opus 4.5",
    vendor: "anthropic",
  },
  {
    id: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    vendor: "anthropic",
  },
];

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

interface SdkResultMessage {
  type: "result";
  subtype?: string;
  result?: string;
  is_error?: boolean;
}

const runQuery = async (
  systemPrompt: string,
  userPrompt: string,
  modelId: string | undefined,
): Promise<{ text: string; model: string }> => {
  const sdk = await import("@anthropic-ai/claude-agent-sdk").catch((e) => {
    throw new Error(
      `Could not load @anthropic-ai/claude-agent-sdk: ${e instanceof Error ? e.message : String(e)}`,
    );
  });
  const queryFn = (
    sdk as unknown as {
      query: (params: {
        prompt: string;
        options?: Record<string, unknown>;
      }) => AsyncIterable<unknown>;
    }
  ).query;

  let resultText = "";
  let modelOut = modelId ?? "";
  for await (const msg of queryFn({
    prompt: userPrompt,
    options: {
      systemPrompt,
      model: modelId,
      tools: [],
      allowedTools: [],
      maxTurns: 1,
      permissionMode: "default",
    },
  })) {
    const m = msg as SdkResultMessage & { model?: string };
    if (m.type === "result") {
      if (m.is_error) {
        throw new Error(
          `Claude Agent SDK reported an error: ${m.result ?? "(no detail)"}`,
        );
      }
      if (typeof m.result === "string") resultText = m.result;
      if (typeof m.model === "string") modelOut = m.model;
    }
  }

  if (!resultText) {
    throw new Error("Claude Agent SDK returned no result.");
  }
  return { text: resultText, model: modelOut || modelId || "claude" };
};

export interface ClaudeCodeBuildOptions {
  model?: string;
}

export const buildClaudeCodeProvider = (
  opts: ClaudeCodeBuildOptions = {},
): AiProvider => {
  const model = opts.model ?? process.env.AI_MODEL ?? "sonnet";

  return {
    name: "claude-code",
    configured: detectClaudeAuth(),
    model,
    setupHint:
      "Either set ANTHROPIC_API_KEY, or run the Claude Code CLI once to log in (creds at ~/.claude). The SDK then authenticates automatically.",
    async listModels(): Promise<ModelOption[]> {
      return FALLBACK_MODELS;
    },
    async chat(input: AiChatInput): Promise<AiChatResult> {
      const useModel = input.model ?? model;
      const history = input.messages
        .map((m) =>
          m.role === "user"
            ? `User: ${m.content}`
            : `Assistant: ${m.content}`,
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
      );
      return { text, model: modelOut };
    },
  };
};
