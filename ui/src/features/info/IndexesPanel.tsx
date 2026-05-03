import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconAlertCircle,
  IconKey,
  IconPlus,
  IconRefresh,
  IconSparkles,
  IconTrash,
} from "@tabler/icons-react";
import { useState } from "react";
import {
  ApiError,
  type IndexInfo,
  api,
  stringifyEJSON,
} from "../../api/client";
import { useAssistant } from "../assistant/AssistantContext";
import { CreateIndexModal } from "./CreateIndexModal";

interface Props {
  cid: string;
  database: string | null;
  collection: string;
  /** Used by the parent to build the assistant context payload. */
  onIndexesChange?: (indexes: IndexInfo[]) => void;
}

export const renderIndexesForPrompt = (indexes: IndexInfo[]): string =>
  indexes
    .map((ix) => {
      const flags: string[] = [];
      if (ix.unique) flags.push("unique");
      if (ix.sparse) flags.push("sparse");
      if (ix.hidden) flags.push("hidden");
      if (ix.expireAfterSeconds !== null)
        flags.push(`ttl=${ix.expireAfterSeconds}s`);
      const flagText = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
      const ops = ix.ops !== null ? ` (used ${ix.ops} times)` : "";
      return `- ${ix.name}: ${stringifyEJSON(ix.key, false)}${flagText}${ops}`;
    })
    .join("\n");

export const IndexesPanel = ({
  cid,
  database,
  collection,
  onIndexesChange,
}: Props) => {
  const qc = useQueryClient();
  const { setOpen: setAssistantOpen } = useAssistant();
  const [createOpen, setCreateOpen] = useState(false);

  const indexes = useQuery({
    queryKey: ["collection-indexes", cid, database, collection],
    queryFn: async () => {
      const r = await api.getCollectionIndexes(
        cid,
        collection,
        database ?? undefined,
      );
      onIndexesChange?.(r.indexes);
      return r;
    },
    enabled: !!cid && !!collection,
  });

  const drop = useMutation({
    mutationFn: (name: string) =>
      api.dropIndex(cid, collection, name, database ?? undefined),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["collection-indexes", cid, database, collection],
      });
      qc.invalidateQueries({
        queryKey: ["collection-stats", cid, database, collection],
      });
    },
  });

  const onAskAi = () => {
    setAssistantOpen(true);
    // The CollectionView InfoView passes the indexes as context for the
    // assistant via the binding — opening the panel is enough.
  };

  if (indexes.isLoading) {
    return (
      <div className="p-6 text-sm text-slate-500 dark:text-slate-400">
        Loading indexes…
      </div>
    );
  }
  if (indexes.isError) {
    return (
      <div className="m-5 flex items-start gap-2 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
        <IconAlertCircle size={16} className="mt-0.5 flex-shrink-0" />
        <div>{(indexes.error as Error).message}</div>
      </div>
    );
  }

  const data = indexes.data;
  if (!data) return null;

  return (
    <div className="p-5">
      <header className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
            <IconKey size={16} className="text-violet-500 dark:text-violet-300" />
            Indexes
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {data.indexes.length} index{data.indexes.length === 1 ? "" : "es"}
            {data.usageAvailable ? " · usage stats from $indexStats" : ""}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onAskAi}
            className="flex items-center gap-1 rounded border border-violet-300 bg-violet-50 px-2 py-1 text-[11px] font-medium text-violet-700 hover:bg-violet-100 dark:border-violet-500/40 dark:bg-violet-900/20 dark:text-violet-200 dark:hover:bg-violet-900/30"
            title="Ask the assistant about index strategy"
          >
            <IconSparkles size={11} />
            Optimize with AI
          </button>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <IconPlus size={11} />
            New index
          </button>
          <button
            type="button"
            onClick={() => indexes.refetch()}
            disabled={indexes.isFetching}
            className="rounded border border-slate-300 p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
            title="Refresh"
          >
            <IconRefresh
              size={12}
              className={indexes.isFetching ? "animate-spin" : ""}
            />
          </button>
        </div>
      </header>

      <div className="overflow-hidden rounded border border-slate-200 dark:border-slate-700">
        <table className="w-full text-[12.5px]">
          <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-900 dark:text-slate-400">
            <tr>
              <th className="px-3 py-1.5">Name</th>
              <th className="px-3 py-1.5">Key</th>
              <th className="px-3 py-1.5">Properties</th>
              {data.usageAvailable && (
                <th className="px-3 py-1.5 text-right">Usage</th>
              )}
              <th className="w-10 px-3 py-1.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-800 dark:bg-slate-900/40">
            {data.indexes.map((ix) => (
              <IndexRow
                key={ix.name}
                index={ix}
                usageAvailable={data.usageAvailable}
                onDrop={() => {
                  if (
                    confirm(
                      `Drop index "${ix.name}"? This cannot be undone — and queries using it may slow down.`,
                    )
                  ) {
                    drop.mutate(ix.name);
                  }
                }}
                disabled={drop.isPending}
              />
            ))}
          </tbody>
        </table>
      </div>

      {drop.error instanceof ApiError && (
        <div className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
          {drop.error.message}
        </div>
      )}

      {createOpen && (
        <CreateIndexModal
          cid={cid}
          database={database}
          collection={collection}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            qc.invalidateQueries({
              queryKey: ["collection-indexes", cid, database, collection],
            });
            qc.invalidateQueries({
              queryKey: ["collection-stats", cid, database, collection],
            });
            setCreateOpen(false);
          }}
        />
      )}
    </div>
  );
};

interface RowProps {
  index: IndexInfo;
  usageAvailable: boolean;
  onDrop: () => void;
  disabled?: boolean;
}

const IndexRow = ({ index, usageAvailable, onDrop, disabled }: RowProps) => {
  const isId = index.name === "_id_";
  const props: string[] = [];
  if (index.unique) props.push("unique");
  if (index.sparse) props.push("sparse");
  if (index.hidden) props.push("hidden");
  if (index.expireAfterSeconds !== null)
    props.push(`TTL ${index.expireAfterSeconds}s`);
  if (index.partialFilterExpression) props.push("partial");
  if (index.collation) props.push("collation");

  return (
    <tr>
      <td className="px-3 py-1.5 font-mono text-slate-900 dark:text-slate-100">
        {index.name}
      </td>
      <td className="px-3 py-1.5">
        <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11.5px] text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {Object.entries(index.key)
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ")}
        </code>
      </td>
      <td className="px-3 py-1.5 text-slate-600 dark:text-slate-300">
        {props.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {props.map((p) => (
              <span
                key={p}
                className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              >
                {p}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </td>
      {usageAvailable && (
        <td className="px-3 py-1.5 text-right tabular-nums text-slate-700 dark:text-slate-300">
          {index.ops !== null ? index.ops.toLocaleString() : "—"}
        </td>
      )}
      <td className="px-3 py-1.5 text-right">
        {!isId && (
          <button
            type="button"
            onClick={onDrop}
            disabled={disabled}
            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 dark:hover:bg-red-900/20 dark:hover:text-red-400"
            title="Drop index"
          >
            <IconTrash size={12} />
          </button>
        )}
      </td>
    </tr>
  );
};
