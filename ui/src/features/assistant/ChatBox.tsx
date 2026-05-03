import {
  IconAlertTriangle,
  IconLoader2,
  IconRefresh,
  IconSend,
  IconSettings,
  IconSparkles,
  IconTrash,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api } from "../../api/client";
import { AiSettingsModal } from "../connections/AiSettingsModal";
import { useActiveConnection } from "../connections/useActiveConnection";
import { useActiveDatabase } from "../connections/useActiveDatabase";
import {
  type AssistantMode,
  type ChatMessage,
  newMessageId,
  useAssistant,
} from "./AssistantContext";
import { CodeBlock } from "./CodeBlock";
import { Markdown } from "./Markdown";

const MODEL_PREF_KEY = (provider: string) => `mango:ai:model:${provider}`;

const SUGGESTIONS_BY_MODE: Record<AssistantMode, string[]> = {
  collection: [
    "Show recent documents",
    "Find docs missing the email field",
    "Status equals active",
  ],
  console: [
    "Count documents per status",
    "List indexes on this collection",
    "Top 10 by createdAt",
  ],
  shell: [
    "Run dbStats",
    "Show buildInfo",
    "Aggregate sample of 3 from users",
  ],
  general: [
    "What collections do I have?",
    "Show schema overview",
    "Suggest useful queries to explore this data",
  ],
  indexes: [
    "Suggest a covering index for the last query",
    "Are any of my indexes redundant?",
    "Why is this query a COLLSCAN?",
    "Best index for {status, createdAt desc}",
  ],
};

const modeBadge = (mode: AssistantMode, collection: string | null): string => {
  if (mode === "collection")
    return collection ? `Collection · ${collection}` : "Collection";
  if (mode === "console") return "Console";
  if (mode === "shell") return "Shell";
  if (mode === "indexes")
    return collection ? `Indexes · ${collection}` : "Indexes";
  return "General";
};

