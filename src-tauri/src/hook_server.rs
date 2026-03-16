use crate::models::{Event, HookPayload, HookResponse, Outcome, RiskLevel};
use crate::rule_engine;
use crate::SharedState;
use axum::{
    extract::State,
    http::StatusCode,
    response::Json,
    routing::post,
    Router,
};
use chrono::Utc;
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::oneshot;
use tokio::time::{timeout, Duration};
use tower_http::catch_panic::CatchPanicLayer;
use uuid::Uuid;

/// Start the axum HTTP hook server on 127.0.0.1:47821
pub async fn start_hook_server(state: Arc<SharedState>) -> anyhow::Result<()> {
    let app = Router::new()
        .route("/hook", post(handle_hook))
        .layer(CatchPanicLayer::custom(|_| {
            // Fail-open: any panic returns allow:true
            let body = serde_json::json!({ "allow": true, "reason": "internal error - fail open" });
            axum::response::Response::builder()
                .status(StatusCode::OK)
                .header("content-type", "application/json")
                .body(axum::body::Body::from(body.to_string()))
                .unwrap()
        }))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:47821")
        .await
        .map_err(|e| anyhow::anyhow!("Failed to bind hook server on port 47821: {}", e))?;

    tracing::info!("Hook server listening on 127.0.0.1:47821");

    axum::serve(listener, app)
        .await
        .map_err(|e| anyhow::anyhow!("Hook server error: {}", e))?;

    Ok(())
}

async fn handle_hook(
    State(state): State<Arc<SharedState>>,
    Json(payload): Json<HookPayload>,
) -> Result<Json<HookResponse>, StatusCode> {
    // Check pause state
    {
        let app_state = state.app_state.read().await;
        if app_state.is_paused {
            if let Some(until) = app_state.pause_until {
                if Utc::now() < until {
                    return Ok(Json(HookResponse {
                        allow: true,
                        reason: Some("Protection paused".to_string()),
                    }));
                }
            } else {
                return Ok(Json(HookResponse {
                    allow: true,
                    reason: Some("Protection paused".to_string()),
                }));
            }
        }
    }

    // Evaluate rules
    let config = state.config.read().await;
    let rules = state.rules.read().await;

    let rule_match = rule_engine::evaluate(
        &payload.tool_name,
        &payload.tool_input,
        &rules,
        &config.rule_overrides,
        &config.whitelist_paths,
    );
    drop(config);
    drop(rules);

    let event_id = Uuid::new_v4().to_string();

    match rule_match {
        None => {
            // No rule matched → allow
            let event = Event {
                id: event_id,
                timestamp: Utc::now(),
                tool_name: payload.tool_name.clone(),
                tool_input: payload.tool_input.clone(),
                risk_level: RiskLevel::Info,
                rule_id: None,
                rule_name: None,
                reason: "No rule matched".to_string(),
                outcome: Outcome::Allowed,
            };
            record_event(&state, event, false).await;

            Ok(Json(HookResponse {
                allow: true,
                reason: None,
            }))
        }

        Some(ref matched) if matched.level == RiskLevel::Critical => {
            // CRITICAL → block immediately
            let event = Event {
                id: event_id,
                timestamp: Utc::now(),
                tool_name: payload.tool_name.clone(),
                tool_input: payload.tool_input.clone(),
                risk_level: RiskLevel::Critical,
                rule_id: Some(matched.rule_id.clone()),
                rule_name: Some(matched.rule_name.clone()),
                reason: matched.reason.clone(),
                outcome: Outcome::Blocked,
            };
            record_event(&state, event, true).await;

            Ok(Json(HookResponse {
                allow: false,
                reason: Some(matched.reason.clone()),
            }))
        }

        Some(ref matched) if matched.level == RiskLevel::Warn => {
            // WARN → show dialog, wait up to 4 seconds
            let (tx, rx) = oneshot::channel::<bool>();

            // Register the pending decision
            {
                let mut pending = state.pending_decisions.lock().await;
                pending.insert(
                    event_id.clone(),
                    crate::models::PendingDecision {
                        event_id: event_id.clone(),
                        sender: tx,
                    },
                );
            }

            // Emit event to frontend
            let warn_payload = serde_json::json!({
                "event_id": event_id,
                "tool_name": payload.tool_name,
                "tool_input": payload.tool_input,
                "rule_id": matched.rule_id,
                "rule_name": matched.rule_name,
                "reason": matched.reason,
                "risk_level": "WARN",
            });

            if let Some(ref app_handle) = *state.app_handle.lock().await {
                let _ = app_handle.emit("warn_event", &warn_payload);
            }

            // Wait for frontend response with 4-second timeout
            let user_response = timeout(Duration::from_secs(4), rx).await;

            // Clean up pending decision regardless of outcome
            {
                let mut pending = state.pending_decisions.lock().await;
                pending.remove(&event_id);
            }

            let (allow, outcome) = match user_response {
                Ok(Ok(true)) => (true, Outcome::UserAllowed),
                Ok(Ok(false)) => (false, Outcome::UserBlocked),
                Ok(Err(_)) => {
                    // Sender dropped without sending → treat as timeout
                    (false, Outcome::TimedOutBlocked)
                }
                Err(_) => {
                    // Timeout expired
                    (false, Outcome::TimedOutBlocked)
                }
            };

            let event = Event {
                id: event_id,
                timestamp: Utc::now(),
                tool_name: payload.tool_name.clone(),
                tool_input: payload.tool_input.clone(),
                risk_level: RiskLevel::Warn,
                rule_id: Some(matched.rule_id.clone()),
                rule_name: Some(matched.rule_name.clone()),
                reason: matched.reason.clone(),
                outcome: outcome.clone(),
            };
            record_event(&state, event, !allow).await;

            Ok(Json(HookResponse {
                allow,
                reason: if allow {
                    None
                } else {
                    Some(matched.reason.clone())
                },
            }))
        }

        Some(ref matched) => {
            // INFO → allow, log it
            let event = Event {
                id: event_id,
                timestamp: Utc::now(),
                tool_name: payload.tool_name.clone(),
                tool_input: payload.tool_input.clone(),
                risk_level: RiskLevel::Info,
                rule_id: Some(matched.rule_id.clone()),
                rule_name: Some(matched.rule_name.clone()),
                reason: matched.reason.clone(),
                outcome: Outcome::Allowed,
            };
            record_event(&state, event, false).await;

            Ok(Json(HookResponse {
                allow: true,
                reason: None,
            }))
        }
    }
}

/// Record an event: persist to log and update app state counters, then notify frontend
async fn record_event(state: &Arc<SharedState>, event: Event, blocked: bool) {
    // Update app state counters
    {
        let mut app_state = state.app_state.write().await;
        app_state.today_protected += 1;
        if blocked {
            app_state.today_blocked += 1;
        }
        app_state.last_event_at = Some(event.timestamp);
    }

    // Persist to log file (on a separate task to not block the HTTP response for CRITICAL)
    let logger = Arc::clone(&state.logger);
    let event_clone = event.clone();
    tokio::spawn(async move {
        if let Err(e) = logger.append(&event_clone) {
            tracing::error!("Failed to log event: {}", e);
        }
    });

    // Emit new_event to frontend for live update
    if let Some(ref app_handle) = *state.app_handle.lock().await {
        let _ = app_handle.emit("new_event", &event);
    }
}
