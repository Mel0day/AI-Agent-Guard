use crate::models::{MatcherType, RiskLevel, Rule};
use regex::Regex;
use std::collections::HashMap;
use std::sync::OnceLock;

/// Result of evaluating rules against a payload
#[derive(Debug, Clone)]
pub struct RuleMatch {
    pub rule_id: String,
    pub rule_name: String,
    pub level: RiskLevel,
    pub reason: String,
}

/// Build the 9 built-in rules
pub fn built_in_rules() -> Vec<Rule> {
    vec![
        Rule {
            id: "R001".to_string(),
            name: "Destructive rm command".to_string(),
            description: "Bash command contains 'rm -rf' which can irreversibly delete files".to_string(),
            level: RiskLevel::Critical,
            enabled: true,
            matcher: MatcherType::BashContains(r"rm\s+-[a-zA-Z]*r[a-zA-Z]*f|rm\s+-[a-zA-Z]*f[a-zA-Z]*r".to_string()),
        },
        Rule {
            id: "R002".to_string(),
            name: "Pipe to shell execution".to_string(),
            description: "Bash command pipes curl/wget output directly to bash/sh (remote code execution risk)".to_string(),
            level: RiskLevel::Critical,
            enabled: true,
            matcher: MatcherType::BashContains(r"(curl|wget)[^\|]*\|[^\|]*(bash|sh)\b".to_string()),
        },
        Rule {
            id: "R003".to_string(),
            name: "Access to sensitive credential directories".to_string(),
            description: "Tool accesses ~/.ssh/, ~/.aws/, or ~/.gnupg/ which contain private credentials".to_string(),
            level: RiskLevel::Critical,
            enabled: true,
            matcher: MatcherType::PathAccess(r"(~/|/home/[^/]+/|/Users/[^/]+/)(\.(ssh|aws|gnupg)/)".to_string()),
        },
        Rule {
            id: "R004".to_string(),
            name: "Write to system/shell config".to_string(),
            description: "Tool writes to /etc/, ~/.bashrc, ~/.zshrc, or ~/.profile which can persist malicious code".to_string(),
            level: RiskLevel::Critical,
            enabled: true,
            matcher: MatcherType::PathWrite(r"^/etc/|/(\.bashrc|\.zshrc|\.profile|\.bash_profile|\.bash_login)$".to_string()),
        },
        Rule {
            id: "R005".to_string(),
            name: "Make file executable".to_string(),
            description: "Bash command uses 'chmod +x' to make a file executable".to_string(),
            level: RiskLevel::Warn,
            enabled: true,
            matcher: MatcherType::BashContains(r"chmod\s+[^\s]*\+x".to_string()),
        },
        Rule {
            id: "R006".to_string(),
            name: "Global git config modification".to_string(),
            description: "Bash command modifies global git configuration".to_string(),
            level: RiskLevel::Warn,
            enabled: true,
            matcher: MatcherType::BashContains(r"git\s+config\s+--global".to_string()),
        },
        Rule {
            id: "R007".to_string(),
            name: "Access to secret files".to_string(),
            description: "Tool accesses .env, .pem, .key, .p12, or id_rsa files which may contain secrets".to_string(),
            level: RiskLevel::Warn,
            enabled: true,
            matcher: MatcherType::PathAccess(r"\.(env|pem|key|p12)$|/id_rsa$|/id_ed25519$|/id_ecdsa$".to_string()),
        },
        Rule {
            id: "R008".to_string(),
            name: "Claude settings modification".to_string(),
            description: "Tool writes to .claude/settings.json which controls Claude Code behavior".to_string(),
            level: RiskLevel::Warn,
            enabled: true,
            matcher: MatcherType::PathWrite(r"\.claude/settings\.json$".to_string()),
        },
        Rule {
            id: "R009".to_string(),
            name: "External network access".to_string(),
            description: "Bash command accesses an external URL (non-localhost)".to_string(),
            level: RiskLevel::Info,
            enabled: true,
            matcher: MatcherType::ExternalUrl,
        },
    ]
}

/// Extract text content to match against from a tool's input
fn extract_bash_command(tool_name: &str, tool_input: &serde_json::Value) -> Option<String> {
    if tool_name == "Bash" || tool_name == "bash" || tool_name == "execute_command" {
        // Try common field names for bash commands
        if let Some(cmd) = tool_input.get("command").and_then(|v| v.as_str()) {
            return Some(cmd.to_string());
        }
        if let Some(cmd) = tool_input.get("cmd").and_then(|v| v.as_str()) {
            return Some(cmd.to_string());
        }
        // Fallback: stringify the entire input
        return Some(tool_input.to_string());
    }
    None
}

