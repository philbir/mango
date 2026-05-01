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
│     ├ SQLite at $APPDATA/dev.mango.app/   │
│     └ Static UI assets                    │
│     ↑                                     │
│   OS-native WebView2/WKWebView/WebKitGTK  │
│                                           │
└───────────────────────────────────────────┘
```

The sidecar is a single self-contained binary built with `bun build --compile`. No Node, npm, or yarn required on the user's machine.

## Building locally (macOS arm64 example)

```bash
# 1. Compile server to a single binary for the current platform.
cd ../server
bun build --compile --target=darwin-arm64 src/index.ts \
  --outfile ../desktop/bin/mango-server-aarch64-apple-darwin

# 2. Build the UI into server/public (the sidecar serves it statically).
cd ../ui
yarn build

# 3. Run Tauri in dev (live-reloads from Vite if you want; or static).
cd ../desktop
yarn tauri dev
```

For a release artifact:

```bash
cd ../desktop
yarn tauri build
# → src-tauri/target/release/bundle/dmg/Mango_0.1.0_aarch64.dmg
```

## Sidecar binary naming

Tauri's `externalBin` mechanism resolves `mango-server` to a per-platform binary at runtime, looking for one of:

```
desktop/bin/mango-server-aarch64-apple-darwin
desktop/bin/mango-server-x86_64-apple-darwin
desktop/bin/mango-server-x86_64-pc-windows-msvc.exe
desktop/bin/mango-server-x86_64-unknown-linux-gnu
```

Each CI runner builds the matching binary before invoking `tauri build`.

## Auth mode

Desktop runs with `AUTH_MODE=none` — single-user on a personal machine. The server-mode (Docker / Aspire) variant runs `AUTH_MODE=oidc`.

## Data directory

The sidecar receives `MANGO_DATA_DIR=<OS app-data path>` at launch. Defaults:

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/dev.mango.app/` |
| Windows | `%APPDATA%\dev.mango.app\` |
| Linux | `~/.local/share/dev.mango.app/` |

Contains `mango.db` (the connections SQLite) and any future per-user state.

## Master key (encryption at rest)

On first run, if `MANGO_MASTER_KEY` is unset, the server logs a warning and uses an ephemeral key. For a real deployment, the desktop wrapper should:

1. Generate a 32-byte random key on first launch.
2. Store it in the OS keychain (macOS Keychain / Windows Credential Manager / Secret Service on Linux) via `tauri-plugin-stronghold` or platform-native APIs.
3. Inject it as `MANGO_MASTER_KEY` when spawning the sidecar.

This is **not yet implemented** — see [ROADMAP.md](../docs/ROADMAP.md) for tracking.
