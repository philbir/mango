# Roadmap

## Phase 1 — Standalone foundation ✅

- [x] Connection manager (SQLite + AES-GCM)
- [x] Multi-connection routing (`/api/connections/:cid/...`)
- [x] Backwards compat: seed Default connection from `MONGO_URL`
- [x] AI provider abstraction (OpenAI-compat + Copilot SDK)
- [x] Mango.Hosting Aspire extension as standalone .NET class library

## Phase 2 — Tauri desktop release

- [ ] CI matrix: build sidecar binaries for `aarch64-apple-darwin`, `x86_64-apple-darwin`, `x86_64-pc-windows-msvc`, `x86_64-unknown-linux-gnu`
- [ ] Code signing + notarization (macOS, Windows)
- [ ] Tauri auto-updater wired to GitHub Releases
- [ ] OS-keychain master key (`tauri-plugin-stronghold` or platform-native)
- [ ] First-run onboarding (no `MONGO_URL` → "Add your first connection" UI)
- [ ] App icon + branding

## Phase 3 — Server mode hardening (Docker / k8s)

- [ ] OIDC auth (`openid-client`, AUTH_MODE=oidc)
- [ ] Two roles: viewer / editor
- [ ] User identity + connection ownership / sharing
- [ ] Per-user saved queries, history, pinned collections
- [ ] Audit log
- [ ] Rate limiting on `/api/ai/*`
- [ ] Helm chart + docker-compose example
- [ ] CSRF protection

## Phase 4 — Power-user features

- [ ] Insert / delete / bulk update (gated on editor role)
- [ ] Index manager: list, create, drop, explain
- [ ] Aggregation pipeline builder UI
- [ ] Saved queries (per user/connection)
- [ ] Export / import (JSONL, CSV streaming)
- [ ] Sharing — invite OIDC user to a connection
- [ ] Schema inference visualization (extend the existing schema endpoint)

## Phase 5 — Adjacent / nice-to-have

- [ ] Multi-database picker per connection (call `listDatabases`)
- [ ] Query history with replay
- [ ] Diff view in document editor
- [ ] CSV/JSON drop-zone import for collections
- [ ] Webhook / scheduled query alerts (pairs with Antoniq's `schedule` skill)
- [ ] Browser PWA with desktop install hint

## Out of scope (for now)

- Sharded cluster admin UI (Compass / Studio 3T territory)
- Replica-set topology management
- Mongo schema migrations / DSL
- Full BSON dump / restore tooling (use `mongodump`)
