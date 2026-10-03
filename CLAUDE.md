# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

pnpm workspace — always run from the repo root unless noted.

```bash
pnpm install                           # bootstrap all workspaces
pnpm dev:server                        # tsx watch on server (port 5180)
pnpm dev:ui                            # vite dev on 5173, proxies /api → 5180
pnpm build                             # UI build → server/public, then server tsc
pnpm start                             # node dist/index.js (after build)
pnpm test                              # vitest run (server only)
pnpm --filter @mango/server test:watch
pnpm --filter @mango/server test ejson    # single test file
pnpm --filter @mango/ui typecheck     # tsc -b --noEmit (UI has no test runner)
pnpm aspire                            # what Aspire's WithMango() invokes: install + UI build + server dev

# Local TypeScript Aspire AppHost (apphost.ts) — orchestrates server + UI under
# the Aspire dashboard with auto-injected OTLP. Bootstrapped via `aspire init`.
aspire run                             # launch dashboard, mango-server, mango-ui
pnpm aspire:build                      # tsc -p tsconfig.apphost.json — typecheck the apphost
pnpm aspire:lint                       # eslint apphost.ts

# Desktop (Tauri 2)
pnpm compile-server                    # bun build --compile → desktop/bin/mango-server-<triple>
pnpm tauri:dev                         # native shell + Vite HMR (sidecar NOT used here)
pnpm tauri:build                       # full bundle (.dmg / .msi / .deb / .AppImage)
```

The UI has no separate test runner — all tests live in `server/test/` and run under vitest. There's no repo-wide linter; rely on `tsc` strict-mode (the server has `noUncheckedIndexedAccess`).

## Architecture

Three-tier monorepo: a **Hono API + JSON-file store** (`server/`), a **React 19 + Vite SPA** (`ui/`), and a **Tauri 2 desktop shell** (`desktop/`) that bundles the server as a compiled sidecar binary. The same server binary backs all three deployment targets (Aspire, Docker, desktop) — what differs is who launches it and where `MANGO_DATA_DIR` points.

### Multi-connection model

Every collection-scoped API path is prefixed with a connection ID: `/api/connections/:cid/collections/...`, `/api/connections/:cid/shell`. The server caches one `MongoClient` per connection ID in `server/src/config.ts` (in-memory `Map`); connection metadata (URI, default DB, color) is persisted as JSON files under `$MANGO_DATA_DIR/` (`connections.json`, `ai-settings.json`) via `server/src/store/jsonFile.ts` (atomic write: temp file + rename, single-process server so no locking needed). URIs and the AI settings blob are encrypted at rest with AES-256-GCM (`server/src/store/crypto.ts`). The master key comes from `MANGO_MASTER_KEY` (base64 or hex, 32 bytes) — without it, the server logs a warning and uses an ephemeral key, meaning saved connections become unreadable after restart.

**Backwards-compat seed:** if no connections exist and `MONGO_URL` is set, `seedFromEnvIfEmpty()` creates a "Default" connection on boot. This is how the older single-URL Aspire/Docker users keep working without a migration step.

The data dir defaults to `./.mango/` (dev), Tauri overrides to OS app-data, Docker mounts `/data`. The JSON files are human-readable (URI ciphertext aside) so users can inspect or hand-edit if needed.

### Run modes (`MANGO_MODE`)

`server/src/mode.ts` resolves a server-wide mode that the UI fetches once at boot via `/api/config`:

- **multi** (default) — connection manager is shown; the legacy `seedFromEnvIfEmpty()` creates a "Default" connection from `MONGO_URL` only when the table is empty.
- **standalone** — set `MANGO_MODE=standalone` plus `MONGO_URL` (Docker / Aspire). On every boot the server upserts a fixed-ID connection (`STANDALONE_CONNECTION_ID = "standalone"`) so env changes win over whatever's persisted in `connections.json`. POST/PATCH/DELETE on `/api/connections` return 403, and the UI's `ConnectionPicker` renders a static label instead of a dropdown.

The Aspire `WithMango()` extension defaults to standalone (pass `standalone: false` to opt out). The Tauri desktop shell stays in multi mode — that's the whole point of having a workbench.

### EJSON everywhere

The wire format on every collection/shell/document endpoint is **MongoDB Extended JSON in canonical (non-relaxed) mode** — `{ "$oid": "..." }`, `{ "$date": "..." }`, `{ "$numberDecimal": "..." }`. Both server (`server/src/ejson.ts`) and UI (`ui/src/api/client.ts`) parse responses through `bson`'s `EJSON.parse` with `relaxed: false`. When adding a new endpoint that returns Mongo documents, use `stringifyEJSON` and set `content-type: application/json; charset=utf-8` manually — do **not** use `c.json(...)` for document payloads, since it would double-encode through the standard JSON serializer and lose type fidelity.

