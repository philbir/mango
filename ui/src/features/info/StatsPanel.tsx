import { useQuery } from "@tanstack/react-query";
import {
  IconAlertCircle,
  IconCalendarStats,
  IconDatabase,
  IconLockSquareRounded,
  IconRefresh,
  IconServerCog,
  IconStack2,
} from "@tabler/icons-react";
import { api } from "../../api/client";

interface Props {
  cid: string;
  database: string | null;
  collection: string;
}

const formatBytes = (n: number | null): string => {
  if (n === null || n === undefined) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
};

const formatCount = (n: number | null): string =>
  n === null || n === undefined ? "—" : n.toLocaleString();

export const StatsPanel = ({ cid, database, collection }: Props) => {
  const stats = useQuery({
    queryKey: ["collection-stats", cid, database, collection],
    queryFn: () =>
      api.getCollectionStats(cid, collection, database ?? undefined),
    enabled: !!cid && !!collection,
  });

  if (stats.isLoading) {
    return (
      <div className="p-6 text-sm text-slate-500 dark:text-slate-400">
        Loading stats…
      </div>
    );
  }

  if (stats.isError) {
    return (
      <div className="m-5 flex items-start gap-2 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
        <IconAlertCircle size={16} className="mt-0.5 flex-shrink-0" />
        <div>{(stats.error as Error).message}</div>
      </div>
    );
  }

  const data = stats.data;
  if (!data) return null;

  return (
    <div className="space-y-5 p-5">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Collection statistics
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            From <span className="font-mono">collStats</span>. Storage figures
            reflect on-disk usage.
          </p>
        </div>
        <button
          type="button"
          onClick={() => stats.refetch()}
          disabled={stats.isFetching}
          className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <IconRefresh
            size={12}
            className={stats.isFetching ? "animate-spin" : ""}
          />
          Refresh
        </button>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card
          icon={<IconDatabase size={14} />}
          label="Documents"
          value={formatCount(data.count)}
          accent="sky"
        />
        <Card
          icon={<IconStack2 size={14} />}
          label="Data size"
          value={formatBytes(data.size)}
          accent="emerald"
        />
        <Card
          icon={<IconServerCog size={14} />}
          label="Storage size"
          value={formatBytes(data.storageSize)}
          subtitle="Compressed on disk"
        />
        <Card
          icon={<IconCalendarStats size={14} />}
          label="Avg doc size"
          value={formatBytes(data.avgObjSize)}
        />
        <Card
          icon={<IconLockSquareRounded size={14} />}
          label="Indexes"
          value={String(data.indexCount)}
          subtitle={`${formatBytes(data.totalIndexSize)} total`}
          accent="violet"
        />
        <Card
          label="Total size"
          value={formatBytes(data.totalSize)}
          subtitle="Data + indexes"
        />
        <Card
          label="Capped"
          value={data.capped ? "Yes" : "No"}
          subtitle={data.capped && data.max !== null ? `max ${data.max}` : undefined}
        />
        <Card
          label="Sharded"
          value={data.sharded ? "Yes" : "No"}
        />
      </div>

      {Object.keys(data.indexSizes).length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Index sizes
          </h3>
          <div className="overflow-hidden rounded border border-slate-200 dark:border-slate-700">
            <table className="w-full text-[12.5px]">
              <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-1.5">Name</th>
                  <th className="px-3 py-1.5 text-right">Size</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-800 dark:bg-slate-900/40">
                {Object.entries(data.indexSizes).map(([n, size]) => (
                  <tr key={n}>
                    <td className="px-3 py-1.5 font-mono">{n}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {formatBytes(size as number)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
};

interface CardProps {
  icon?: React.ReactNode;
  label: string;
  value: string;
  subtitle?: string;
  accent?: "sky" | "emerald" | "violet";
}

const Card = ({ icon, label, value, subtitle, accent }: CardProps) => {
  const accentClass =
    accent === "sky"
      ? "text-sky-600 dark:text-sky-300"
      : accent === "emerald"
        ? "text-emerald-600 dark:text-emerald-300"
        : accent === "violet"
          ? "text-violet-600 dark:text-violet-300"
          : "text-slate-600 dark:text-slate-300";
  return (
    <div className="rounded border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/60">
      <div className="flex items-center gap-1 text-[10.5px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {icon && <span className={accentClass}>{icon}</span>}
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">
        {value}
      </div>
      {subtitle && (
        <div className="text-[11px] text-slate-500 dark:text-slate-400">
          {subtitle}
        </div>
      )}
    </div>
  );
};