export const ChatBox = () => {
  const { activeId } = useActiveConnection();
  const { database } = useActiveDatabase();
  const {
    mode,
    collection,
    extraContext,
    messages,
    appendMessage,
    patchMessage,
    resetThread,
  } = useAssistant();

  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);

  const status = useStatus();
  const provider = status.data?.provider;
  const models = useModels(!!status.data?.configured);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  // Persisted model selection per provider
  useEffect(() => {
    if (!provider) return;
    const saved = window.localStorage.getItem(MODEL_PREF_KEY(provider));
    if (saved) setSelectedModel(saved);
    else if (status.data?.model) setSelectedModel(status.data.model);
  }, [provider, status.data?.model]);

  useEffect(() => {
    if (!provider || !models.data || !selectedModel) return;
    const isValid =
      models.data.length === 0 || models.data.some((m) => m.id === selectedModel);
    if (!isValid && models.data.length > 0) {
      setSelectedModel(models.data[0]?.id ?? null);
    }
  }, [models.data, selectedModel, provider]);

  // Autoscroll on new messages
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, messages[messages.length - 1]?.content]);

  const updateModel = (id: string) => {
    setSelectedModel(id);
    if (provider) window.localStorage.setItem(MODEL_PREF_KEY(provider), id);
  };

  const onSend = async () => {
    const content = draft.trim();
    if (!content || pending) return;
    if (!status.data?.configured) {
      setConfigOpen(true);
      return;
    }
    const userMsg: ChatMessage = {
      id: newMessageId(),
      role: "user",
      content,
    };
    appendMessage(userMsg);
    const placeholder: ChatMessage = {
      id: newMessageId(),
      role: "assistant",
      content: "",
      pending: true,
    };
    appendMessage(placeholder);
    setDraft("");
    setPending(true);
    try {
      const history = [...messages, userMsg]
        .filter(
          (m): m is ChatMessage =>
            !m.pending && (m.role === "user" || m.role === "assistant"),
        )
        .map((m) => ({ role: m.role, content: m.content }));
      const result = await api.chatAi({
        mode,
        connectionId: activeId ?? undefined,
        database: database ?? undefined,
        collection: collection ?? undefined,
        model: selectedModel ?? undefined,
        context:
          extraContext.indexes || extraContext.explain
            ? {
                indexes: extraContext.indexes ?? undefined,
                explain: extraContext.explain ?? undefined,
              }
            : undefined,
        messages: history,
      });
      patchMessage(placeholder.id, {
        content: result.text,
        pending: false,
        meta: { provider: result.provider, model: result.model },
      });
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e);
      patchMessage(placeholder.id, {
        content: "",
        pending: false,
        error: msg,
      });
    } finally {
      setPending(false);
      // Refocus composer for fast follow-up
      composerRef.current?.focus();
    }
  };

  const suggestions = useMemo(() => SUGGESTIONS_BY_MODE[mode], [mode]);

  const notConfigured = status.data && !status.data.configured;

  return (
    <div className="flex h-full flex-col">
      {/* Slim context badge bar */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-white/60 px-3 py-1.5 text-[11px] dark:border-slate-800 dark:bg-slate-900/60">
        <span className="rounded bg-violet-500/15 px-1.5 py-0.5 font-medium text-violet-700 dark:bg-violet-500/20 dark:text-violet-200">
          {modeBadge(mode, collection)}
        </span>
        {database && (
          <span className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-slate-700 dark:bg-slate-800 dark:text-slate-200">
            {database}
          </span>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={resetThread}
          disabled={messages.length === 0}
          className="flex items-center gap-1 rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-900 disabled:opacity-30 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          title="Clear chat"
        >
          <IconTrash size={12} />
        </button>
      </div>

      {notConfigured && (
        <div className="mx-3 mt-3 flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200">
          <IconAlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <div className="font-medium">
              {status.data!.provider} is not configured.
            </div>
            <div className="mt-0.5 text-amber-700 dark:text-amber-300">
              {status.data!.setupHint}
            </div>
            <button
              type="button"
              onClick={() => setConfigOpen(true)}
              className="mt-2 inline-flex items-center gap-1 rounded bg-amber-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-amber-500"
            >
              <IconSparkles size={11} />
              Configure
            </button>
          </div>
        </div>
      )}

      {/* Message list */}
      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-3 py-3">
        {messages.length === 0 ? (
          <EmptyHints
            mode={mode}
            collection={collection}
            suggestions={suggestions}
            onPick={(s) => setDraft(s)}
          />
        ) : (
          <div className="space-y-3">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
          </div>
        )}
      </div>

      {/* Composer + footer (model/settings below, VSCode-style) */}
      <div className="border-t border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
        <div className="p-2">
          <div className="flex items-end gap-2 rounded-lg border border-slate-300 bg-white px-2 py-1.5 focus-within:border-violet-500 dark:border-slate-700 dark:bg-slate-950">
            <textarea
              ref={composerRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  onSend();
                }
              }}
              rows={2}
              placeholder={
                mode === "shell"
                  ? "Ask the assistant or describe a runCommand…"
                  : mode === "console"
                    ? "Ask the assistant or describe a query…"
                    : mode === "collection"
                      ? `Ask anything about ${collection ?? "this collection"}…`
                      : mode === "indexes"
                        ? `Ask about index strategy for ${collection ?? "this collection"}…`
                        : "Ask Mango anything…"
              }
              className="max-h-48 min-h-[48px] flex-1 resize-none bg-transparent text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
            />
            <button
              type="button"
              onClick={onSend}
              disabled={!draft.trim() || pending}
              className="flex h-8 items-center justify-center rounded-md bg-violet-500 px-3 text-white hover:bg-violet-400 disabled:opacity-50"
              title="Send (Enter)"
            >
              {pending ? (
                <IconLoader2 size={14} className="animate-spin" />
              ) : (
                <IconSend size={14} />
              )}
            </button>
          </div>
        </div>

        {/* Footer: model selector + provider settings (below composer, like VSCode) */}
        <div className="flex items-center gap-1.5 border-t border-slate-200 px-2 py-1.5 text-[11px] dark:border-slate-800">
          <select
            value={selectedModel ?? ""}
            onChange={(e) => updateModel(e.target.value)}
            disabled={!status.data?.configured || models.isLoading}
            className="min-w-0 max-w-[200px] flex-1 truncate rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-900 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            title={selectedModel ?? ""}
          >
            {!status.data?.configured && <option value="">no model</option>}
            {models.isLoading && <option>loading…</option>}
            {!models.isLoading &&
              models.data &&
              models.data.length > 0 &&
              models.data.map((m) => (
                <option key={m.id} value={m.id} title={m.description}>
                  {m.name ?? m.id}
                </option>
              ))}
            {!models.isLoading &&
              (!models.data || models.data.length === 0) &&
              status.data?.configured && (
                <option value={status.data.model}>{status.data.model}</option>
              )}
          </select>
          {status.data?.provider && (
            <span className="hidden truncate text-[10px] text-slate-500 dark:text-slate-400 sm:inline">
              {status.data.provider}
            </span>
          )}
          <div className="flex-1" />
          <span className="text-[10px] text-slate-400 dark:text-slate-500">
            <kbd className="rounded border border-slate-300 px-1 dark:border-slate-700">
              ↵
            </kbd>{" "}
            send ·{" "}
            <kbd className="rounded border border-slate-300 px-1 dark:border-slate-700">
              ⇧↵
            </kbd>{" "}
            newline
          </span>
          <button
            type="button"
            onClick={() => setConfigOpen(true)}
            className="rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            title="AI provider settings"
          >
            <IconSettings size={13} />
          </button>
        </div>
      </div>

      {configOpen && <AiSettingsModal onClose={() => setConfigOpen(false)} />}
    </div>
  );
};

