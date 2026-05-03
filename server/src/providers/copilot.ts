import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  type AiChatInput,
  type AiChatResult,
  type AiProvider,
  type ModelOption,
} from "./types.js";

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

let cachedClient: unknown = null;

const getClient = async () => {
  if (cachedClient) return cachedClient;
  const sdk = await import("@github/copilot-sdk").catch((e) => {
    throw new Error(
      `Could not load @github/copilot-sdk: ${e instanceof Error ? e.message : String(e)}`,
    );
  });
  const ClientCtor = (sdk as { CopilotClient: new (opts: object) => unknown })
    .CopilotClient;
  const client = new ClientCtor({
    gitHubToken: process.env.GITHUB_TOKEN || undefined,
  }) as { start: () => Promise<void> };
  await client.start();
  cachedClient = client;
  return cachedClient;
};

export interface CopilotBuildOptions {
  model?: string;
}

export const buildCopilotProvider = (
  opts: CopilotBuildOptions = {},
): AiProvider => {
  const model = opts.model ?? process.env.AI_MODEL ?? "claude-sonnet-4.5";

  return {
    name: "copilot",
    configured: detectCopilotAuth(),
    model,
    setupHint:
      "Either set GITHUB_TOKEN with Copilot access, or run the Copilot CLI once to log in. The SDK will then authenticate automatically.",
    async listModels(): Promise<ModelOption[]> {
      try {
        const client = (await getClient()) as {
          listModels: () => Promise<
            Array<{
              id: string;
              name?: string;
              billing?: { multiplier?: number };
              policy?: { state?: string };
            }>
          >;
        };
        const models = await client.listModels();
        return models
          .map((m) => ({
            id: m.id,
            name: m.name ?? m.id,
            description:
              typeof m.billing?.multiplier === "number"
                ? `${m.billing.multiplier}×`
                : undefined,
          }))
          .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
      } catch {
        return [
          { id: "gpt-5", name: "GPT-5" },
          { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
          { id: "gpt-4o", name: "GPT-4o" },
        ];
      }
    },
    async chat(input: AiChatInput): Promise<AiChatResult> {
      const sdk = await import("@github/copilot-sdk").catch((e) => {
        throw new Error(
          `Could not load @github/copilot-sdk: ${e instanceof Error ? e.message : String(e)}`,
        );
      });
      const client = (await getClient()) as {
        createSession: (cfg: object) => Promise<{
          on: (event: string, handler: (e: unknown) => void) => () => void;
          sendAndWait: (opts: { prompt: string }) => Promise<unknown>;
          disconnect: () => Promise<void>;
        }>;
      };
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
      const session = await client.createSession({
        model: useModel,
        onPermissionRequest: (sdk as { approveAll: unknown }).approveAll,
        systemMessage: {
          mode: "replace" as const,
          content: input.systemPrompt,
        },
      });
      let lastMessage = "";
      session.on("assistant.message", (event: unknown) => {
        const data = (event as { data?: { content?: string } }).data;
        if (data?.content) lastMessage = data.content;
      });
      try {
        await session.sendAndWait({
          prompt:
            input.messages.length > 1
              ? `Conversation so far:\n\n${history}\n\nReply to the latest user message.`
              : lastUser.content,
        });
      } finally {
        await session.disconnect().catch(() => {});
      }
      return { text: lastMessage, model: useModel };
    },
  };
};
