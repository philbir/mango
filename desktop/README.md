# Mango Desktop

Tauri 2 wrapper that runs Mango as a native desktop app. Bundles the server as a sidecar binary, spawns it on launch, and points an OS-native webview at the local URL.

## Architecture

```
┌──────────────── Mango.app ────────────────┐
│                                           │
│   Tauri shell (Rust)                      │
│     ↓ spawns                              │
│   mango-server  (sidecar binary)          │
│     ├ Hono on 127.0.0.1:<random>          │
│     ├ JSON state at $APPDATA/dev.mango.app/│
│     └ Static UI assets                    │
│     ↑                                     │
│   OS-native WebView2/WKWebView/WebKitGTK  │
│                                           │
└───────────────────────────────────────────┘
```

The sidecar is a single self-contained binary built with `bun build --compile`. No Node, npm, or yarn required on the user's machine.

## One-time prerequisites

```bash
# Rust toolchain (Tauri itself)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Bun (sidecar compiler)
curl -fsSL https://bun.sh/install | bash

# Tauri CLI is pulled in by `yarn install` in this workspace
yarn install
```

## Dev workflow

There are two dev modes — pick one:

### Browser mode — fastest UI iteration

You don't need Tauri running at all if you're working on the UI:

```bash
# terminal 1 — server
yarn dev:server

# terminal 2 — Vite with HMR
yarn dev:ui
# → open http://localhost:5173
```

Vite proxies `/api` to the server on `:5180`. UI hot-reloads, server auto-restarts via `tsx watch`. Connection manager, AI, everything works.

### Native desktop mode — for testing the actual app

```bash
# 1. Build the sidecar binary for your machine (one-time per server change).
yarn compile-server

# 2. Build the UI assets the sidecar will serve.
yarn build         # from repo root — runs UI + server tsc

# 3. Launch the desktop app.
yarn tauri:dev
```

For each iteration on the server, re-run `yarn compile-server`. For each iteration on the UI, re-run `yarn workspace @mango/ui build` (the sidecar serves from `server/public`).

## Production builds

```bash
# build sidecar for your platform
yarn compile-server

# build UI
yarn build

# package
yarn tauri:build
# → src-tauri/target/release/bundle/{dmg,msi,deb,AppImage}/...
```

For cross-platform releases, run the same commands on each target's CI runner — the GitHub Actions matrix is sketched in `.github/workflows/desktop-release.yml` (Phase 2 — not yet checked in).

## Sidecar binary naming

Tauri's `externalBin` in `src-tauri/tauri.conf.json` references `../bin/mango-server`. At build time Tauri appends the Rust target triple per-platform, looking for one of:

```
desktop/bin/mango-server-aarch64-apple-darwin
desktop/bin/mango-server-x86_64-apple-darwin
desktop/bin/mango-server-x86_64-pc-windows-msvc.exe
desktop/bin/mango-server-x86_64-unknown-linux-gnu
```

`yarn compile-server` produces the file named for **your** host triple (auto-detected from `rustc -vV`). To build for a non-host triple, pass it: `yarn compile-server x86_64-pc-windows-msvc`.

## Auth mode

Desktop runs with `AUTH_MODE=none` — single-user on a personal machine. The server-mode (Docker / Aspire) variant runs `AUTH_MODE=oidc`.

## Data directory

The sidecar receives `MANGO_DATA_DIR=<OS app-data path>` at launch. Defaults:

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/dev.mango.app/` |
| Windows | `%APPDATA%\dev.mango.app\` |
| Linux | `~/.local/share/dev.mango.app/` |

Contains `connections.json`, `ai-settings.json`, and `master.key`.

## Master key (encryption at rest)

On first run, if `MANGO_MASTER_KEY` is unset, the server logs a warning and uses an ephemeral key. For a real deployment, the desktop wrapper should:

1. Generate a 32-byte random key on first launch.
2. Store it in the OS keychain (macOS Keychain / Windows Credential Manager / Secret Service on Linux) via `tauri-plugin-stronghold` or platform-native APIs.
3. Inject it as `MANGO_MASTER_KEY` when spawning the sidecar.

This is **not yet implemented** — see [../docs/ROADMAP.md](../docs/ROADMAP.md) Phase 2.

## App icons

```bash
yarn icons path/to/source-1024.png
# generates the full set in src-tauri/icons/
```

The repo doesn't ship icons yet — Tauri will use a placeholder.
