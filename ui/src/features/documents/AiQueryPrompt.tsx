import { useMutation, useQuery } from "@tanstack/react-query";
import {
  IconAlertTriangle,
  IconRefresh,
  IconSparkles,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { ApiError, api, stringifyEJSON } from "../../api/client";
import { useActiveConnection } from "../connections/useActiveConnection";

const SUGGESTIONS = [
  "all documents created in the last 30 days",
  "where status is open or in progress",
  "missing the email field",
  "name contains \"smith\" (case-insensitive)",
  "address city is Zurich",
];

const MODEL_PREF_KEY = (provider: string) =>
  `mango:ai:model:${provider}`;

interface Props {
  collectionName: string;
  onApply: (filterJson: string) => void;
}

export const AiQueryPrompt = ({ collectionName, onApply }: Props) => {
  const { activeId } = useActiveConnection();
  const [prompt, setPrompt] = useState("");
  const [selectedModel, setSelectedModel] = useState<string | null>(null);

  const status = useQuery({
    queryKey: ["ai-status"],
    queryFn: () => api.getAiStatus(),
    staleTime: 60_000,
  });

  const provider = status.data?.provider;

  const models = useQuery({
    queryKey: ["ai-models", provider],
    queryFn: () => api.listAiModels(),
    enabled: !!status.data?.configured,
    staleTime: 5 * 60_000,
  });

  // Load persisted model preference per provider, fall back to provider default
  useEffect(() => {
    if (!provider) return;
    const saved = window.localStorage.getItem(MODEL_PREF_KEY(provider));
    if (saved) {
      setSelectedModel(saved);
    } else if (status.data?.model) {
      setSelectedModel(status.data.model);
    }
  }, [provider, status.data?.model]);

  // If the saved model isn't in the available list, fall back to default
  useEffect(() => {
    if (!provider || !models.data || !selectedModel) return;
    const isValid =
      models.data.models.length === 0 ||
      models.data.models.some((m) => m.id === selectedModel);
    if (!isValid) {
      setSelectedModel(models.data.default);
    }
  }, [models.data, selectedModel, provider]);

  const updateModel = (id: string) => {
    setSelectedModel(id);
    if (provider) {
      window.localStorage.setItem(MODEL_PREF_KEY(provider), id);
    }
  };

  const mutation = useMutation({
    mutationFn: () => {
      if (!activeId) throw new Error("No active connection.");
      return api.runAiQuery({
        connectionId: activeId,
        collection: collectionName,
        prompt: prompt.trim(),
        model: selectedModel ?? undefined,
      });
    },
    onSuccess: (result) => {
      const json = stringifyEJSON(result.filter);
      onApply(json);
    },
  });

  if (status.isLoading) {
    return (
      <div className="text-sm text-slate-500 dark:text-slate-400">
        Checking AI status…
      </div>
    );
  }

  if (status.data && !status.data.configured) {
    return (
      <div className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200">
        <IconAlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
        <div>
          <div className="mb-1 font-medium">
            AI ({status.data.provider}) is not configured.
          </div>
          <div className="text-amber-700 dark:text-amber-300">
            {status.data.setupHint}
            <br />
            From Aspire, set the matching{" "}
            <code className="font-mono">MongoManager:Ai:*</code> values via{" "}
            <code className="font-mono">dotnet user-secrets</code> in the
            AppHost. Switch providers with{" "}
            <code className="font-mono">AI_PROVIDER=openai|copilot</code>.
          </div>
        </div>
      </div>
    );
  }

  const onGenerate = () => {
    if (!prompt.trim()) return;
    mutation.mutate();
  };

  const errorMessage =
    mutation.error instanceof ApiError
      ? mutation.error.message
      : mutation.error instanceof Error
        ? mutation.error.message
        : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-500">
          Model
        </span>
        <select
          value={selectedModel ?? ""}
          onChange={(e) => updateModel(e.target.value)}
          disabled={models.isLoading}
          className="rounded border border-slate-300 bg-white px-2 py-0.5 font-mono text-[11px] text-slate-900 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          {models.isLoading && <option>loading…</option>}
          {!models.isLoading &&
            models.data?.models &&
            models.data.models.length > 0 &&
            models.data.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name && m.name !== m.id ? `${m.name} — ${m.id}` : m.id}
                {m.description ? ` · ${m.description}` : ""}
              </option>
            ))}
          {!models.isLoading &&
            (!models.data?.models || models.data.models.length === 0) &&
            status.data && (
              <option value={status.data.model}>{status.data.model}</option>
            )}
        </select>
        <button
          type="button"
          onClick={() => models.refetch()}
          className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          title="Refresh models"
        >
          <IconRefresh
            size={12}
            className={models.isFetching ? "animate-spin" : ""}
          />
        </button>
        {models.data?.error && (
          <span className="text-[10px] text-amber-600 dark:text-amber-400">
            (couldn't list models — defaults shown)
          </span>
        )}
      </div>

      <div className="flex items-stretch gap-2">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onGenerate();
            }
          }}
          placeholder={`Describe the query in plain English… e.g. "${SUGGESTIONS[0]}"`}
          rows={2}
          className="flex-1 resize-y rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
        <button
          type="button"
          onClick={onGenerate}
          disabled={!prompt.trim() || mutation.isPending}
          className="flex items-center gap-1.5 self-start rounded bg-violet-500 px-3 py-2 text-sm font-medium text-white hover:bg-violet-400 disabled:opacity-50"
          title="Generate filter (⌘/Ctrl + Enter)"
        >
          <IconSparkles size={14} />
          {mutation.isPending ? "Thinking…" : "Generate"}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-500">
          Try
        </span>
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setPrompt(s)}
            className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {s}
          </button>
        ))}
      </div>
      {errorMessage && (
        <div className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
          {errorMessage}
        </div>
      )}
      {mutation.data && (
        <div className="rounded border border-violet-300 bg-violet-50 p-2 text-xs text-violet-800 dark:border-violet-700/40 dark:bg-violet-900/20 dark:text-violet-200">
          <div className="font-medium">
            Applied · {mutation.data.provider} · {mutation.data.model}
          </div>
          <div className="mt-0.5 text-violet-700 dark:text-violet-300">
            {mutation.data.explanation}
          </div>
        </div>
      )}
    </div>
  );
};
