import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconBrandDocker,
  IconCheck,
  IconPlugConnected,
  IconRefresh,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  api,
  type AspireAppHostInfo,
  type AspireRef,
  type AspireResourceSummary,
  type ConnectionPublic,
  type ConnectionSource,
  type DiscoveredMongo,
  type OidcProvider,
} from "../../api/client";
import { ConfirmDialog } from "../../components/ConfirmDialog";

const COLORS = [
  "#38bdf8",
  "#22c55e",
  "#a855f7",
  "#f97316",
  "#ef4444",
  "#eab308",
  "#ec4899",
  "#14b8a6",
];

type ServerType = "direct" | "replicaset" | "srv";
type AuthMethod = "none" | "basic" | "oidc";

interface BuilderState {
  serverType: ServerType;
  hosts: string; // comma-separated host[:port]
  replicaSetName: string;
  defaultDatabase: string;
  tls: boolean;
  authSource: string;

  authMethod: AuthMethod;
  username: string;
  password: string;
  basicMechanism: string; // "" | SCRAM-SHA-256 | SCRAM-SHA-1 | PLAIN
  oidcProvider: OidcProvider;
  oidcTokenAudience: string;
  azureClientId: string;
  azureTenantId: string;
}

const DEFAULT_BUILDER: BuilderState = {
  serverType: "direct",
  hosts: "localhost:27017",
  replicaSetName: "",
  defaultDatabase: "",
  tls: false,
  authSource: "",
  authMethod: "none",
  username: "",
  password: "",
  basicMechanism: "",
  oidcProvider: "azure-browser",
  oidcTokenAudience: "",
  azureClientId: "",
  azureTenantId: "",
};

const enc = (s: string) => encodeURIComponent(s);

const buildUri = (b: BuilderState): string => {
  const scheme = b.serverType === "srv" ? "mongodb+srv" : "mongodb";

  let userinfo = "";
  if (b.authMethod === "basic" && b.username) {
    userinfo = `${enc(b.username)}:${enc(b.password)}@`;
  } else if (b.authMethod === "oidc" && b.username) {
    userinfo = `${enc(b.username)}@`;
  }

  const rawHosts = b.hosts
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  const hosts =
    b.serverType === "srv"
      ? (rawHosts[0] ?? "").replace(/:\d+$/, "")
      : rawHosts.join(",");

  const path = b.defaultDatabase.trim() ? `/${enc(b.defaultDatabase.trim())}` : "";

  const params = new URLSearchParams();
  if (b.serverType === "replicaset" && b.replicaSetName.trim()) {
    params.set("replicaSet", b.replicaSetName.trim());
  }
  if (b.tls) params.set("tls", "true");
  if (b.authSource.trim()) params.set("authSource", b.authSource.trim());
  if (b.authMethod === "basic" && b.basicMechanism) {
    params.set("authMechanism", b.basicMechanism);
  }
  if (b.authMethod === "oidc") {
    params.set("authMechanism", "MONGODB-OIDC");
    if (!params.has("authSource")) params.set("authSource", "$external");
  }

  const qs = params.toString();
  return `${scheme}://${userinfo}${hosts}${path}${qs ? `?${qs}` : ""}`;
};