const useStatus = () => {
  // Wired via react-query so AiSettingsModal's invalidate calls refresh us.
  const q = useQuery({
    queryKey: ["ai-status"],
    queryFn: () => api.getAiStatus(),
    staleTime: 30_000,
  });
  return { data: q.data ?? null };
};

const useModels = (enabled: boolean) => {
  const q = useQuery({
    queryKey: ["ai-models"],
    queryFn: async () => {
      try {
        return (await api.listAiModels()).models;
      } catch {
        return [];
      }
    },
    enabled,
    staleTime: 60_000,
  });
  return { data: q.data ?? null, isLoading: q.isLoading };
};

interface BubbleProps {
  message: {
    id: string;
    role: "user" | "assistant";
    content: string;
    pending?: boolean;
    error?: string;
    meta?: { provider: string; model: string };
  };
}

const MessageBubble = ({ message }: BubbleProps) => {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={[
          "max-w-[92%] rounded-2xl px-3 py-2 shadow-sm",
          isUser
            ? "rounded-br-sm bg-violet-500 text-white dark:bg-violet-600"
            : "rounded-bl-sm bg-slate-100 text-slate-800 dark:bg-slate-800/80 dark:text-slate-100",
        ].join(" ")}
      >
        {message.pending && !message.content ? (
          <div className="flex items-center gap-2 text-[12px] text-slate-500 dark:text-slate-400">
            <IconLoader2 size={12} className="animate-spin" />
            Thinking…
          </div>
        ) : message.error ? (
          <div className="text-[12.5px] text-red-700 dark:text-red-300">
            {message.error}
          </div>
        ) : isUser ? (
          <div className="whitespace-pre-wrap text-[13px] leading-relaxed">
            {message.content}
          </div>
        ) : (
          <>
            <Markdown
              text={message.content}
              renderCodeBlock={(lang, code) => (
                <CodeBlock lang={lang} code={code} />
              )}
            />
            {message.meta && (
              <div className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                {message.meta.provider} · {message.meta.model}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

interface EmptyHintsProps {
  mode: AssistantMode;
  collection: string | null;
  suggestions: string[];
  onPick: (s: string) => void;
}

const EmptyHints = ({ mode, collection, suggestions, onPick }: EmptyHintsProps) => (
  <div className="flex h-full flex-col items-center justify-center gap-3 px-2 text-center">
    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-500/15 text-violet-600 dark:bg-violet-500/20 dark:text-violet-300">
      <IconSparkles size={20} />
    </div>
    <div>
      <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
        Mango Assistant
      </div>
      <div className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">
        {mode === "collection"
          ? `Ask anything about ${collection ?? "this collection"}.`
          : mode === "console"
            ? "Generate console commands or explore your data."
            : mode === "shell"
              ? "Get help building runCommand documents."
              : mode === "indexes"
                ? `Optimize indexes and queries for ${collection ?? "this collection"}. The assistant sees your current indexes and the latest explain output.`
                : "Pick a database or collection to focus the conversation."}
      </div>
    </div>
    <div className="flex flex-wrap items-center justify-center gap-1.5">
      {suggestions.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onPick(s)}
          className="rounded-full border border-slate-300 px-2.5 py-1 text-[11.5px] text-slate-600 hover:border-violet-400 hover:bg-violet-50 hover:text-violet-700 dark:border-slate-700 dark:text-slate-300 dark:hover:border-violet-500/40 dark:hover:bg-violet-900/20 dark:hover:text-violet-200"
        >
          {s}
        </button>
      ))}
    </div>
    <div className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
      <IconRefresh size={10} className="mb-0.5 mr-0.5 inline" />
      Code blocks tagged{" "}
      <code className="font-mono">mango-filter</code> /{" "}
      <code className="font-mono">mango-console</code> /{" "}
      <code className="font-mono">mango-shell</code> get an Apply button.
    </div>
  </div>
);
