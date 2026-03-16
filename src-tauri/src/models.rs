use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Risk level of a security event
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum RiskLevel {
    Info,
    Warn,
    Critical,
}

impl std::fmt::Display for RiskLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RiskLevel::Critical => write!(f, "CRITICAL"),
            RiskLevel::Warn => write!(f, "WARN"),
            RiskLevel::Info => write!(f, "INFO"),
        }
    }
}

/// Outcome of a hook event
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum Outcome {
    /// Automatically blocked by rule (CRITICAL)
    Blocked,
    /// Automatically allowed (INFO or no rule matched)
    Allowed,
    /// User explicitly allowed in dialog
    UserAllowed,
    /// User explicitly blocked in dialog
    UserBlocked,
    /// WARN event timed out with no user response → blocked
    TimedOutBlocked,
}

impl std::fmt::Display for Outcome {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Outcome::Blocked => write!(f, "Blocked"),
            Outcome::Allowed => write!(f, "Allowed"),
            Outcome::UserAllowed => write!(f, "UserAllowed"),
            Outcome::UserBlocked => write!(f, "UserBlocked"),
            Outcome::TimedOutBlocked => write!(f, "TimedOutBlocked"),
        }
    }
}

/// Incoming hook payload from Claude Code
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookPayload {
    pub tool_name: String,
    pub tool_input: serde_json::Value,
    pub session_id: Option<String>,
}

/// Response sent back to Claude Code hook
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookResponse {
    pub allow: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Matcher types for rules
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "value")]
pub enum MatcherType {
    /// Match bash command text against regex pattern
    BashContains(String),
    /// Match file path against regex pattern
    PathAccess(String),
    /// Match file path for write operations
    PathWrite(String),
    /// Match bash command for external URL access
    ExternalUrl,
}

/// A security rule
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rule {
    pub id: String,
    pub name: String,
    pub description: String,
    pub level: RiskLevel,
    pub enabled: bool,
    pub matcher: MatcherType,
}

/// A security event log entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub id: String,
    pub timestamp: DateTime<Utc>,
    pub tool_name: String,
    pub tool_input: serde_json::Value,
    pub risk_level: RiskLevel,
    pub rule_id: Option<String>,
    pub rule_name: Option<String>,
    pub reason: String,
    pub outcome: Outcome,
}

/// Application runtime state
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppState {
    pub is_paused: bool,
    pub pause_until: Option<DateTime<Utc>>,
    pub today_protected: u32,
    pub today_blocked: u32,
    pub last_event_at: Option<DateTime<Utc>>,
}

/// Filter for querying events
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct EventFilter {
    pub risk_level: Option<RiskLevel>,
    pub search: Option<String>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

/// Result of an MCP configuration scan item
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpScanItem {
    pub source_file: String,
    pub server_name: String,
    pub issue: String,
    pub severity: RiskLevel,
}

/// Persistent configuration stored in ~/.aigentguard/config.json
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Config {
    pub is_paused: bool,
    pub pause_until: Option<DateTime<Utc>>,
    /// Map of rule_id -> enabled override
    pub rule_overrides: HashMap<String, bool>,
    /// Paths that are always allowed
    pub whitelist_paths: Vec<String>,
}

/// Pending WARN decision, waiting for user confirmation
#[derive(Debug)]
pub struct PendingDecision {
    pub event_id: String,
    pub sender: tokio::sync::oneshot::Sender<bool>,
}
