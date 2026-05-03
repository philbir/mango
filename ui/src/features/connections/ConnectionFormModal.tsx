import { useMutation, useQueryClient } from "@tanstack/react-query";
import { IconCheck, IconPlugConnected, IconTrash, IconX } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { ApiError, api, type ConnectionPublic } from "../../api/client";

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
  };
};

interface Props {
  mode: "create" | "edit";
  existing?: ConnectionPublic;
  onClose: () => void;
}

type Tab = "server" | "auth";

export const ConnectionFormModal = ({ mode, existing, onClose }: Props) => {
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

  const setB = <K extends keyof BuilderState>(k: K, v: BuilderState[K]) => {
    setBuilder((s) => ({ ...s, [k]: v }));
    setTestResult(null);
  };

  const onUriChange = (next: string) => {
    setUriString(next);
    setTestResult(null);
    const parsed = parseUri(next.trim());
    if (parsed) {
      fromStringEdit.current = true;
      setBuilder(parsed);
    }
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
      if (mode === "create") {
        return api.createConnection({
          name: name.trim(),
          uri: effectiveUri,
          defaultDatabase: payloadDb,
          color,
        });
      }
      return api.updateConnection(existing!.id, {
        name: name.trim(),
        uri: effectiveUri || undefined,
        defaultDatabase: payloadDb,
        color,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connections"] });
      onClose();
    },
  });

  const remove = useMutation({
    mutationFn: () => api.deleteConnection(existing!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connections"] });
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

          <Field label="Connection string">
            <textarea
              value={uriString}
              onChange={(e) => onUriChange(e.target.value)}
              rows={2}
              placeholder="mongodb://user:pass@host:27017/db?authSource=admin"
              spellCheck={false}
              className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              Stays in sync with the form below — edit either side.
            </p>
          </Field>

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
              onClick={() => {
                if (confirm(`Delete connection "${existing.name}"?`)) {
                  remove.mutate();
                }
              }}
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
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Uses <code className="font-mono">authMechanism=MONGODB-OIDC</code> with
            <code className="font-mono"> authSource=$external</code>. Token
            acquisition is handled by the MongoDB driver via your environment
            (e.g. Azure / GCP workload identity).
          </p>
        </>
      )}
    </div>
  );
};

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
