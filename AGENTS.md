# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

Yarn 4 (Berry) workspace — always run from the repo root unless noted.

```bash
yarn install                           # bootstrap all workspaces
yarn dev:server                        # tsx watch on server (port 5180)
yarn dev:ui                            # vite dev on 5173, proxies /api → 5180
yarn build                             # UI build → server/public, then server tsc
yarn start                             # node dist/index.js (after build)
yarn test                              # vitest run (server only)
yarn workspace @mango/server test:watch
yarn workspace @mango/server test -- ejson    # single test file
yarn workspace @mango/ui typecheck     # tsc -b --noEmit (UI has no test runner)
yarn aspire                            # what Aspire's WithMango() invokes: install + UI build + server dev

# Desktop (Tauri 2)
yarn compile-server                    # bun build --compile → desktop/bin/mango-server-<triple>
yarn tauri:dev                         # native shell + Vite HMR (sidecar NOT used here)
yarn tauri:build                       # full bundle (.dmg / .msi / .deb / .AppImage)
```

The UI has no separate test runner — all tests live in `server/test/` and run under vitest. There's no repo-wide linter; rely on `tsc` strict-mode (the server has `noUncheckedIndexedAccess`).

## Architecture

Three-tier monorepo: a **Hono API + JSON-file store** (`server/`), a **React 19 + Vite SPA** (`ui/`), and a **Tauri 2 desktop shell** (`desktop/`) that bundles the server as a compiled sidecar binary. The same server binary backs all three deployment targets (Aspire, Docker, desktop) — what differs is who launches it and where `MANGO_DATA_DIR` points.

### Multi-connection model

Every collection-scoped API path is prefixed with a connection ID: `/api/connections/:cid/collections/...`, `/api/connections/:cid/shell`. The server caches one `MongoClient` per connection ID in `server/src/config.ts` (in-memory `Map`); connection metadata (URI, default DB, color) is persisted as JSON files under `$MANGO_DATA_DIR/` (`connections.json`, `ai-settings.json`) via `server/src/store/jsonFile.ts` (atomic write: temp file + rename). URIs and the AI settings blob are encrypted at rest with AES-256-GCM (`server/src/store/crypto.ts`). The master key comes from `MANGO_MASTER_KEY` (base64 or hex, 32 bytes) — without it, the server logs a warning and uses an ephemeral key, meaning saved connections become unreadable after restart.

**Backwards-compat seed:** if no connections exist and `MONGO_URL` is set, `seedFromEnvIfEmpty()` creates a "Default" connection on boot. This is how the older single-URL Aspire/Docker users keep working without a migration step.

The data dir defaults to `./.mango/` (dev), Tauri overrides to OS app-data, Docker mounts `/data`.

### EJSON everywhere

The wire format on every collection/shell/document endpoint is **MongoDB Extended JSON in canonical (non-relaxed) mode** — `{ "$oid": "..." }`, `{ "$date": "..." }`, `{ "$numberDecimal": "..." }`. Both server (`server/src/ejson.ts`) and UI (`ui/src/api/client.ts`) parse responses through `bson`'s `EJSON.parse` with `relaxed: false`. When adding a new endpoint that returns Mongo documents, use `stringifyEJSON` and set `content-type: application/json; charset=utf-8` manually — do **not** use `c.json(...)` for document payloads, since it would double-encode through the standard JSON serializer and lose type fidelity.

The AI provider's filter output is also EJSON (see the system prompt in `server/src/providers/types.ts`).

### AI provider abstraction

Two providers behind a single `AiProvider` interface (`server/src/providers/types.ts`): `openai` (any OpenAI-compatible endpoint — OpenAI, GitHub Models, Azure, Ollama) and `copilot` (`@github/copilot-sdk`, falls back to logged-in Copilot CLI session). Switched by `AI_PROVIDER` env. Both must implement `query()` (returns a structured filter via tool-call) and `listModels()`. The `/api/ai/query` route samples 30 documents from the target collection (`schema-sampling.ts`) and renders a schema text into the system prompt before calling the provider.

### Desktop sidecar

`yarn compile-server` runs `bun build --compile` on the server entry, producing a single self-contained binary at `desktop/bin/mango-server-<rust-target-triple>`. Tauri's `externalBin` in `desktop/src-tauri/tauri.conf.json` references `../bin/mango-server` and Tauri appends the host triple at bundle time. **The sidecar binary is only used by `tauri:build` and `tauri:dev`** — when you change server code, re-run `yarn compile-server` for `tauri:build`, but `tauri:dev` runs the UI via Vite HMR and is unrelated to the sidecar (see `desktop/README.md`).

### Aspire integration

`aspire/Mango.Aspire.Hosting/MangoExtensions.cs` is a standalone .NET class library (NuGet ID `Mango.Aspire.Hosting`) exposing `IResourceBuilder<MongoDBServerResource>.WithMango()`. It adds an `AddContainer` resource for the published Mango image (default `ghcr.io/philbir/mango:latest`) and points it at the wired-up Mongo container by setting `MONGO_URL` from the Mongo resource's `ConnectionStringExpression`. Defaults to standalone mode (`MANGO_MODE=standalone`); pass `standalone: false` to opt out. The JSON store persists in a named volume mounted at `/data`. AI / master-key / data-dir config keys (`Mango:Ai:*`, `Mango:MasterKey`) are forwarded as env vars.

## Conventions

- **Server** is ESM (`"type": "module"`) — relative imports must include the `.js` extension even from `.ts` source. `tsconfig.json` uses `module: NodeNext`.
- **Ports:** server 5180 (Hono default), Vite 5173 (matches Tauri's `devUrl`). Override with `PORT` and `VITE_PORT`.
- The `desktop/` workspace has no `node_modules` of its own beyond `@tauri-apps/cli`; the actual server it ships is the compiled bun binary, not a Node install.
- The `docker/Dockerfile` currently references the old workspace names `@antoniq/mongo-manager-{ui,server}` — they were renamed to `@mango/{ui,server}`. Fix when you next touch it.
