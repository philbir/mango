import { Hono } from "hono";
import { request } from "node:http";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  MIN_ASPIRE_MAJOR,
  discoverAspireAppHosts,
  getAspireCliInfo,
} from "../aspire.js";

export const discoveryRoute = new Hono();

interface DockerContainerSummary {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Ports?: Array<{
    PrivatePort: number;
    PublicPort?: number;
    Type: string;
  }>;
}

interface DockerInspect {
  Id: string;
  Name: string;
  Config?: {
    Env?: string[];
    Image?: string;
  };
  NetworkSettings?: {
    Ports?: Record<string, Array<{ HostIp: string; HostPort: string }> | null>;
  };
  HostConfig?: {
    PortBindings?: Record<string, Array<{ HostIp: string; HostPort: string }> | null>;
  };
}

export interface DiscoveredMongo {
  containerId: string;
  containerName: string;
  image: string;
  hostPort: number | null;
  username: string | null;
  /** True when creds were found in the container env. */
  hasPassword: boolean;
  uri: string | null;
  /** Why we couldn't build a usable URI. */
  warning: string | null;
}

const candidateSockets = (): string[] => {
  const env = process.env.DOCKER_HOST?.trim();
  const out: string[] = [];
  if (env?.startsWith("unix://")) out.push(env.slice("unix://".length));
  out.push("/var/run/docker.sock");
  out.push(path.join(homedir(), ".docker/run/docker.sock"));
  out.push(path.join(homedir(), ".colima/default/docker.sock"));
  out.push(path.join(homedir(), ".rd/docker.sock"));
  return Array.from(new Set(out));
};

const pickSocket = (): string | null => {
  for (const s of candidateSockets()) {
    if (existsSync(s)) return s;
  }
  return null;
};

const dockerGet = <T>(socketPath: string, urlPath: string): Promise<T> =>
  new Promise((resolve, reject) => {
    const req = request(
      {
        socketPath,
        path: urlPath,
        method: "GET",
        headers: { Host: "docker", Accept: "application/json" },
        timeout: 4_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if (!res.statusCode || res.statusCode >= 400) {
            reject(new Error(`Docker API ${res.statusCode}: ${body.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(body) as T);
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("Docker API timeout"));
    });
    req.end();
  });

const looksLikeMongo = (image: string, ports: DockerContainerSummary["Ports"]): boolean => {
  if (/mongo/i.test(image)) return true;
  return !!ports?.some((p) => p.PrivatePort === 27017 && p.Type === "tcp");
};

const envMap = (env: string[] | undefined): Map<string, string> => {
  const m = new Map<string, string>();
  if (!env) return m;
  for (const line of env) {
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    m.set(line.slice(0, eq), line.slice(eq + 1));
  }
  return m;
};

const findHostPort = (inspect: DockerInspect): number | null => {
  const fromBindings = (
    bindings: Record<string, Array<{ HostPort: string }> | null> | undefined,
  ): number | null => {
    if (!bindings) return null;
    for (const [container, host] of Object.entries(bindings)) {
      if (!container.startsWith("27017")) continue;
      const first = host?.[0]?.HostPort;
      if (first) return Number(first);
    }
    return null;
  };
  return (
    fromBindings(inspect.NetworkSettings?.Ports) ??
    fromBindings(inspect.HostConfig?.PortBindings)
  );
};

const enc = (s: string) => encodeURIComponent(s);

const buildUri = (host: string, port: number, user: string | null, pass: string | null): string => {
  const userinfo =
    user && pass ? `${enc(user)}:${enc(pass)}@` : user ? `${enc(user)}@` : "";
  const auth = user && pass ? "?authSource=admin" : "";
  return `mongodb://${userinfo}${host}:${port}/${auth}`;
};

const discoverFromInspect = (inspect: DockerInspect, image: string): DiscoveredMongo => {
  const env = envMap(inspect.Config?.Env);
  const user =
    env.get("MONGO_INITDB_ROOT_USERNAME") ??
    env.get("MONGODB_ROOT_USER") ??
    env.get("MONGODB_USERNAME") ??
    null;
  const pass =
    env.get("MONGO_INITDB_ROOT_PASSWORD") ??
    env.get("MONGODB_ROOT_PASSWORD") ??
    env.get("MONGODB_PASSWORD") ??
    null;
  const hostPort = findHostPort(inspect);
  const containerName = inspect.Name.replace(/^\//, "");

  let uri: string | null = null;
  let warning: string | null = null;
  if (!hostPort) {
    warning =
      "Container does not publish 27017 to the host — Mango cannot reach it directly.";
  } else {
    uri = buildUri("127.0.0.1", hostPort, user, pass);
  }

  return {
    containerId: inspect.Id.slice(0, 12),
    containerName,
    image,
    hostPort,
    username: user,
    hasPassword: !!pass,
    uri,
    warning,
  };
};

discoveryRoute.get("/docker", async (c) => {
  const socket = pickSocket();
  if (!socket) {
    return c.json(
      {
        ok: false,
        error:
          "Docker socket not found. Tried DOCKER_HOST, /var/run/docker.sock, ~/.docker/run/docker.sock, ~/.colima, ~/.rd.",
        containers: [],
      },
      200,
    );
  }

  let summaries: DockerContainerSummary[];
  try {
    summaries = await dockerGet<DockerContainerSummary[]>(
      socket,
      "/containers/json",
    );
  } catch (e) {
    return c.json(
      {
        ok: false,
        error: `Docker API error: ${e instanceof Error ? e.message : String(e)}`,
        containers: [],
      },
      200,
    );
  }

  const candidates = summaries.filter(
    (s) => s.State === "running" && looksLikeMongo(s.Image, s.Ports),
  );

  const results: DiscoveredMongo[] = [];
  for (const c of candidates) {
    try {
      const inspect = await dockerGet<DockerInspect>(
        socket,
        `/containers/${c.Id}/json`,
      );
      results.push(discoverFromInspect(inspect, c.Image));
    } catch {
      // Skip containers we can't inspect.
    }
  }

  return c.json({ ok: true, socket, containers: results });
});

discoveryRoute.get("/aspire", async (c) => {
  const cli = await getAspireCliInfo();
  if (!cli.installed) {
    return c.json(
      {
        ok: false,
        cli,
        error:
          "Aspire CLI not found. Install from https://aspire.dev or set ASPIRE_CLI to its path.",
        appHosts: [],
      },
      200,
    );
  }
  if (!cli.supported) {
    return c.json(
      {
        ok: false,
        cli,
        error: `Aspire CLI ${cli.version ?? "?"} is too old — Mango requires v${MIN_ASPIRE_MAJOR}.x or newer. Run \`aspire update\` (or reinstall) to upgrade.`,
        appHosts: [],
      },
      200,
    );
  }

  try {
    const appHosts = await discoverAspireAppHosts();
    return c.json({ ok: true, cli, appHosts });
  } catch (e) {
    return c.json(
      {
        ok: false,
        cli,
        error: `aspire ps failed: ${e instanceof Error ? e.message : String(e)}`,
        appHosts: [],
      },
      200,
    );
  }
});
