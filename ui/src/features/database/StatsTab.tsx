import {
  IconAlertCircle,
  IconCalendarStats,
  IconDatabase,
  IconLockSquareRounded,
  IconRefresh,
  IconServerCog,
  IconStack2,
  IconTable,
} from "@tabler/icons-react";
import { useDatabaseStats } from "./useDatabaseStats";

interface Props {
  cid: string;
  database: string;
}

const formatBytes = (n: number | null | undefined): string => {
  if (n === null || n === undefined) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
};

const formatCount = (n: number | null | undefined): string =>
  n === null || n === undefined ? "—" : Number(n).toLocaleString();

export const StatsTab = ({ cid, database }: Props) => {
  const q = useDatabaseStats(cid, database);

  if (q.isLoading) {
    return (
      <div className="p-6 text-sm text-slate-500 dark:text-slate-400">
        Loading stats…
      </div>
    );
  }
  if (q.isError) {
    return (
      <div className="m-5 flex items-start gap-2 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
        <IconAlertCircle size={16} className="mt-0.5 flex-shrink-0" />
        <div>{(q.error as Error).message}</div>
      </div>
    );
  }
  const data = q.data;
  if (!data) return null;

  return (
    <div className="space-y-5 p-5">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Database statistics
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            From <span className="font-mono">dbStats</span> + per-collection{" "}
            <span className="font-mono">collStats</span>.
          </p>
        </div>
        <button
          type="button"
          onClick={() => q.refetch()}
          disabled={q.isFetching}
          className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <IconRefresh
            size={12}
            className={q.isFetching ? "animate-spin" : ""}
          />
          Refresh
        </button>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card
          icon={<IconTable size={14} />}
          label="Collections"
          value={formatCount(data.stats.collections)}
          accent="sky"
        />
        <Card
          icon={<IconDatabase size={14} />}
          label="Documents"
          value={formatCount(data.stats.objects)}
          accent="emerald"
        />
        <Card
          icon={<IconStack2 size={14} />}
          label="Data size"
          value={formatBytes(data.stats.dataSize)}
        />
        <Card
          icon={<IconServerCog size={14} />}
          label="Storage size"
          value={formatBytes(data.stats.storageSize)}
          subtitle="Compressed on disk"
        />
        <Card
          icon={<IconLockSquareRounded size={14} />}
          label="Indexes"
          value={formatCount(data.stats.indexes)}
          subtitle={`${formatBytes(data.stats.indexSize)} total`}
          accent="violet"
        />
        <Card
          label="Total size"
          value={formatBytes(data.stats.totalSize)}
          subtitle="Data + indexes"
        />
        <Card
          icon={<IconCalendarStats size={14} />}
          label="Avg doc size"
          value={formatBytes(data.stats.avgObjSize)}
        />
        <Card
          label="Filesystem free"
          value={
            data.stats.fsTotalSize != null && data.stats.fsUsedSize != null
              ? formatBytes(data.stats.fsTotalSize - data.stats.fsUsedSize)
              : "—"
          }
          subtitle={
            data.stats.fsTotalSize != null
              ? `of ${formatBytes(data.stats.fsTotalSize)}`
              : undefined
          }
        />
      </div>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Collections
        </h3>
        <div className="overflow-hidden rounded border border-slate-200 dark:border-slate-700">
          <table className="w-full text-[12.5px]">
            <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-900 dark:text-slate-400">
              <tr>
                <th className="px-3 py-1.5">Name</th>
                <th className="px-3 py-1.5 text-right">Documents</th>
                <th className="px-3 py-1.5 text-right">Data</th>
                <th className="px-3 py-1.5 text-right">Storage</th>
                <th className="px-3 py-1.5 text-right">Avg</th>
                <th className="px-3 py-1.5 text-right">Indexes</th>
                <th className="px-3 py-1.5 text-right">Index size</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-800 dark:bg-slate-900/40">
              {data.collections.map((c) => (
                <tr key={c.name}>
                  <td className="px-3 py-1.5 font-mono">{c.name}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {formatCount(c.count)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {formatBytes(c.size)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {formatBytes(c.storageSize)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {formatBytes(c.avgObjSize)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {c.indexCount ?? "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {formatBytes(c.totalIndexSize)}
                  </td>
                </tr>
              ))}
              {data.collections.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-3 text-center text-slate-500 dark:text-slate-400"
                  >
                    No collections.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
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