/// Extract file paths from tool input (works for Read, Write, Edit, etc.)
fn extract_file_paths(tool_input: &serde_json::Value) -> Vec<String> {
    let mut paths = Vec::new();

    // Common path field names used by Claude Code tools
    for field in &[
        "path",
        "file_path",
        "filename",
        "filepath",
        "target",
        "source",
    ] {
        if let Some(p) = tool_input.get(field).and_then(|v| v.as_str()) {
            paths.push(p.to_string());
        }
    }

    // Check for array of paths
    if let Some(arr) = tool_input.get("paths").and_then(|v| v.as_array()) {
        for item in arr {
            if let Some(p) = item.as_str() {
                paths.push(p.to_string());
            }
        }
    }

    // Also scan string values in the entire object for path-like strings
    if let Some(obj) = tool_input.as_object() {
        for (_, v) in obj {
            if let Some(s) = v.as_str() {
                if (s.starts_with('/') || s.starts_with("~/") || s.starts_with("./"))
                    && !paths.contains(&s.to_string())
                {
                    paths.push(s.to_string());
                }
            }
        }
    }

    paths
}

/// Determine whether this tool is a write operation
fn is_write_tool(tool_name: &str) -> bool {
    matches!(
        tool_name,
        "Write"
            | "write_file"
            | "Edit"
            | "edit_file"
            | "MultiEdit"
            | "create_file"
            | "write"
            | "patch_file"
            | "insert_content"
    )
}

/// Expand ~ to actual home directory path for matching
fn expand_tilde(path: &str) -> String {
    if path.starts_with("~/") {
        if let Some(home) = dirs::home_dir() {
            return format!("{}/{}", home.display(), path.strip_prefix("~/").unwrap_or(path));
        }
    }
    path.to_string()
}

/// Matches any http(s):// URL and captures the host portion.
/// We filter out local addresses in code (Rust regex doesn't support lookahead).
const URL_PATTERN: &str = r#"https?://([^\s"'/\?#]+)"#;

fn url_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(URL_PATTERN).expect("URL regex is valid"))
}

/// Returns true if the captured host is a loopback/local address.
fn is_local_host(host: &str) -> bool {
    let h = host.split(':').next().unwrap_or(host).to_lowercase();
    matches!(
        h.as_str(),
        "localhost" | "127.0.0.1" | "0.0.0.0" | "::1" | "[::1]"
    )
}

/// Returns true if the text contains at least one external (non-local) URL.
fn contains_external_url(text: &str) -> bool {
    url_re()
        .captures_iter(text)
        .any(|cap| !is_local_host(&cap[1]))
}

/// Evaluate a payload against all enabled rules, returning the highest-severity match
pub fn evaluate(
    tool_name: &str,
    tool_input: &serde_json::Value,
    rules: &[Rule],
    rule_overrides: &HashMap<String, bool>,
    whitelist_paths: &[String],
) -> Option<RuleMatch> {
    let bash_cmd = extract_bash_command(tool_name, tool_input);
    let file_paths = extract_file_paths(tool_input);
    let write_op = is_write_tool(tool_name);

    // Check whitelist
    for path in &file_paths {
        let expanded = expand_tilde(path);
        for wl in whitelist_paths {
            let expanded_wl = expand_tilde(wl);
            if expanded.starts_with(&expanded_wl) {
                return None;
            }
        }
    }

    let mut best: Option<RuleMatch> = None;

    for rule in rules {
        // Apply overrides
        let enabled = rule_overrides
            .get(&rule.id)
            .copied()
            .unwrap_or(rule.enabled);
        if !enabled {
            continue;
        }

        let matched = match &rule.matcher {
            MatcherType::BashContains(pattern) => {
                if let Some(ref cmd) = bash_cmd {
                    let re = match Regex::new(pattern) {
                        Ok(r) => r,
                        Err(_) => continue,
                    };
                    re.is_match(cmd)
                } else {
                    false
                }
            }

            MatcherType::PathAccess(pattern) => {
                let re = match Regex::new(pattern) {
                    Ok(r) => r,
                    Err(_) => continue,
                };
                // Check bash command text for path references
                let in_cmd = bash_cmd.as_deref().map(|c| re.is_match(c)).unwrap_or(false);
                // Check explicit file paths
                let in_paths = file_paths.iter().any(|p| {
                    let expanded = expand_tilde(p);
                    re.is_match(p) || re.is_match(&expanded)
                });
                in_cmd || in_paths
            }

            MatcherType::PathWrite(pattern) => {
                if !write_op {
                    false
                } else {
                    let re = match Regex::new(pattern) {
                        Ok(r) => r,
                        Err(_) => continue,
                    };
                    file_paths.iter().any(|p| {
                        let expanded = expand_tilde(p);
                        re.is_match(p) || re.is_match(&expanded)
                    })
                }
            }

            MatcherType::ExternalUrl => {
                if let Some(ref cmd) = bash_cmd {
                    contains_external_url(cmd)
                } else {
                    contains_external_url(&tool_input.to_string())
                }
            }
        };

        if matched {
            let candidate = RuleMatch {
                rule_id: rule.id.clone(),
                rule_name: rule.name.clone(),
                level: rule.level.clone(),
                reason: rule.description.clone(),
            };
            best = Some(match best {
                None => candidate,
                Some(current) => {
                    if candidate.level > current.level {
                        candidate
                    } else {
                        current
                    }
                }
            });
        }
    }

    best
}
