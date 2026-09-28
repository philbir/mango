use base64::Engine;
use std::collections::VecDeque;
use std::net::TcpListener;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{Manager, RunEvent, WindowEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_updater::UpdaterExt;

#[derive(serde::Serialize, Clone)]
struct UpdateInfo {
    version: String,
    current_version: String,
    body: Option<String>,
}

/// Check GitHub releases for a newer version. Returns `null` when the app is
/// already up to date, or an `UpdateInfo` object when an update is available.
#[tauri::command]
async fn check_for_update(app: tauri::AppHandle) -> Result<Option<UpdateInfo>, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => Ok(Some(UpdateInfo {
            version: update.version.clone(),
            current_version: update.current_version.clone(),
            body: update.body.clone(),
        })),
        Ok(None) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Download and install an available update, then restart the app.
/// Silently returns `Ok(())` if there is nothing to install.
#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;
    if let Some(update) = update {
        update
            .download_and_install(|_chunk_len, _content_len| {}, || {})
            .await
            .map_err(|e| e.to_string())?;
        app.restart();
    }
    Ok(())
}

fn pick_free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("could not bind to a free local port")
        .local_addr()
        .unwrap()
        .port()
}

/// Resolve the AES-256-GCM master key the sidecar should use.
///
/// 1. If `MANGO_MASTER_KEY` is already in the env, pass it through unchanged.
///    (Lets advanced users override via `launchctl setenv` etc.)
/// 2. Otherwise read `<data_dir>/master.key` if it exists.
/// 3. Otherwise generate a fresh 32-byte key, persist it (0600 on unix), and return.
///
/// On any IO failure we log and fall back to letting the sidecar generate an
/// ephemeral key — better than crashing the app on first launch.
fn ensure_master_key(data_dir: &Path) -> Option<String> {
    if let Ok(existing) = std::env::var("MANGO_MASTER_KEY") {
        if !existing.trim().is_empty() {
            log::info!("MANGO_MASTER_KEY supplied via env — using it");
            return Some(existing);
        }
    }
    let key_path = data_dir.join("master.key");
    if let Ok(contents) = std::fs::read_to_string(&key_path) {
        let trimmed = contents.trim().to_string();
        if !trimmed.is_empty() {
            log::info!("loaded master key from {}", key_path.display());
            return Some(trimmed);
        }
    }
    let mut bytes = [0u8; 32];
    rand::fill(&mut bytes);
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    if let Err(e) = std::fs::write(&key_path, &encoded) {
        log::error!(
            "could not write master key to {}: {} — sidecar will use an ephemeral key",
            key_path.display(),
            e,
        );
        return None;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(&key_path) {
            let mut perms = meta.permissions();
            perms.set_mode(0o600);
            let _ = std::fs::set_permissions(&key_path, perms);
        }
    }
    log::info!("generated new master key at {}", key_path.display());
    Some(encoded)
}

struct ServerState {
    child: Mutex<Option<CommandChild>>,
    status: Mutex<SidecarStatus>,
}

/// How many trailing sidecar output lines `sidecar_status` hands the UI.
const RECENT_LOG_LINES: usize = 60;
/// Readiness probe budget: 120 × 250ms. First launch after install can be
/// slow while macOS verifies the bundle.
const PROBE_ATTEMPTS: u32 = 120;

/// What the UI's boot gate shows while it's still on the tauri:// origin —
/// the only place it can learn why the server never came up.
#[derive(serde::Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct SidecarStatus {
    /// "starting" | "ready" | "failed"
    state: String,
    port: u16,
    error: Option<String>,
    recent_logs: VecDeque<String>,
    log_dir: Option<String>,
}

impl ServerState {
    fn update(&self, f: impl FnOnce(&mut SidecarStatus)) {
        if let Ok(mut status) = self.status.lock() {
            f(&mut status);
        }
    }

    fn state(&self) -> String {
        self.status.lock().map(|s| s.state.clone()).unwrap_or_default()
    }

    fn kill_child(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(child) = guard.take() {
                let _ = child.kill();
            }
        }
    }
}

#[tauri::command]
fn sidecar_status(state: tauri::State<'_, Arc<ServerState>>) -> SidecarStatus {
    state.status.lock().map(|s| s.clone()).unwrap_or_default()
}

