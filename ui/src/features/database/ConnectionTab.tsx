import { useQuery } from "@tanstack/react-query";
import {
  IconAlertCircle,
  IconBolt,
  IconCheck,
  IconClockHour4,
  IconCopy,
  IconEye,
  IconEyeOff,
  IconPlugConnected,
  IconRefresh,
  IconServer2,
  IconTopologyStar3,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { api, type ServerInfo } from "../../api/client";
import { Card } from "./StatsTab";

interface Props {
  cid: string;
}

const formatUptime = (s: number | null): string => {
  if (s === null) return "—";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

const OIDC_LABEL: Record<string, string> = {
  "azure-cli": "Azure CLI",
  "azure-browser": "Azure (browser)",
};

export const ConnectionTab = ({ cid }: Props) => {
  const q = useQuery({
    queryKey: ["server-info", cid],
    queryFn: () => api.getServerInfo(cid),
    enabled: !!cid,
  });

  if (q.isLoading) {
    return (
      <div className="p-6 text-sm text-slate-500 dark:text-slate-400">
        Loading connection details…
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
  const { connection, client, server } = data;

  return (
    <div className="space-y-5 p-5">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {connection.name}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            From <span className="font-mono">buildInfo</span>,{" "}
            <span className="font-mono">hello</span> and{" "}
            <span className="font-mono">serverStatus</span>.
          </p>
        </div>
        <button
          type="button"
          onClick={() => q.refetch()}
          disabled={q.isFetching}
          className="btn btn-sm btn-outline"
        >
          <IconRefresh size={12} className={q.isFetching ? "animate-spin" : ""} />
          Refresh
        </button>
      </header>

      <ConnectionString cid={cid} info={data} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Card
          icon={<IconServer2 size={14} />}
          label="Version"
          value={server.version ?? "—"}
          subtitle={server.edition}
          accent="emerald"
        />
        <Card
          icon={<IconTopologyStar3 size={14} />}
          label="Topology"
          value={server.topology}
          subtitle={server.setName ?? undefined}
          accent="sky"
        />
        <Card
          icon={<IconBolt size={14} />}
          label="Ping"
          value={`${data.pingMs < 1 ? "<1" : Math.round(data.pingMs)} ms`}
          subtitle="Round trip from Mango server"
        />
        <Card
          icon={<IconClockHour4 size={14} />}
          label="Uptime"
          value={formatUptime(server.uptimeSeconds)}
        />
        <Card
          icon={<IconPlugConnected size={14} />}
          label="Connections"
          value={
            server.connectionsCurrent !== null
              ? server.connectionsCurrent.toLocaleString()
              : "—"
          }
          subtitle={
            server.connectionsAvailable !== null
              ? `${server.connectionsAvailable.toLocaleString()} available`
              : undefined
          }
          accent="violet"
        />
      </div>

      {!server.serverStatusAvailable && (
        <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700/30 dark:bg-amber-900/20 dark:text-amber-200">
          <IconAlertCircle size={14} className="mt-px flex-shrink-0" />
          <span>
            <span className="font-mono">serverStatus</span> was denied — uptime,
            host and connection counts need the{" "}
            <span className="font-mono">clusterMonitor</span> role.
          </span>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <DetailTable
          title="Server"
          rows={[
            ["Version", server.version],
            ["Edition", server.edition],
            ["Git version", server.gitVersion, true],
            ["Process", server.process],
            ["Host", server.host, true],
            ["Storage engine", server.storageEngine],
            ["Wire version", server.maxWireVersion?.toString() ?? null],
            ["OpenSSL", server.openssl],
            ["Replica set", server.setName, true],
            ["Primary", server.primary, true],
            ["Connected to", server.me, true],
            ["Members", server.hosts.length ? server.hosts.join(", ") : null, true],
            ["Writable primary", server.isWritablePrimary ? "Yes" : "No"],
          ]}
        />
        <div className="space-y-5">
          <DetailTable
            title="Client"
            rows={[
              ["Hosts", client.srvHost ? `${client.srvHost} (SRV)` : client.hosts.join(", "), true],
              ["User", client.username, true],
              ["Auth source", client.authSource, true],
              ["Auth mechanism", client.authMechanism],
              ["TLS", client.tls ? "Enabled" : "Disabled"],
              ["Replica set", client.replicaSet, true],
              ["Direct connection", client.directConnection ? "Yes" : "No"],
              ["Read preference", client.readPreference],
              ["Compressors", client.compressors.length ? client.compressors.join(", ") : null],
              ["App name", client.appName],
            ]}
          />
          <DetailTable
            title="Mango"
            rows={[
              ["Name", connection.name],
              ["Default database", connection.defaultDatabase, true],
              [
                "Source",
                connection.aspire
                  ? `Aspire · ${connection.aspire.resourceName}`
                  : connection.source === "docker"
                    ? "Docker"
                    : "Manual",
              ],
              [
                "OIDC",
                connection.oidcProvider
                  ? (OIDC_LABEL[connection.oidcProvider] ?? connection.oidcProvider)
                  : null,
              ],
            ]}
          />
        </div>
      </div>
    </div>
  );
};

/**
 * Shows the redacted URI by default. Reveal / copy fetch the decrypted URI
 * on demand so the password never sits in the query cache.
 */
const ConnectionString = ({ cid, info }: { cid: string; info: ServerInfo }) => {
  const { uriRedacted, revealable } = info.connection;
  // Nothing to reveal without credentials in the URI.
  const hasCredentials = info.client.username !== null;
  const [secret, setSecret] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Forget the secret when switching connections.
  useEffect(() => {
    setSecret(null);
    setRevealed(false);
    setError(null);
  }, [cid]);

  const loadSecret = async (): Promise<string | null> => {
    if (secret !== null) return secret;
    try {
      const { uri } = await api.getConnectionSecret(cid);
      setSecret(uri);
      return uri;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  };

  const onToggleReveal = async () => {
    setError(null);
    if (revealed) {
      setRevealed(false);
      return;
    }
    if (await loadSecret()) setRevealed(true);
  };

  const onCopy = async () => {
    setError(null);
    const value = revealable ? loadSecret() : Promise.resolve(uriRedacted);
    try {
      // Hand the clipboard a promise instead of awaiting the fetch first:
      // WebKit (Tauri on macOS) drops the click's user activation across an
      // await, and writeText() would then be rejected.
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": value.then((v) => {
              if (v === null) throw new Error("secret unavailable");
              return new Blob([v], { type: "text/plain" });
            }),
          }),
        ]);
      } else {
        const v = await value;
        if (v === null) return;
        await navigator.clipboard.writeText(v);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // loadSecret() already reported its own failure.
      setError((prev) => prev ?? "Clipboard access was denied.");
    }
  };

  const shown = revealed && secret !== null ? secret : uriRedacted;
  const btn =
    "flex flex-shrink-0 items-center gap-1 rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800";

  return (
    <section>
      <h3 className="mb-2 eyebrow">
        Connection string
      </h3>
      <div className="flex items-center gap-2 rounded border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900/60">
        <code className="min-w-0 flex-1 select-all break-all px-1 font-mono text-[12.5px] text-slate-800 dark:text-slate-200">
          {shown}
        </code>
        {hasCredentials && (
          <button
            type="button"
            onClick={onToggleReveal}
            disabled={!revealable}
            title={
              revealable
                ? revealed
                  ? "Hide password"
                  : "Reveal password"
                : "Disabled in standalone mode"
            }
            className={btn}
          >
            {revealed ? <IconEyeOff size={12} /> : <IconEye size={12} />}
            {revealed ? "Hide" : "Reveal"}
          </button>
        )}
        <button
          type="button"
          onClick={onCopy}
          title={
            revealable
              ? "Copy full connection string (including password)"
              : "Copy redacted connection string"
          }
          className={btn}
        >
          {copied ? (
            <IconCheck size={12} className="text-emerald-500" />
          ) : (
            <IconCopy size={12} />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {error && (
        <div className="mt-1.5 text-xs text-red-600 dark:text-red-400">{error}</div>
      )}
    </section>
  );
};

const DetailTable = ({
  title,
  rows,
}: {
  title: string;
  /** [label, value, monospace?] — null values render as an em dash. */
  rows: Array<[string, string | null, boolean?]>;
}) => (
  <section>
    <h3 className="mb-2 eyebrow">
      {title}
    </h3>
    <div className="overflow-hidden rounded border border-slate-200 dark:border-slate-700">
      <table className="w-full text-[12.5px]">
        <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-800 dark:bg-slate-900/40">
          {rows.map(([label, value, mono]) => (
            <tr key={label}>
              <td className="w-40 px-3 py-1.5 text-slate-500 dark:text-slate-400">
                {label}
              </td>
              <td
                className={`break-all px-3 py-1.5 text-slate-800 dark:text-slate-200 ${
                  mono ? "font-mono" : ""
                }`}
              >
                {value ?? <span className="text-slate-400">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </section>
);
