# Roadmap

## Phase 1 — Standalone foundation ✅

- [x] Connection manager (SQLite + AES-GCM)
- [x] Multi-connection routing (`/api/connections/:cid/...`)
- [x] Backwards compat: seed Default connection from `MONGO_URL`
- [x] AI provider abstraction (OpenAI-compat + Copilot SDK + Claude Code)
- [x] Mango.Hosting Aspire extension as standalone .NET class library
- [x] Standalone mode (`MANGO_MODE=standalone`) — single connection from env, hides connection manager
- [x] App icon + branding

## Phase 2 — Distribution ✅

- [x] Pre-built Docker image published to GHCR (multi-arch amd64/arm64)
- [x] Aspire extension uses the published container (no local node toolchain required)
- [x] NuGet package (`Mango.Hosting`) with symbols + source link
- [x] CI matrix: Tauri desktop builds for `aarch64-apple-darwin`, `x86_64-apple-darwin`, `x86_64-pc-windows-msvc`, `x86_64-unknown-linux-gnu`
- [ ] Code signing + notarization (macOS, Windows)
- [ ] Tauri auto-updater wired to GitHub Releases
- [ ] OS-keychain master key (`tauri-plugin-stronghold` or platform-native)
- [ ] First-run onboarding (no `MONGO_URL` → "Add your first connection" UI)

## Phase 3 — Mongo authentication

- [ ] **OIDC authentication to Mongo** (MongoDB's `MONGODB-OIDC` mechanism) — connect to clusters that require OAuth-issued access tokens (Atlas, enterprise SSO)
  - [ ] **Azure auth via `az login`** — pick up the developer's existing Azure CLI / `DefaultAzureCredential` token chain to connect to Azure-hosted Mongo (Cosmos DB for MongoDB vCore, Azure VMs running Mongo with Entra ID) without storing secrets in Mango
  - [ ] Generic OIDC callback flow (browser-based device code / auth-code) for non-Azure providers
  - [ ] Token refresh + re-prompt UX in the connection picker
- [ ] X.509 client cert auth (PEM upload, encrypted at rest)
- [ ] AWS IAM auth (`MONGODB-AWS`)

## Phase 4 — Power-user features

- [ ] **Index manager** — list, create, drop, explain query plans
- [ ] **Import / export** — JSONL / CSV streaming (collection ⇄ file), with field mapping for CSV
- [ ] **Saved commands** — pin filter / shell / aggregation snippets per connection
  - SQLite-backed by default (lives next to other Mango state)
  - Optional **Git provider** — sync the saved-commands store to a repo so a team shares a versioned snippet library
- [ ] Aggregation pipeline builder UI
- [ ] Insert / delete / bulk update (gated on editor role in server mode)
- [ ] Schema inference visualization (extend the existing schema endpoint)

## Phase 5 — Server-mode hardening (Docker / k8s)

- [ ] **App-level auth** — OIDC sign-in to Mango itself (`openid-client`, `AUTH_MODE=oidc`)
- [ ] Two roles: viewer / editor
- [ ] User identity + connection ownership / sharing
- [ ] Per-user saved queries, history, pinned collections
- [ ] Audit log
- [ ] Rate limiting on `/api/ai/*`
- [ ] Helm chart + docker-compose example
- [ ] CSRF protection

## Phase 6 — Adjacent / nice-to-have

- [ ] Query history with replay
- [ ] Browser PWA with desktop install hint

