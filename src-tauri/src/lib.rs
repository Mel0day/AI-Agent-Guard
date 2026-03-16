pub mod commands;
pub mod config;
pub mod event_logger;
pub mod hook_server;
pub mod mcp_scanner;
pub mod models;
pub mod rule_engine;

use crate::config::load_config;
use crate::event_logger::EventLogger;
use crate::models::{AppState, Config, PendingDecision, Rule};
use chrono::Utc;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};
use tokio::sync::{Mutex, RwLock};

/// Shared application state accessible from both Tauri commands and the hook server
pub struct SharedState {
    pub app_state: RwLock<AppState>,
    pub config: RwLock<Config>,
    pub rules: RwLock<Vec<Rule>>,
    pub logger: Arc<EventLogger>,
    pub pending_decisions: Mutex<HashMap<String, PendingDecision>>,
    pub app_handle: Mutex<Option<tauri::AppHandle>>,
}

impl SharedState {
    pub fn new(config: Config, logger: Arc<EventLogger>) -> Self {
        let mut all_rules = rule_engine::built_in_rules();
        // Apply persisted overrides to rule enabled state
        for rule in &mut all_rules {
            if let Some(&enabled) = config.rule_overrides.get(&rule.id) {
                rule.enabled = enabled;
            }
        }

        let pause_until = config.pause_until;
        let is_paused =
            config.is_paused && pause_until.map(|until| Utc::now() < until).unwrap_or(true); // no expiry = pause indefinitely

        SharedState {
            app_state: RwLock::new(AppState {
                is_paused,
                pause_until,
                ..AppState::default()
            }),
            config: RwLock::new(config),
            rules: RwLock::new(all_rules),
            logger,
            pending_decisions: Mutex::new(HashMap::new()),
            app_handle: Mutex::new(None),
        }
    }
}

// ─── Tauri Setup ─────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let config = load_config().unwrap_or_default();
    let logger = Arc::new(EventLogger::new().expect("Failed to initialize event logger"));
    let shared_state = Arc::new(SharedState::new(config, logger));

    let state_for_server = Arc::clone(&shared_state);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(shared_state)
        .setup(|app| {
            // Store app handle in shared state for event emission
            let shared = app.state::<Arc<SharedState>>();
            let handle = app.handle().clone();
            let shared_clone = Arc::clone(&*shared);

            tauri::async_runtime::spawn(async move {
                let mut app_handle_lock = shared_clone.app_handle.lock().await;
                *app_handle_lock = Some(handle);
            });

            // Start hook server in background
            tauri::async_runtime::spawn(async move {
                if let Err(e) = hook_server::start_hook_server(state_for_server).await {
                    tracing::error!("Hook server failed: {}", e);
                }
            });

            // ── System tray ──────────────────────────────────────────────────
            let show_item =
                MenuItem::with_id(app, "show", "Show AI Agent Guard", true, None::<&str>)?;
            let pause_item =
                MenuItem::with_id(app, "pause", "Pause Protection", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &pause_item, &quit_item])?;

            TrayIconBuilder::new()
                .icon(tauri::include_image!("icons/tray-icon.png"))
                .icon_as_template(true) // macOS: adapts to dark/light menu bar
                .tooltip("AI Agent Guard — Protecting Claude Code")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        // Left-click: show/focus main window
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "pause" => {
                        let _ = app.emit("tray_pause_clicked", ());
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;
            // ─────────────────────────────────────────────────────────────────

            // ── Startup MCP scan ─────────────────────────────────────────────
            let handle_startup = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Small delay so the frontend has time to mount its event listener
                tokio::time::sleep(tokio::time::Duration::from_millis(800)).await;
                if let Ok(items) = mcp_scanner::scan_mcp_configs() {
                    if !items.is_empty() {
                        let _ = handle_startup.emit("mcp_scan_updated", &items);
                    }
                }
            });

            // ── MCP config file watcher ───────────────────────────────────────
            let handle_watch = app.handle().clone();
            std::thread::spawn(move || {
                use notify::{EventKind, RecursiveMode, Watcher};
                use std::sync::mpsc;
                use std::time::{Duration, Instant};

                let (tx, rx) = mpsc::channel();
                let mut watcher = match notify::recommended_watcher(tx) {
                    Ok(w) => w,
                    Err(e) => {
                        tracing::error!("MCP file watcher init failed: {}", e);
                        return;
                    }
                };

                let home = match dirs::home_dir() {
                    Some(h) => h,
                    None => return,
                };

                // Watch parent dirs (NonRecursive) so we catch file creation too
                for dir in [home.join(".claude"), home.join(".cursor")] {
                    if dir.exists() {
                        if let Err(e) = watcher.watch(&dir, RecursiveMode::NonRecursive) {
                            tracing::warn!("Cannot watch {:?}: {}", dir, e);
                        } else {
                            tracing::info!("Watching {:?} for MCP config changes", dir);
                        }
                    }
                }

                let mut last_scan = Instant::now() - Duration::from_secs(10);

                for event in rx.into_iter().flatten() {
                    // Only care about write/create/remove events on the two config files
                    let is_relevant = matches!(
                        event.kind,
                        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
                    ) && event.paths.iter().any(|p| {
                        matches!(
                            p.file_name().and_then(|n| n.to_str()),
                            Some("claude_desktop_config.json") | Some("mcp.json")
                        )
                    });

                    if !is_relevant {
                        continue;
                    }

                    // Debounce: ignore events within 2s of the last scan
                    if last_scan.elapsed() < Duration::from_secs(2) {
                        continue;
                    }
                    last_scan = Instant::now();

                    // Short settle delay so the file write is complete
                    std::thread::sleep(Duration::from_millis(300));

                    match mcp_scanner::scan_mcp_configs() {
                        Ok(items) => {
                            tracing::info!(
                                "MCP config changed — rescan found {} issue(s)",
                                items.len()
                            );
                            let _ = handle_watch.emit("mcp_scan_updated", &items);
                        }
                        Err(e) => tracing::warn!("MCP rescan failed: {}", e),
                    }
                }
            });
            // ─────────────────────────────────────────────────────────────────

            // Show setup wizard if hook is not yet injected
            check_and_show_setup(app);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_state,
            commands::get_events,
            commands::toggle_pause,
            commands::resume_protection,
            commands::get_mcp_scan_result,
            commands::inject_claude_hook,
            commands::remove_claude_hook,
            commands::confirm_warn_event,
            commands::check_claude_installed,
            commands::get_rules,
            commands::update_rule,
        ])
        .run(tauri::generate_context!())
        .expect("Error while running AI Agent Guard");
}

fn check_and_show_setup(app: &tauri::App) {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return,
    };
    let settings_path = home.join(".claude").join("settings.json");

    let hook_injected = if settings_path.exists() {
        std::fs::read_to_string(&settings_path)
            .ok()
            .and_then(|data| serde_json::from_str::<serde_json::Value>(&data).ok())
            .map(|v| v.to_string().contains("47821"))
            .unwrap_or(false)
    } else {
        false
    };

    if !hook_injected {
        // Emit event to frontend to show setup wizard
        let _ = app.emit("show_setup_wizard", ());
    }
}
