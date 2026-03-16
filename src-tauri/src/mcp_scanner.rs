use crate::models::{McpScanItem, RiskLevel};
use anyhow::Result;
use serde_json::Value;
use std::fs;
use std::path::Path;

/// Keywords indicating a possible prompt injection in tool descriptions
const INJECTION_KEYWORDS: &[&str] = &[
    "ignore previous instructions",
    "disregard",
    "system prompt",
    "ignore all previous",
    "forget your instructions",
    "override your",
    "do not follow",
    "bypass",
    "jailbreak",
    "ignore the above",
];

/// Tool name fragments that suggest shell execution capabilities
const DANGEROUS_NAME_FRAGMENTS: &[&str] = &[
    "exec", "shell", "run", "system", "command", "eval", "spawn", "popen",
];

/// Maximum allowed length for a tool description before flagging as suspicious
const MAX_DESC_LEN: usize = 500;

pub fn scan_mcp_configs() -> Result<Vec<McpScanItem>> {
    let mut results = Vec::new();

    let home =
        dirs::home_dir().ok_or_else(|| anyhow::anyhow!("Cannot determine home directory"))?;

    // Scan Claude Desktop config
    let claude_config = home.join(".claude").join("claude_desktop_config.json");
    if claude_config.exists() {
        let mut items = scan_file(&claude_config, "~/.claude/claude_desktop_config.json")?;
        results.append(&mut items);
    }

    // Scan Cursor MCP config
    let cursor_config = home.join(".cursor").join("mcp.json");
    if cursor_config.exists() {
        let mut items = scan_file(&cursor_config, "~/.cursor/mcp.json")?;
        results.append(&mut items);
    }

    Ok(results)
}

fn scan_file(path: &Path, display_path: &str) -> Result<Vec<McpScanItem>> {
    let mut results = Vec::new();

    let data = match fs::read_to_string(path) {
        Ok(d) => d,
        Err(e) => {
            tracing::warn!("Cannot read MCP config {}: {}", display_path, e);
            return Ok(results);
        }
    };

    let parsed: Value = match serde_json::from_str(&data) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("Cannot parse MCP config {}: {}", display_path, e);
            return Ok(results);
        }
    };

    // Extract MCP server entries
    // Claude Desktop format: { "mcpServers": { "name": { "command": ..., "tools": [...] } } }
    if let Some(servers) = parsed.get("mcpServers").and_then(|v| v.as_object()) {
        for (server_name, server_def) in servers {
            let mut issues = scan_server_def(server_name, server_def);
            for issue in &mut issues {
                issue.source_file = display_path.to_string();
            }
            results.append(&mut issues);
        }
    }

    // Cursor format: { "servers": { "name": { ... } } } or flat array
    if let Some(servers) = parsed.get("servers").and_then(|v| v.as_object()) {
        for (server_name, server_def) in servers {
            let mut issues = scan_server_def(server_name, server_def);
            for issue in &mut issues {
                issue.source_file = display_path.to_string();
            }
            results.append(&mut issues);
        }
    }

    Ok(results)
}

fn scan_server_def(server_name: &str, server_def: &Value) -> Vec<McpScanItem> {
    let mut results = Vec::new();

    // Scan tools array if present
    if let Some(tools) = server_def.get("tools").and_then(|v| v.as_array()) {
        for tool in tools {
            let tool_name = tool
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("<unnamed>");

            // Check tool description for injection patterns
            if let Some(desc) = tool.get("description").and_then(|v| v.as_str()) {
                // Check for injection keywords
                let desc_lower = desc.to_lowercase();
                for keyword in INJECTION_KEYWORDS {
                    if desc_lower.contains(keyword) {
                        results.push(McpScanItem {
                            source_file: String::new(), // filled by caller
                            server_name: format!("{}/{}", server_name, tool_name),
                            issue: format!(
                                "Tool description contains potential injection keyword: \"{}\"",
                                keyword
                            ),
                            severity: RiskLevel::Warn,
                        });
                        break; // One report per tool for injection
                    }
                }

                // Check for abnormally long descriptions
                if desc.len() > MAX_DESC_LEN {
                    results.push(McpScanItem {
                        source_file: String::new(),
                        server_name: format!("{}/{}", server_name, tool_name),
                        issue: format!(
                            "Tool description is unusually long ({} chars > {} max), possible hidden instructions",
                            desc.len(),
                            MAX_DESC_LEN
                        ),
                        severity: RiskLevel::Warn,
                    });
                }
            }

            // Check tool name for dangerous execution fragments
            let name_lower = tool_name.to_lowercase();
            for fragment in DANGEROUS_NAME_FRAGMENTS {
                if name_lower.contains(fragment) {
                    results.push(McpScanItem {
                        source_file: String::new(),
                        server_name: format!("{}/{}", server_name, tool_name),
                        issue: format!(
                            "Tool name contains execution-related keyword: \"{}\"",
                            fragment
                        ),
                        severity: RiskLevel::Warn,
                    });
                    break;
                }
            }
        }
    }

    // Also check server-level command for dangerous fragments (Warn)
    if let Some(cmd) = server_def.get("command").and_then(|v| v.as_str()) {
        let cmd_lower = cmd.to_lowercase();
        for fragment in DANGEROUS_NAME_FRAGMENTS {
            if cmd_lower.contains(fragment) {
                results.push(McpScanItem {
                    source_file: String::new(),
                    server_name: server_name.to_string(),
                    issue: format!(
                        "Server command contains potentially dangerous keyword: \"{}\" in \"{}\"",
                        fragment, cmd
                    ),
                    severity: RiskLevel::Warn,
                });
                break;
            }
        }
    }

    results
}
