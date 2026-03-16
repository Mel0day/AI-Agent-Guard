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
        let is_paused = config.is_paused
            && pause_until
                .map(|until| Utc::now() < until)
                .unwrap_or(true); // no expiry = pause indefinitely

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
