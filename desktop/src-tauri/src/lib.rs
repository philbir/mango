use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use tauri::{Manager, RunEvent, WindowEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

fn pick_free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("could not bind to a free local port")
        .local_addr()
        .unwrap()
        .port()
}

struct ServerState {
    child: Mutex<Option<CommandChild>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
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

            let sidecar = app
                .shell()
                .sidecar("mango-server")
                .expect("mango-server sidecar not found — bundle binaries at desktop/bin/")
                .env("PORT", port.to_string())
                .env("MANGO_DATA_DIR", data_dir.clone())
                .env("STATIC_DIR", static_dir)
                .env("AUTH_MODE", "none");

            let (mut rx, child) = sidecar
                .spawn()
                .expect("failed to spawn mango-server sidecar");

            let state = Arc::new(ServerState {
                child: Mutex::new(Some(child)),
            });
            app.manage(state.clone());

            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => println!(
                            "[mango-server] {}",
                            String::from_utf8_lossy(&line).trim_end()
                        ),
                        CommandEvent::Stderr(line) => eprintln!(
                            "[mango-server] {}",
                            String::from_utf8_lossy(&line).trim_end()
                        ),
                        CommandEvent::Terminated(payload) => {
                            eprintln!("[mango-server] terminated: {payload:?}");
                            break;
                        }
                        _ => {}
                    }
                }
            });

            // Wait for the server to be ready, then point the webview at it.
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                for _ in 0..60 {
                    if probe_ok(port).await {
                        break;
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                }
                if let Some(window) = app_handle.get_webview_window("main") {
                    let target = format!("http://127.0.0.1:{port}");
                    if let Err(e) = window.eval(&format!("window.location.replace({target:?})")) {
                        eprintln!("could not navigate webview: {e}");
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::ExitRequested { .. }
            | RunEvent::WindowEvent {
                event: WindowEvent::Destroyed,
                ..
            } = event
            {
                if let Some(state) = app_handle.try_state::<Arc<ServerState>>() {
                    if let Ok(mut guard) = state.child.lock() {
                        if let Some(child) = guard.take() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        });
}

/// Tiny inline HTTP/1.0 GET /api/health — checks for a 200 status line.
/// Avoids pulling in reqwest just for a healthcheck loop.
async fn probe_ok(port: u16) -> bool {
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
    String::from_utf8_lossy(&buf[..n]).contains("200 OK")
}
