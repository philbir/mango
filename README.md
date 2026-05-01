# 🥭 Mango

A friendly MongoDB workbench. Browse, edit, query, and shell into any MongoDB — with an AI assistant that understands your schema.

Runs three ways:

- **Aspire integration** — drop into a .NET Aspire AppHost as a one-liner (`.WithMango()`), replacing `WithMongoExpress()`.
- **Docker container** — single image, configure via env, mount a volume for SQLite-backed state.
- **Desktop app** — Tauri-wrapped native app for macOS, Windows, and Linux. Runs offline, single user, no auth.

## Stack

- **Server:** Node 22 + TypeScript + [Hono](https://hono.dev) + the official `mongodb` driver. SQLite-backed connection store via `better-sqlite3` with AES-GCM encryption at rest.
- **UI:** React 19 + Vite + Tailwind v3 + Monaco (filter / shell with mongo-aware autocomplete) + CodeMirror (document editor) + `@uiw/react-json-view` (interactive JSON) + `@tanstack/react-table`.
- **AI:** Pluggable provider — OpenAI / GitHub Models / Azure OpenAI (any OpenAI-compatible endpoint), or `@github/copilot-sdk` for direct Copilot.
- **Desktop:** Tauri 2 with a Bun-compiled sidecar (single self-contained binary).
- **Aspire:** `Mango.Hosting` NuGet package — `IResourceBuilder<MongoDBServerResource>.WithMango()`.

## Repository layout

```
mango/
├── server/        Hono API + SQLite store (Node)
├── ui/            React + Vite SPA
├── desktop/       Tauri shell (Rust) + sidecar config
├── aspire/        Mango.Hosting (.NET class library)
├── docker/        Dockerfile + compose example
└── docs/          Roadmap, deployment notes, architecture
```

## Quick start (standalone, dev)

```bash
yarn install
MONGO_URL="mongodb://localhost:27017/mydb" yarn aspire
# → http://localhost:5180
```

`MONGO_URL` is optional — Mango works without it and will prompt for a connection in the UI. If set, it's auto-seeded as a "Default" connection on first run.

## Connection manager

Mango stores its connections in a SQLite database (`./.mango/mango.db` by default; `$MANGO_DATA_DIR` overrides). Each connection is `{name, uri, defaultDatabase, color}` with the URI encrypted at rest using AES-256-GCM.

To make encrypted state portable across machines / restarts, set the master key:

```bash
export MANGO_MASTER_KEY="$(openssl rand -base64 32)"
```

If unset, Mango generates an ephemeral per-process key (logged warning) — fine for dev, not for production.

## AI

| Variable | Default | Purpose |
|---|---|---|
| `AI_PROVIDER` | `openai` | `openai` or `copilot`. |
| `AI_MODEL` | provider default | `gpt-4o-mini`, `claude-sonnet-4.5`, etc. |
| `AI_API_KEY` | _(unset)_ | OpenAI provider only. |
| `AI_BASE_URL` | OpenAI default | OpenAI provider only — point at GitHub Models, Azure, Ollama, etc. |
| `GITHUB_TOKEN` | _(unset)_ | Copilot provider — falls back to logged-in Copilot CLI session if unset. |

## Aspire integration

```csharp
var mongo = builder.AddMongoDB("mongo")
    .WithLifetime(ContainerLifetime.Persistent)
    .WithMango();           // ← drops in the Mango UI
```

Configuration via `dotnet user-secrets` in the AppHost project:

```bash
dotnet user-secrets set "Mango:Ai:Provider" "copilot"
dotnet user-secrets set "Mango:Ai:Model"    "claude-sonnet-4.5"
dotnet user-secrets set "Mango:MasterKey"   "$(openssl rand -base64 32)"
```

See [`aspire/Mango.Hosting/MangoExtensions.cs`](aspire/Mango.Hosting/MangoExtensions.cs) for all options.

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md) for the full feature plan. Headlines:

- Phase 1 (✅ done) — Connection manager, AES-GCM encryption, AI assistant, Aspire integration
- Phase 2 — Tauri desktop release with auto-update + OS-keychain master key
- Phase 3 — OIDC auth (server mode), per-user state, audit log
- Phase 4 — Insert/delete/bulk, index manager, aggregation builder, sharing

## License

MIT