#[tauri::command]
fn open_log_dir(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).ok();
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// Relaunch the whole app (and with it a fresh sidecar on a new port).
#[tauri::command]
fn restart_app(app: tauri::AppHandle, state: tauri::State<'_, Arc<ServerState>>) {
    state.kill_child();
    app.restart();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("mango".into()),
                    }),
                ])
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            check_for_update,
            install_update,
            sidecar_status,
            open_log_dir,
            restart_app
        ])
        .setup(|app| {
            let port = pick_free_port();
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("could not resolve app data dir: {e}"))?;
            std::fs::create_dir_all(&app_data_dir).ok();
            let data_dir = app_data_dir.to_string_lossy().to_string();

            // Bundled UI assets — see `bundle.resources` in tauri.conf.json.
            let static_dir = app
                .path()
                .resource_dir()
                .map(|p| p.join("ui").to_string_lossy().to_string())
                .unwrap_or_default();

            let log_dir = app
                .path()
                .app_log_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();

            let state = Arc::new(ServerState {
                child: Mutex::new(None),
                status: Mutex::new(SidecarStatus {
                    state: "starting".into(),
                    port,
                    log_dir: (!log_dir.is_empty()).then(|| log_dir.clone()),
                    ..Default::default()
                }),
            });
            app.manage(state.clone());

            let master_key = ensure_master_key(&app_data_dir);

            log::info!("starting mango-server sidecar on 127.0.0.1:{port}");
            log::info!("MANGO_DATA_DIR = {data_dir}");
            log::info!("MANGO_LOG_DIR  = {log_dir}");
            log::info!("STATIC_DIR     = {static_dir}");

            let fail = |state: &ServerState, message: String| {
                log::error!("{message}");
                state.update(|s| {
                    s.state = "failed".into();
                    s.error = Some(message);
                });
            };

            let sidecar = match app.shell().sidecar("mango-server") {
                Ok(cmd) => cmd,
                Err(e) => {
                    fail(&state, format!("mango-server sidecar not found in the app bundle: {e}"));
                    return Ok(());
                }
            };
            let mut sidecar = sidecar
                .env("PORT", port.to_string())
                .env("HOST", "127.0.0.1")
                .env("MANGO_DATA_DIR", data_dir.clone())
                .env("MANGO_LOG_DIR", log_dir)
                .env("STATIC_DIR", static_dir)
                .env("AUTH_MODE", "none")
                .env("MANGO_VERSION", app.package_info().version.to_string());
            if let Some(key) = master_key {
                sidecar = sidecar.env("MANGO_MASTER_KEY", key);
            }

            let (mut rx, child) = match sidecar.spawn() {
                Ok(spawned) => spawned,
                Err(e) => {
                    fail(&state, format!("could not start mango-server: {e}"));
                    return Ok(());
                }
            };
            if let Ok(mut guard) = state.child.lock() {
                *guard = Some(child);
            }

            let events_state = state.clone();
            tauri::async_runtime::spawn(async move {
                let remember = |line: String| {
                    events_state.update(|s| {
                        if s.recent_logs.len() == RECENT_LOG_LINES {
                            s.recent_logs.pop_front();
                        }
                        s.recent_logs.push_back(line);
                    });
                };
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            let line = String::from_utf8_lossy(&line).trim_end().to_string();
                            log::info!("[mango-server] {line}");
                            remember(line);
                        }
                        CommandEvent::Stderr(line) => {
                            let line = String::from_utf8_lossy(&line).trim_end().to_string();
                            log::warn!("[mango-server] {line}");
                            remember(line);
                        }
                        CommandEvent::Terminated(payload) => {
                            let message = match (payload.code, payload.signal) {
                                (Some(code), _) => format!("mango-server exited with code {code}"),
                                (None, Some(signal)) => format!("mango-server was killed by signal {signal}"),
                                _ => "mango-server exited".to_string(),
                            };
                            log::error!("[mango-server] terminated: {payload:?}");
                            events_state.update(|s| {
                                s.state = "failed".into();
                                s.error = Some(message);
                            });
                            break;
                        }
                        _ => {}
                    }
                }
            });

            // Wait for the server to be ready, then point the webview at it.
            // Any HTTP answer counts as "up" — a 503 from a failed health
            // check is better explained by the UI's gate on the real origin.
            // Until then (or if it never comes up) the webview stays on
            // tauri://, where the gate polls `sidecar_status` instead.
            let app_handle = app.handle().clone();
            let probe_state = state.clone();
            tauri::async_runtime::spawn(async move {
                let mut ready = false;
                for attempt in 0..PROBE_ATTEMPTS {
                    if probe_state.state() == "failed" {
                        return;
                    }
                    if probe_responds(port).await {
                        log::info!("sidecar ready after {attempt} probe(s)");
                        ready = true;
                        break;
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                }
                if !ready {
                    let secs = PROBE_ATTEMPTS / 4;
                    fail(&probe_state, format!("mango-server did not respond within {secs}s"));
                    return;
                }
                probe_state.update(|s| s.state = "ready".into());
                if let Some(window) = app_handle.get_webview_window("main") {
                    let target = format!("http://127.0.0.1:{port}");
                    log::info!("navigating webview to {target}");
                    if let Err(e) = window.eval(&format!("window.location.replace({target:?})")) {
                        log::error!("could not navigate webview: {e}");
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Exit too: the app-menu Quit (⌘Q) goes straight there without
            // ExitRequested, which used to orphan the sidecar on every quit.
            if let RunEvent::ExitRequested { .. }
            | RunEvent::Exit
            | RunEvent::WindowEvent {
                event: WindowEvent::Destroyed,
                ..
            } = event
            {
                if let Some(state) = app_handle.try_state::<Arc<ServerState>>() {
                    state.kill_child();
                }
            }
        });
}

/// Tiny inline HTTP/1.0 GET /api/health — true once the server answers with
/// any HTTP status line. Avoids pulling in reqwest just for a readiness loop.
async fn probe_responds(port: u16) -> bool {
    use std::io::{Read, Write};
    use std::net::{SocketAddr, TcpStream};

    let addr: SocketAddr = match format!("127.0.0.1:{port}").parse() {
        Ok(a) => a,
        Err(_) => return false,
    };
    let mut stream = match TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(250))
    {
        Ok(s) => s,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_millis(500)));
    let req = b"GET /api/health HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
    if stream.write_all(req).is_err() {
        return false;
    }
    let mut buf = [0u8; 64];
    let n = match stream.read(&mut buf) {
        Ok(n) => n,
        Err(_) => return false,
    };
    buf[..n].starts_with(b"HTTP/1.")
}