const parseUri = (uri: string): BuilderState | null => {
  const m = uri.match(/^(mongodb(?:\+srv)?):\/\/(.*)$/i);
  if (!m) return null;
  const scheme = m[1]!.toLowerCase();
  let rest = m[2]!;

  let userinfo = "";
  const atIdx = rest.lastIndexOf("@", rest.search(/[/?#]/) === -1 ? rest.length : rest.search(/[/?#]/));
  if (atIdx !== -1) {
    userinfo = rest.slice(0, atIdx);
    rest = rest.slice(atIdx + 1);
  }

  const slashIdx = rest.indexOf("/");
  const qIdx = rest.indexOf("?");
  const authorityEnd =
    slashIdx === -1 && qIdx === -1
      ? rest.length
      : slashIdx === -1
        ? qIdx
        : qIdx === -1
          ? slashIdx
          : Math.min(slashIdx, qIdx);
  const authority = rest.slice(0, authorityEnd);
  const afterAuthority = rest.slice(authorityEnd);

  let dbName = "";
  let queryStr = "";
  if (afterAuthority.startsWith("/")) {
    const q2 = afterAuthority.indexOf("?");
    dbName =
      q2 === -1 ? afterAuthority.slice(1) : afterAuthority.slice(1, q2);
    queryStr = q2 === -1 ? "" : afterAuthority.slice(q2 + 1);
  } else if (afterAuthority.startsWith("?")) {
    queryStr = afterAuthority.slice(1);
  }

  let username = "";
  let password = "";
  if (userinfo) {
    const colon = userinfo.indexOf(":");
    if (colon === -1) {
      username = decodeURIComponent(userinfo);
    } else {
      username = decodeURIComponent(userinfo.slice(0, colon));
      password = decodeURIComponent(userinfo.slice(colon + 1));
    }
  }

  const params = new URLSearchParams(queryStr);
  const replicaSetName = params.get("replicaSet") ?? "";
  const tls = params.get("tls") === "true" || params.get("ssl") === "true";
  const authSource = params.get("authSource") ?? "";
  const authMechanism = params.get("authMechanism") ?? "";

  let serverType: ServerType;
  if (scheme === "mongodb+srv") {
    serverType = "srv";
  } else if (replicaSetName || authority.includes(",")) {
    serverType = "replicaset";
  } else {
    serverType = "direct";
  }

  let authMethod: AuthMethod = "none";
  if (authMechanism.toUpperCase() === "MONGODB-OIDC") {
    authMethod = "oidc";
  } else if (username) {
    authMethod = "basic";
  }

  return {
    serverType,
    hosts: authority,
    replicaSetName,
    defaultDatabase: dbName ? decodeURIComponent(dbName) : "",
    tls,
    authSource: authSource === "$external" && authMethod === "oidc" ? "" : authSource,
    authMethod,
    username,
    password,
    basicMechanism:
      authMethod === "basic" && authMechanism.toUpperCase() !== "MONGODB-OIDC"
        ? authMechanism
        : "",
    oidcProvider: "azure-browser",
    oidcTokenAudience: "",
    azureClientId: "",
    azureTenantId: "",
  };
};

interface Props {
  mode: "create" | "edit";
  existing?: ConnectionPublic;
  onClose: () => void;
  onCreated?: (conn: ConnectionPublic) => void;
}

type Tab = "server" | "auth";

export const ConnectionFormModal = ({ mode, existing, onClose, onCreated }: Props) => {
  const queryClient = useQueryClient();
  const [name, setName] = useState(existing?.name ?? "");
  const [color, setColor] = useState(existing?.color ?? COLORS[0]!);

  const [tab, setTab] = useState<Tab>("server");

  const [builder, setBuilder] = useState<BuilderState>(DEFAULT_BUILDER);
  const [uriString, setUriString] = useState<string>(() => buildUri(DEFAULT_BUILDER));

  const [defaultDatabaseOverride, setDefaultDatabaseOverride] = useState(
    existing?.defaultDatabase ?? "",
  );

  const [testResult, setTestResult] = useState<
    { ok: true } | { ok: false; error: string } | null
  >(null);
  const [testing, setTesting] = useState(false);

  const [discoveryOpen, setDiscoveryOpen] = useState<
    "docker" | "aspire" | null
  >(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [aspireRef, setAspireRef] = useState<AspireRef | null>(
    existing?.aspire ?? null,
  );
  const [source, setSource] = useState<ConnectionSource>(
    existing?.source ?? null,
  );

  const effectiveUri = uriString.trim();

  // Two-way sync between builder fields and the URI textbox. The flag stops
  // the effect from clobbering the user's in-progress string when builder
  // was just updated from a successful parse.
  const fromStringEdit = useRef(false);
  useEffect(() => {
    if (fromStringEdit.current) {
      fromStringEdit.current = false;
      return;
    }
    setUriString(buildUri(builder));
  }, [builder]);

  // Edit mode: fetch the decrypted URI once and populate the form. Without
  // this, the builder/URI fields would render their defaults regardless of
  // what's actually saved.
  useEffect(() => {
    if (mode !== "edit" || !existing) return;
    let cancelled = false;
    api
      .getConnectionSecret(existing.id)
      .then((r) => {
        if (cancelled) return;
        setUriString(r.uri);
        const parsed = parseUri(r.uri);
        if (parsed) {
          fromStringEdit.current = true;
          setBuilder({
            ...parsed,
            oidcProvider: existing.oidcProvider ?? "azure-browser",
            oidcTokenAudience: existing.oidcTokenAudience ?? "",
            azureClientId: existing.azureClientId ?? "",
            azureTenantId: existing.azureTenantId ?? "",
          });
        }
      })
      .catch(() => {
        /* leave defaults — user can still edit via the URI box */
      });
    return () => {
      cancelled = true;
    };
  }, [mode, existing]);

  const setB = <K extends keyof BuilderState>(k: K, v: BuilderState[K]) => {
    setBuilder((s) => ({ ...s, [k]: v }));
    setTestResult(null);
  };

  const onUriChange = (next: string) => {
    setUriString(next);
    setTestResult(null);
    // Hand-edited URI detaches from any discovery binding — the user is taking
    // control of the connection string.
    setAspireRef(null);
    setSource(null);
    const parsed = parseUri(next.trim());
    if (parsed) {
      fromStringEdit.current = true;
      setBuilder(parsed);
    }
  };

  const applyDiscovered = (d: DiscoveredMongo) => {
    if (!d.uri) return;
    if (!name.trim()) setName(d.containerName);
    onUriChange(d.uri);
    setSource("docker");
    setDiscoveryOpen(null);
  };

  const applyAspire = (
    appHost: AspireAppHostInfo,
    resource: AspireResourceSummary,
  ) => {
    if (!resource.uri) return;
    if (!name.trim()) setName(`${appHost.appHostName} · ${resource.name}`);
    setUriString(resource.uri);
    const parsed = parseUri(resource.uri);
    if (parsed) {
      fromStringEdit.current = true;
      setBuilder(parsed);
    }
    setAspireRef({
      appHostPath: appHost.appHostPath,
      resourceName: resource.name,
    });
    setTestResult(null);
    setDiscoveryOpen(null);
  };

  const onTest = async () => {
    if (!effectiveUri) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.testUri(effectiveUri);
      setTestResult(res.ok ? { ok: true } : { ok: false, error: res.error ?? "" });
    } catch (e) {
      setTestResult({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setTesting(false);
    }
  };

  const save = useMutation({
    mutationFn: async () => {
      const payloadDb = defaultDatabaseOverride.trim() || null;
      const oidcProvider = builder.authMethod === "oidc" ? builder.oidcProvider : null;
      const oidcTokenAudience =
        builder.authMethod === "oidc" && builder.oidcTokenAudience.trim()
          ? builder.oidcTokenAudience.trim()
          : null;
      const azureClientId =
        builder.authMethod === "oidc" && builder.oidcProvider === "azure-browser" && builder.azureClientId.trim()
          ? builder.azureClientId.trim()
          : null;
      const azureTenantId =
        builder.authMethod === "oidc" && builder.oidcProvider === "azure-browser" && builder.azureTenantId.trim()
          ? builder.azureTenantId.trim()
          : null;
      if (mode === "create") {
        return api.createConnection({
          name: name.trim(),
          uri: effectiveUri,
          defaultDatabase: payloadDb,
          color,
          aspire: aspireRef,
          source,
          oidcProvider,
          oidcTokenAudience,
          azureClientId,
          azureTenantId,
        });
      }
      return api.updateConnection(existing!.id, {
        name: name.trim(),
        uri: effectiveUri || undefined,
        defaultDatabase: payloadDb,
        color,
        aspire: aspireRef,
        source,
        oidcProvider,
        oidcTokenAudience,
        azureClientId,
        azureTenantId,
      });
    },
    onSuccess: (conn) => {
      queryClient.invalidateQueries({ queryKey: ["connections"] });
      // Force a fresh ping for this connection — the URI / auth may have just
      // changed, so the cached health result is stale.
      queryClient.invalidateQueries({ queryKey: ["connection-health", conn.id] });
      if (mode === "create") onCreated?.(conn);
      onClose();
    },
  });

  const remove = useMutation({
    mutationFn: () => api.deleteConnection(existing!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connections"] });
      queryClient.removeQueries({ queryKey: ["connection-health", existing!.id] });
      onClose();
    },
  });

  const error =
    save.error instanceof ApiError
      ? save.error.message
      : save.error instanceof Error
        ? save.error.message
        : null;

  const canSave =
    !!name.trim() && (mode === "edit" || !!effectiveUri);

  return (
    <>
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div className="flex h-[42rem] max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
        <header className="flex items-start gap-3 border-b border-slate-200 px-5 pb-3 pt-4 dark:border-slate-700">
          <div className="flex-1">
            <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {mode === "create" ? "New connection" : "Edit connection"}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              MongoDB connection details. The URI is encrypted at rest.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <IconX size={16} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <Field label="Name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Production"
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </Field>
            <Field label="Color">
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`h-6 w-6 rounded-full border-2 ${
                      color === c
                        ? "border-slate-900 dark:border-slate-100"
                        : "border-transparent"
                    }`}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </Field>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Connection string
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() =>
                    setDiscoveryOpen((v) => (v === "docker" ? null : "docker"))
                  }
                  className={`flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium ${
                    discoveryOpen === "docker"
                      ? "border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  }`}
                >
                  <IconBrandDocker size={12} />
                  Docker
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setDiscoveryOpen((v) => (v === "aspire" ? null : "aspire"))
                  }
                  className={`flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium ${
                    discoveryOpen === "aspire"
                      ? "border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  }`}
                >
                  <AspireLogo className="h-3 w-3" />
                  Aspire
                </button>
              </div>
            </div>
            <textarea
              value={uriString}
              onChange={(e) => onUriChange(e.target.value)}
              rows={2}
              placeholder="mongodb://user:pass@host:27017/db?authSource=admin"
              spellCheck={false}
              className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
            {aspireRef ? (
              <div className="mt-1 flex items-start gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-400">
                <AspireLogo className="mt-0.5 h-3 w-3 flex-shrink-0" />
                <span className="flex-1">
                  Bound to Aspire resource{" "}
                  <span className="font-mono">{aspireRef.resourceName}</span> in{" "}
                  <span className="font-mono">{aspireRef.appHostPath}</span>.
                  Connection string will be re-resolved on every connect.
                </span>
                <button
                  type="button"
                  onClick={() => setAspireRef(null)}
                  className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  title="Detach from Aspire"
                >
                  <IconX size={11} />
                </button>
              </div>
            ) : (
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Stays in sync with the form below — edit either side.
              </p>
            )}
          </div>

          {discoveryOpen === "docker" && (
            <DockerDiscoveryPanel onPick={applyDiscovered} />
          )}
          {discoveryOpen === "aspire" && (
            <AspireDiscoveryPanel onPick={applyAspire} />
          )}

          <div className="flex border-b border-slate-200 dark:border-slate-700">
            <TabButton active={tab === "server"} onClick={() => setTab("server")}>
              Server
            </TabButton>
            <TabButton active={tab === "auth"} onClick={() => setTab("auth")}>
              Authentication
            </TabButton>
          </div>

          {tab === "server" ? (
            <ServerTab builder={builder} setB={setB} />
          ) : (
            <AuthTab builder={builder} setB={setB} />
          )}

          <Field label="Default database (override)">
            <input
              value={defaultDatabaseOverride}
              onChange={(e) => setDefaultDatabaseOverride(e.target.value)}
              placeholder="leave blank to use the URI's database"
              className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </Field>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onTest}
              disabled={!effectiveUri || testing}
              className="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <IconPlugConnected size={14} />
              {testing ? "Testing…" : "Test connection"}
            </button>
            {testResult?.ok === true && (
              <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                <IconCheck size={14} /> Connected
              </span>
            )}
            {testResult?.ok === false && (
              <span className="flex-1 truncate text-xs text-red-600 dark:text-red-400">
                {testResult.error}
              </span>
            )}
          </div>

          {error && (
            <div className="rounded border border-red-300 bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
              {error}
            </div>
          )}
        </div>

        <footer className="flex items-center gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-700">
          {mode === "edit" && existing && (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              disabled={remove.isPending}
              className="flex items-center gap-1 rounded border border-red-300 px-2 py-1.5 text-xs text-red-700 hover:bg-red-50 dark:border-red-700/40 dark:text-red-300 dark:hover:bg-red-900/20"
            >
              <IconTrash size={12} />
              Delete
            </button>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending || !canSave}
            className="rounded bg-sky-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50"
          >
            {save.isPending ? "Saving…" : mode === "create" ? "Create" : "Save"}
          </button>
        </footer>
      </div>
    </div>

    {confirmingDelete && existing && (
      <ConfirmDialog
        title={`Delete connection "${existing.name}"?`}
        message="This removes the saved connection and its encrypted URI. It will not affect the underlying MongoDB database."
        confirmLabel="Delete"
        danger
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => setConfirmingDelete(false)}
      />
    )}
    </>
  );
};

interface TabProps {
  builder: BuilderState;
  setB: <K extends keyof BuilderState>(k: K, v: BuilderState[K]) => void;
}

const ServerTab = ({ builder, setB }: TabProps) => {
  const isRs = builder.serverType === "replicaset";
  const isSrv = builder.serverType === "srv";
  return (
    <div className="space-y-3">
      <Field label="Topology">
        <div className="flex gap-1">
          <SegmentedButton
            active={builder.serverType === "direct"}
            onClick={() => setB("serverType", "direct")}
          >
            Direct
          </SegmentedButton>
          <SegmentedButton
            active={builder.serverType === "replicaset"}
            onClick={() => setB("serverType", "replicaset")}
          >
            Replica set
          </SegmentedButton>
          <SegmentedButton
            active={builder.serverType === "srv"}
            onClick={() => setB("serverType", "srv")}
          >
            DNS / SRV (Atlas)
          </SegmentedButton>
        </div>
      </Field>

      <Field
        label={
          isSrv
            ? "Host (no port)"
            : isRs
              ? "Hosts (host:port, comma-separated)"
              : "Host (host:port)"
        }
      >
        <input
          value={builder.hosts}
          onChange={(e) => setB("hosts", e.target.value)}
          placeholder={
            isSrv
              ? "cluster0.abcd.mongodb.net"
              : isRs
                ? "node1:27017,node2:27017,node3:27017"
                : "localhost:27017"
          }
          spellCheck={false}
          className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
        />
      </Field>

      {isRs && (
        <Field label="Replica set name">
          <input
            value={builder.replicaSetName}
            onChange={(e) => setB("replicaSetName", e.target.value)}
            placeholder="rs0"
            spellCheck={false}
            className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Default database (optional)">
          <input
            value={builder.defaultDatabase}
            onChange={(e) => setB("defaultDatabase", e.target.value)}
            placeholder="myapp"
            spellCheck={false}
            className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </Field>
        <Field label="Auth source (optional)">
          <input
            value={builder.authSource}
            onChange={(e) => setB("authSource", e.target.value)}
            placeholder="admin"
            spellCheck={false}
            className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
        <input
          type="checkbox"
          checked={builder.tls || isSrv}
          disabled={isSrv}
          onChange={(e) => setB("tls", e.target.checked)}
        />
        Use TLS{isSrv && " (required for SRV)"}
      </label>
    </div>
  );
};

const AuthTab = ({ builder, setB }: TabProps) => {
  return (
    <div className="space-y-3">
      <Field label="Method">
        <div className="flex gap-1">
          <SegmentedButton
            active={builder.authMethod === "none"}
            onClick={() => setB("authMethod", "none")}
          >
            None
          </SegmentedButton>
          <SegmentedButton
            active={builder.authMethod === "basic"}
            onClick={() => setB("authMethod", "basic")}
          >
            Basic (username / password)
          </SegmentedButton>
          <SegmentedButton
            active={builder.authMethod === "oidc"}
            onClick={() => setB("authMethod", "oidc")}
          >
            OIDC
          </SegmentedButton>
        </div>
      </Field>

      {builder.authMethod === "none" && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          No credentials will be sent. Suitable for local development without auth.
        </p>
      )}

      {builder.authMethod === "basic" && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Username">
              <input
                value={builder.username}
                onChange={(e) => setB("username", e.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </Field>
            <Field label="Password">
              <input
                type="password"
                value={builder.password}
                onChange={(e) => setB("password", e.target.value)}
                autoComplete="new-password"
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </Field>
          </div>
          <Field label="Mechanism (optional)">
            <select
              value={builder.basicMechanism}
              onChange={(e) => setB("basicMechanism", e.target.value)}
              className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="">Default (SCRAM-SHA-256)</option>
              <option value="SCRAM-SHA-256">SCRAM-SHA-256</option>
              <option value="SCRAM-SHA-1">SCRAM-SHA-1</option>
              <option value="PLAIN">PLAIN (LDAP)</option>
            </select>
          </Field>
        </>
      )}

      {builder.authMethod === "oidc" && (
        <>
          <Field label="Provider">
            <select
              value={builder.oidcProvider ?? "azure-browser"}
              onChange={(e) => setB("oidcProvider", e.target.value as OidcProvider)}
              className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="azure-browser">Azure AD — Interactive browser (recommended)</option>
              <option value="azure-cli">Azure CLI (az login + admin consent)</option>
            </select>
          </Field>

          {builder.oidcProvider === "azure-browser" && (
            <>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                A browser window will open to sign in with Azure AD — no admin
                consent or extra setup required.
              </p>
              <details className="group">
                <summary className="cursor-pointer select-none text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                  Advanced (custom Azure AD app)
                </summary>
                <div className="mt-2 space-y-2">
                  <Field label="Azure Application (Client) ID (override)">
                    <input
                      value={builder.azureClientId}
                      onChange={(e) => setB("azureClientId", e.target.value)}
                      placeholder="built-in Mango app (leave blank)"
                      autoComplete="off"
                      spellCheck={false}
                      className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </Field>
                  <Field label="Tenant ID (override)">
                    <input
                      value={builder.azureTenantId}
                      onChange={(e) => setB("azureTenantId", e.target.value)}
                      placeholder="auto-detected from server"
                      autoComplete="off"
                      spellCheck={false}
                      className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </Field>
                </div>
              </details>
            </>
          )}

          {builder.oidcProvider === "azure-cli" && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Tokens are acquired from your local{" "}
              <code className="font-mono">az login</code> session. Requires
              admin consent for the Azure CLI app in your tenant.
            </p>
          )}

          <Field label="Token audience / resource (optional)">
            <input
              value={builder.oidcTokenAudience}
              onChange={(e) => setB("oidcTokenAudience", e.target.value)}
              placeholder="auto-detected from server (e.g. api://your-atlas-app-id)"
              spellCheck={false}
              className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </Field>
          <Field label="Principal name (optional)">
            <input
              value={builder.username}
              onChange={(e) => setB("username", e.target.value)}
              placeholder="user@example.com"
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </Field>
        </>
      )}
    </div>
  );
};

const DockerDiscoveryPanel = ({
  onPick,
}: {
  onPick: (d: DiscoveredMongo) => void;
}) => {
  const q = useQuery({
    queryKey: ["discovery", "docker"],
    queryFn: () => api.discoverDocker(),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const data = q.data;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950/40">
      <div className="mb-2 flex items-center gap-2">
        <IconBrandDocker size={14} className="text-sky-600 dark:text-sky-400" />
        <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
          Running MongoDB containers
        </span>
        <button
          type="button"
          onClick={() => q.refetch()}
          disabled={q.isFetching}
          className="ml-auto flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
        >
          <IconRefresh size={11} />
          {q.isFetching ? "Scanning…" : "Rescan"}
        </button>
      </div>

      {q.isLoading && (
        <div className="text-xs text-slate-500 dark:text-slate-400">
          Scanning Docker socket…
        </div>
      )}

      {data && !data.ok && (
        <div className="text-xs text-amber-700 dark:text-amber-400">
          {data.error ?? "Could not reach Docker."}
        </div>
      )}

      {data?.ok && data.containers.length === 0 && (
        <div className="text-xs text-slate-500 dark:text-slate-400">
          No running containers look like MongoDB.
        </div>
      )}

      {data?.ok && data.containers.length > 0 && (
        <ul className="space-y-1.5">
          {data.containers.map((c) => (
            <li
              key={c.containerId}
              className="flex items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-slate-900 dark:text-slate-100">
                    {c.containerName}
                  </span>
                  <span className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                    {c.image}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  <span>port: {c.hostPort ?? "—"}</span>
                  <span>
                    auth:{" "}
                    {c.username
                      ? `${c.username}${c.hasPassword ? " / ***" : ""}`
                      : "none"}
                  </span>
                  {c.warning && (
                    <span className="text-amber-600 dark:text-amber-400">
                      {c.warning}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onPick(c)}
                disabled={!c.uri}
                className="rounded bg-sky-500 px-2 py-1 text-[11px] font-medium text-white hover:bg-sky-400 disabled:opacity-50"
              >
                Use
              </button>
            </li>
          ))}
        </ul>
      )}

      {data?.socket && (
        <div className="mt-2 truncate text-[10px] text-slate-400 dark:text-slate-500">
          via {data.socket}
        </div>
      )}
    </div>
  );
};

const AspireDiscoveryPanel = ({
  onPick,
}: {
  onPick: (appHost: AspireAppHostInfo, resource: AspireResourceSummary) => void;
}) => {
  const q = useQuery({
    queryKey: ["discovery", "aspire"],
    queryFn: () => api.discoverAspire(),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const data = q.data;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950/40">
      <div className="mb-2 flex items-center gap-2">
        <AspireLogo className="h-3.5 w-3.5" />
        <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
          Aspire apphosts
        </span>
        <button
          type="button"
          onClick={() => q.refetch()}
          disabled={q.isFetching}
          className="ml-auto flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
        >
          <IconRefresh size={11} />
          {q.isFetching ? "Scanning…" : "Rescan"}
        </button>
      </div>

      {q.isLoading && (
        <div className="text-xs text-slate-500 dark:text-slate-400">
          Running <span className="font-mono">aspire ps</span>…
        </div>
      )}

      {data && !data.ok && (
        <div className="text-xs text-amber-700 dark:text-amber-400">
          {data.error ?? "Could not query Aspire."}
          {data.cli?.installed && data.cli.version && (
            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              installed: <span className="font-mono">{data.cli.version}</span>
            </div>
          )}
        </div>
      )}

      {data?.ok && data.cli?.version && (
        <div className="mb-2 text-[11px] text-slate-400 dark:text-slate-500">
          aspire <span className="font-mono">{data.cli.version}</span>
        </div>
      )}

      {data?.ok && data.appHosts.length === 0 && (
        <div className="text-xs text-slate-500 dark:text-slate-400">
          No running apphosts.
        </div>
      )}

      {data?.ok && data.appHosts.length > 0 && (
        <div className="space-y-3">
          {data.appHosts.map((ah) => (
            <AspireAppHostBlock key={ah.appHostPath} appHost={ah} onPick={onPick} />
          ))}
        </div>
      )}
    </div>
  );
};

const AspireAppHostBlock = ({
  appHost,
  onPick,
}: {
  appHost: AspireAppHostInfo;
  onPick: (appHost: AspireAppHostInfo, resource: AspireResourceSummary) => void;
}) => {
  const mongoCount = appHost.resources.filter((r) => r.kind !== "other").length;
  return (
    <div className="rounded border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <div className="border-b border-slate-200 px-2 py-1.5 dark:border-slate-700">
        <div className="flex items-center gap-2">
          <span className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
            {appHost.appHostName}
          </span>
          <span className="text-[10px] text-slate-400">
            pid {appHost.appHostPid}
          </span>
          <span className="ml-auto text-[10px] text-slate-400">
            {mongoCount} mongo · {appHost.resources.length} total
          </span>
        </div>
        <div className="truncate text-[10px] text-slate-400 dark:text-slate-500">
          {appHost.appHostPath}
        </div>
      </div>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {appHost.resources.map((r) => (
          <AspireResourceRow
            key={r.name}
            resource={r}
            onPick={() => onPick(appHost, r)}
          />
        ))}
      </ul>
    </div>
  );
};

const AspireResourceRow = ({
  resource,
  onPick,
}: {
  resource: AspireResourceSummary;
  onPick: () => void;
}) => {
  const selectable = resource.kind !== "other" && !!resource.uri;
  const stateColor =
    resource.state === "Running"
      ? "bg-emerald-500"
      : resource.state === "NotStarted" || resource.state === "Stopped"
        ? "bg-slate-400"
        : "bg-amber-500";
  return (
    <li
      className={[
        "flex items-center gap-2 px-2 py-1 text-xs",
        resource.kind === "other"
          ? "text-slate-500 dark:text-slate-400"
          : "text-slate-800 dark:text-slate-100",
      ].join(" ")}
    >
      <span
        className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${stateColor}`}
        title={resource.state ?? "unknown"}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-mono">{resource.displayName}</span>
          {resource.kind === "mongo-database" && (
            <span className="rounded bg-emerald-500/15 px-1 py-px text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
              mongo db
            </span>
          )}
          {resource.kind === "mongo-server" && (
            <span className="rounded bg-emerald-500/15 px-1 py-px text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
              mongo server
            </span>
          )}
        </div>
        <div className="truncate text-[10px] text-slate-400 dark:text-slate-500">
          {resource.resourceType}
          {resource.warning && (
            <span className="ml-2 text-amber-600 dark:text-amber-400">
              {resource.warning}
            </span>
          )}
        </div>
      </div>
      {selectable && (
        <button
          type="button"
          onClick={onPick}
          className="rounded bg-sky-500 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-sky-400"
        >
          Use
        </button>
      )}
    </li>
  );
};

const AspireLogo = ({ className }: { className?: string }) => (
  <img
    src="/assets/aspire-logo.svg"
    alt="Aspire"
    draggable={false}
    className={className ?? "h-3.5 w-3.5"}
  />
);

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
      {label}
    </div>
    {children}
  </div>
);

const TabButton = ({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`-mb-px border-b-2 px-3 py-1.5 text-xs font-medium ${
      active
        ? "border-emerald-500 text-slate-900 dark:text-slate-100"
        : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
    }`}
  >
    {children}
  </button>
);

const SegmentedButton = ({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex-1 rounded border px-2 py-1.5 text-xs font-medium ${
      active
        ? "border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300"
        : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
    }`}
  >
    {children}
  </button>
);
