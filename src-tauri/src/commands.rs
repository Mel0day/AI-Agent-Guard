use crate::config::save_config;
use crate::mcp_scanner;
use crate::models::{AppState, Event, EventFilter, McpScanItem, RiskLevel, Rule};
use crate::SharedState;
use chrono::{Duration, Utc};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn get_state(state: State<'_, Arc<SharedState>>) -> Result<AppState, String> {
    let app_state = state.app_state.read().await;

    // Auto-unpause if the timer has expired
    let mut result = app_state.clone();
    if result.is_paused {
        if let Some(until) = result.pause_until {
            if Utc::now() >= until {
                result.is_paused = false;
                result.pause_until = None;
            }
        }
    }

    Ok(result)
}

#[tauri::command]
pub async fn get_events(
    filter: EventFilter,
    state: State<'_, Arc<SharedState>>,
) -> Result<Vec<Event>, String> {
    state.logger.query(&filter).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn toggle_pause(
    duration_minutes: Option<u32>,
    state: State<'_, Arc<SharedState>>,
) -> Result<(), String> {
    let pause_until = duration_minutes.map(|m| Utc::now() + Duration::minutes(m as i64));

    // Update app state
    {
        let mut app_state = state.app_state.write().await;
        app_state.is_paused = true;
        app_state.pause_until = pause_until;
    }

    // Persist to config
    {
        let mut config = state.config.write().await;
        config.is_paused = true;
        config.pause_until = pause_until;
        save_config(&config).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn resume_protection(state: State<'_, Arc<SharedState>>) -> Result<(), String> {
    {
        let mut app_state = state.app_state.write().await;
        app_state.is_paused = false;
        app_state.pause_until = None;
    }

    {
        let mut config = state.config.write().await;
        config.is_paused = false;
        config.pause_until = None;
        save_config(&config).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn get_mcp_scan_result(
    _state: State<'_, Arc<SharedState>>,
) -> Result<Vec<McpScanItem>, String> {
    mcp_scanner::scan_mcp_configs().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn inject_claude_hook(_state: State<'_, Arc<SharedState>>) -> Result<(), String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let settings_path = home.join(".claude").join("settings.json");

    // Ensure .claude directory exists
    let claude_dir = settings_path
        .parent()
        .ok_or("settings.json path has no parent directory")?;
    std::fs::create_dir_all(claude_dir)
        .map_err(|e| format!("Failed to create .claude directory: {}", e))?;

    // Read existing settings or start fresh
    let mut settings: serde_json::Value = if settings_path.exists() {
        let data = std::fs::read_to_string(&settings_path)
            .map_err(|e| format!("Failed to read settings.json: {}", e))?;
        serde_json::from_str(&data).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    // The hook command that will be injected.
    // Claude Code delivers the full hook payload via stdin as JSON.
    // We read stdin, inject tool_name from $CLAUDE_TOOL_NAME env var (set by Claude Code),
    // POST the raw JSON to the Guard server, and parse the allow field.
    // Fail-open: any error (curl timeout, Guard not running, parse failure) exits 0.
    let hook_command = r#"INPUT=$(cat); PAYLOAD=$(printf '%s' "$INPUT" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(json.dumps({"tool_name": d.get("tool_name", ""), "tool_input": d.get("tool_input", {}), "session_id": d.get("session_id")}))' 2>/dev/null || echo '{"tool_name":"","tool_input":{}}'); RESPONSE=$(printf '%s' "$PAYLOAD" | curl -s -m 4 -X POST http://127.0.0.1:47821/hook -H 'Content-Type: application/json' --data-binary @- 2>/dev/null); if printf '%s' "$RESPONSE" | python3 -c 'import sys,json; d=json.load(sys.stdin); exit(0 if d.get("allow",True) else 1)' 2>/dev/null; then exit 0; else printf 'AI Agent Guard: blocked\n' >&2; exit 1; fi; exit 0"#;

    let hook_entry = serde_json::json!({
        "matcher": "*",
        "hooks": [{
            "type": "command",
            "command": hook_command
        }]
    });

    // Check if PreToolUse hooks already exist
    let hooks_array = settings
        .get_mut("hooks")
        .and_then(|h| h.as_object_mut())
        .and_then(|o| o.get_mut("PreToolUse"))
        .and_then(|v| v.as_array_mut());

    if let Some(arr) = hooks_array {
        // Check if our hook is already present
        let already_present = arr.iter().any(|entry| {
            entry
                .get("hooks")
                .and_then(|h| h.as_array())
                .map(|hooks| {
                    hooks.iter().any(|hook| {
                        hook.get("command")
                            .and_then(|c| c.as_str())
                            .map(|c| c.contains("47821"))
                            .unwrap_or(false)
                    })
                })
                .unwrap_or(false)
        });
        if !already_present {
            arr.push(hook_entry);
        }
    } else {
        // Build the structure from scratch
        let hooks = settings
            .as_object_mut()
            .ok_or("settings.json is not an object")?
            .entry("hooks")
            .or_insert(serde_json::json!({}));

        let hooks_obj = hooks
            .as_object_mut()
            .ok_or("hooks field is not an object")?;

        let pre_tool_use = hooks_obj
            .entry("PreToolUse")
            .or_insert(serde_json::json!([]));

        pre_tool_use
            .as_array_mut()
            .ok_or("PreToolUse is not an array")?
            .push(hook_entry);
    }

    let serialized = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    std::fs::write(&settings_path, serialized)
        .map_err(|e| format!("Failed to write settings.json: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn remove_claude_hook(_state: State<'_, Arc<SharedState>>) -> Result<(), String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let settings_path = home.join(".claude").join("settings.json");

    if !settings_path.exists() {
        return Ok(());
    }

    let data = std::fs::read_to_string(&settings_path)
        .map_err(|e| format!("Failed to read settings.json: {}", e))?;

    let mut settings: serde_json::Value =
        serde_json::from_str(&data).map_err(|e| format!("Failed to parse settings.json: {}", e))?;

    // Remove hook entries that reference our port
    if let Some(pre_tool_use) = settings
        .get_mut("hooks")
        .and_then(|h| h.as_object_mut())
        .and_then(|o| o.get_mut("PreToolUse"))
        .and_then(|v| v.as_array_mut())
    {
        pre_tool_use.retain(|entry| {
            !entry
                .get("hooks")
                .and_then(|h| h.as_array())
                .map(|hooks| {
                    hooks.iter().any(|hook| {
                        hook.get("command")
                            .and_then(|c| c.as_str())
                            .map(|c| c.contains("47821"))
                            .unwrap_or(false)
                    })
                })
                .unwrap_or(false)
        });
    }

    let serialized = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    std::fs::write(&settings_path, serialized)
        .map_err(|e| format!("Failed to write settings.json: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn confirm_warn_event(
    event_id: String,
    allow: bool,
    state: State<'_, Arc<SharedState>>,
) -> Result<(), String> {
    let mut pending = state.pending_decisions.lock().await;

    if let Some(decision) = pending.remove(&event_id) {
        // Send the user's decision; ignore error if receiver already dropped (timed out)
        let _ = decision.sender.send(allow);
        Ok(())
    } else {
        // Decision already resolved (timed out)
        Err(format!("Event {} not found or already resolved", event_id))
    }
}

#[tauri::command]
pub async fn check_claude_installed(_state: State<'_, Arc<SharedState>>) -> Result<bool, String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let claude_dir = home.join(".claude");
    Ok(claude_dir.exists())
}

#[tauri::command]
pub async fn get_rules(state: State<'_, Arc<SharedState>>) -> Result<Vec<Rule>, String> {
    let rules = state.rules.read().await;
    Ok(rules.clone())
}

#[tauri::command]
pub async fn update_rule(
    rule_id: String,
    enabled: bool,
    level: Option<RiskLevel>,
    state: State<'_, Arc<SharedState>>,
) -> Result<(), String> {
    // Update in-memory rules
    {
        let mut rules = state.rules.write().await;
        let rule = rules
            .iter_mut()
            .find(|r| r.id == rule_id)
            .ok_or_else(|| format!("Rule {} not found", rule_id))?;
        rule.enabled = enabled;
        if let Some(new_level) = level {
            rule.level = new_level;
        }
    }

    // Persist override to config
    {
        let mut config = state.config.write().await;
        config.rule_overrides.insert(rule_id, enabled);
        save_config(&config).map_err(|e| e.to_string())?;
    }

    Ok(())
}