The AI provider's filter output is also EJSON (see the system prompt in `server/src/providers/types.ts`).

### AI provider abstraction

Four providers behind a single `AiProvider` interface (`server/src/providers/types.ts`): `openai` (any OpenAI-compatible endpoint — OpenAI, GitHub Models, Azure, Ollama) plus three that spawn the user's installed CLI per request — `copilot`, `claude-code` and `codex`. Switched by `AI_PROVIDER` env or the saved AI settings. Each implements `chat()` and `listModels()`; the CLI providers query the live account catalog (Copilot: `copilot --acp` `session/new`; Claude Code: stream-json `initialize` control request; Codex: `codex app-server` `model/list`) and cache it for 10 minutes — don't reintroduce hardcoded model lists, they go stale. The `/api/ai/query` route samples 30 documents from the target collection (`schema-sampling.ts`) and renders a schema text into the system prompt before calling the provider.

### Desktop sidecar

`pnpm compile-server` runs `bun build --compile` on the server entry, producing a single self-contained binary at `desktop/bin/mango-server-<rust-target-triple>`. Tauri's `externalBin` in `desktop/src-tauri/tauri.conf.json` references `../bin/mango-server` and Tauri appends the host triple at bundle time. **The sidecar binary is only used by `tauri:build` and `tauri:dev`** — when you change server code, re-run `pnpm compile-server` for `tauri:build`, but `tauri:dev` runs the UI via Vite HMR and is unrelated to the sidecar (see `desktop/README.md`).

The bundled UI is shipped as a Tauri resource (`bundle.resources` maps `server/public` → `Resources/ui`). `lib.rs` reads `app.path().resource_dir()` and passes its `ui` subpath to the sidecar via the `STATIC_DIR` env var, so the same Hono server that serves `/api/*` also serves `index.html`. After the sidecar's `/api/health` probe succeeds, lib.rs redirects the WebView from `tauri://` to `http://127.0.0.1:<picked-port>` so all relative `/api/...` fetches share an origin with the UI.

### Local TypeScript Aspire AppHost (`apphost.ts`)

`apphost.ts` at the repo root is a TypeScript Aspire AppHost (scaffolded via `aspire init --language typescript`). Running `aspire run` boots the Aspire dashboard, the Hono server (via `pnpm dev` → `tsx watch`), and the Vite UI, all wired together:

- `addJavaScriptApp("mango-server", "./server", { runScriptName: "dev" })` — starts the server's `dev` script. `withHttpEndpoint({ env: "PORT" })` allocates a port and exposes it via `PORT`, which `server/src/config.ts` reads. `withOtlpExporter()` makes Aspire inject `OTEL_EXPORTER_OTLP_ENDPOINT` pointing at the dashboard.
- `addViteApp("mango-ui", "./ui")` — starts Vite. `withHttpEndpoint({ env: "VITE_PORT" })` matches what `ui/vite.config.ts` reads. `withReference(server)` plus `withEnvironment("VITE_MANGO_API", server.getEndpoint("http"))` points the Vite `/api` proxy at the server's allocated port. `withEnvironment("VITE_OTEL_ENABLED", "true")` turns on the browser OTel SDK.

Because the root `package.json` has `"type": "module"` (required for top-level await in `apphost.ts`) — adding plain `.js` files at the repo root would now require a `"type": "commonjs"` override in their own folder; sub-workspaces are unaffected because each has its own `package.json`.

### Server / UI OpenTelemetry instrumentation

Telemetry is **opt-in** — without the env vars below, the OTel modules are loaded but never start, so it's a true no-op outside an Aspire run.

- **Server** (`server/src/instrumentation.ts`) — imported as the very first line of `server/src/index.ts` so the Node SDK can install loader hooks before Hono / mongodb are required. Activates when `OTEL_EXPORTER_OTLP_ENDPOINT` is set (gRPC). Auto-instruments HTTP, fetch, mongodb, etc.; `fs` is disabled because it's noise. Under Aspire, this env var is auto-injected by `withOtlpExporter()`.
- **UI** (`ui/src/telemetry.ts`) — imported first in `ui/src/main.tsx`. Activates when `VITE_OTEL_ENABLED=true`. Posts spans (OTLP/HTTP+JSON) to a same-origin endpoint (default `/api/otlp`) so the browser bundle is endpoint-agnostic.
- **Browser → dashboard proxy** (`server/src/routes/otlp.ts`) — `/api/otlp/v1/{traces,metrics,logs}` forwards browser telemetry to `OTEL_EXPORTER_OTLP_HTTP_ENDPOINT` (defaults to the gRPC endpoint with port `4317` swapped to `4318`). Avoids needing CORS configured on the dashboard.

### Aspire integration

`aspire/Mango.Aspire.Hosting/MangoExtensions.cs` is a standalone .NET class library (NuGet ID `Mango.Aspire.Hosting`) exposing `IResourceBuilder<MongoDBServerResource>.WithMango()`. It adds an `AddContainer` resource for the published Mango image (default `ghcr.io/philbir/mango:latest` — override via the `image`/`tag` parameters) and points it at the wired-up Mongo container by setting `MONGO_URL` from the Mongo resource's `ConnectionStringExpression` (Aspire rewrites the host to the Mongo container's network alias at runtime). Defaults to standalone mode (`MANGO_MODE=standalone`); pass `standalone: false` to opt out. The JSON store persists in a named volume mounted at `/data`. AI / master-key / data-dir config keys (`Mango:Ai:*`, `Mango:MasterKey`) are forwarded as env vars. The `Aspire.Hosting.JavaScript` package is **not** referenced — earlier versions ran `yarn run aspire` against this repo, but the container approach removes the local-node-toolchain requirement.

## Conventions

- **Server** is ESM (`"type": "module"`) — relative imports must include the `.js` extension even from `.ts` source. `tsconfig.json` uses `module: NodeNext`.
- **Ports:** server 5180 (Hono default), Vite 5173 (matches Tauri's `devUrl`). Override with `PORT` and `VITE_PORT`.
- The `desktop/` workspace has no `node_modules` of its own beyond `@tauri-apps/cli`; the actual server it ships is the compiled bun binary, not a Node install.
- **UI styling:** `ui/src/index.css` remaps Tailwind's `slate`/`sky`/status color variables per theme (light gets a higher-contrast scale; dark keeps stock) — so keep using `text-slate-500`-style utilities rather than hand-picked hexes, and don't reach for `slate-400` as body text. Buttons use the `btn` / `btn-sm` / `btn-icon` + `btn-primary` / `btn-outline` / `btn-ghost` / `btn-danger` utilities (24/28px hit targets), tab strips use `seg` + `seg-item` with `data-active`, and small-caps section labels use `eyebrow`. Solid primary fills are `bg-accent` (not `bg-sky-500`) so white text stays AA in both themes. Minimum text size is 11px.
- **UI preferences** (`ui/src/settings.tsx`): defaults are `theme: "system"` (follows `prefers-color-scheme`; use `resolvedTheme` for editors that need a concrete dark/light) and `tabMode: true`. Persistence differs by target — the web build keeps them in `sessionStorage` only; the desktop build additionally round-trips them through `GET/PUT /api/system/ui-settings` (`$MANGO_DATA_DIR/ui-settings.json`) so they survive WebView cache clears. Don't reintroduce `localStorage` writes.
- **Versioning:** the git tag is the version. Every versioned file (root/ui/server/desktop `package.json`, `tauri.conf.json`, `Cargo.toml`, the `mango-desktop` entry in `Cargo.lock`) stays at `0.0.0-dev`; tag-triggered workflows stamp them via `node scripts/set-version.mjs <tag>`. Don't bump versions in PRs. The server reports its version from `server/package.json` (`server/src/version.ts`); the UI footer uses `git describe`/the tag via `ui/vite.config.ts`.
- **Base path (`MANGO_BASE_PATH`):** the server mounts everything under the prefix at runtime (`server/src/basePath.ts`) and injects `<base href>` + `window.__MANGO_BASE__` into index.html; Vite builds with `base: "./"`. In the UI, never write a bare `"/api/..."` or `"/assets/..."` URL — use `apiFetch` inside `ui/src/api/client.ts`, `withBase()` (`ui/src/api/base.ts`) everywhere else. `server/test/base-path.test.ts` scans `ui/src` and fails on violations.
- **API health gate:** `ui/src/features/health/ApiHealthGate.tsx` mounts the app only after `GET /api/health` answers (`server/src/health.ts`), and shows one error screen (Retry / Diagnose / Open logs) instead of per-query toasts. Client errors that mean "no API here" (HTML body, proxy 502–504, fetch rejection) are `isApiUnavailable()` and skip the toaster — keep new fetch paths going through `handleJson`/`handlePlainJson`. On desktop, the WebView starts on the bundled origin and the gate polls the shell's `sidecar_status` command until `lib.rs` navigates to the sidecar. New sidecar-side runtime shims go in `server/src/bun-compat.ts`.
- **pnpm isolation:** dependencies aren't hoisted, so every workspace must declare what it imports in its own `package.json` (yarn used to mask missing ones). Security pins live under `overrides:` in `pnpm-workspace.yaml`, alongside `minimumReleaseAge` (48h supply-chain cooldown, in minutes).
