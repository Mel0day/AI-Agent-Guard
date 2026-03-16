# Contributing to AI Agent Guard

Thank you for your interest in contributing to AI Agent Guard! This document covers everything you need to get started — from setting up your development environment to submitting your first pull request.

---

## Table of Contents

1. [Development Environment Setup](#development-environment-setup)
2. [Project Structure](#project-structure)
3. [Running the App Locally](#running-the-app-locally)
4. [Commit Message Convention](#commit-message-convention)
5. [Pull Request Process](#pull-request-process)
6. [How to Add a New Security Rule](#how-to-add-a-new-security-rule)
7. [Code Style](#code-style)
8. [Reporting Security Vulnerabilities](#reporting-security-vulnerabilities)

---

## Development Environment Setup

### Prerequisites

| Tool | Minimum Version | Install |
|---|---|---|
| Rust | 1.77+ | https://rustup.rs |
| Node.js | 20+ | https://nodejs.org |
| npm | 10+ | Included with Node.js |
| Tauri CLI | 2.x | `npm install -g @tauri-apps/cli` |

**macOS** also requires Xcode Command Line Tools:

```bash
xcode-select --install
```

**Linux (Ubuntu/Debian)** requires additional system packages:

```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libappindicator3-dev \
  librsvg2-dev \
  patchelf \
  libgtk-3-dev
```

**Windows** requires:

- [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (select "Desktop development with C++")
- [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (usually pre-installed on Windows 11)

### Clone and Install

```bash
git clone https://github.com/YOUR_ORG/ai-agent-guard.git
cd ai-agent-guard
npm install
```

---

## Project Structure

```
ai-agent-guard/
├── src/                        # React + TypeScript frontend
│   ├── pages/                  # Page components (Dashboard, Setup, etc.)
│   ├── App.tsx                 # Root component and routing
│   └── main.tsx                # Entry point
├── src-tauri/                  # Rust backend
│   ├── src/
│   │   ├── lib.rs              # Tauri setup and shared state
│   │   ├── main.rs             # Binary entry point
│   │   ├── commands.rs         # Tauri IPC commands
│   │   ├── config.rs           # Config load/save (TOML)
│   │   ├── event_logger.rs     # Persistent event log
│   │   ├── hook_server.rs      # Local HTTP server for Claude Code hooks
│   │   ├── mcp_scanner.rs      # MCP server config scanner
│   │   ├── models.rs           # Shared data types
│   │   └── rule_engine.rs      # Security rule definitions and evaluation
│   ├── capabilities/           # Tauri permission declarations
│   ├── icons/                  # App icons
│   ├── Cargo.toml
│   └── tauri.conf.json
├── .github/
│   ├── workflows/
│   │   ├── ci.yml              # Lint, test, build check on push/PR
│   │   └── release.yml         # Multi-platform build on tag push
│   └── ISSUE_TEMPLATE/
└── package.json
```

---

## Running the App Locally

```bash
# Start development mode (hot-reload for both frontend and backend)
npm run tauri dev

# Build a production binary for your current platform
npm run tauri build

# Run Rust tests only
cd src-tauri && cargo test

# Run Rust linter
cd src-tauri && cargo clippy -- -D warnings

# Check Rust formatting
cd src-tauri && cargo fmt --check

# Auto-fix Rust formatting
cd src-tauri && cargo fmt

# Build frontend only (without Tauri)
npm run build
```

> **Tip**: On first `tauri dev`, Rust compilation takes 2-3 minutes. Subsequent runs use incremental compilation and are much faster.

---

## Commit Message Convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/). Every commit message must follow this format:

```
<type>(<scope>): <short description>

[optional body]

[optional footer(s)]
```

### Types

| Type | When to use |
|---|---|
| `feat` | A new feature |
| `fix` | A bug fix |
| `docs` | Documentation changes only |
| `style` | Code formatting, no logic change |
| `refactor` | Code restructure without adding features or fixing bugs |
| `test` | Adding or fixing tests |
| `chore` | Build process, dependency updates, tooling |
| `security` | Security-related changes (new rules, permission tightening) |
| `perf` | Performance improvements |

### Scopes

Common scopes: `rule-engine`, `hook-server`, `mcp-scanner`, `ui`, `config`, `ci`, `deps`

### Examples

```
feat(rule-engine): add rule to block git push to remote origins
fix(hook-server): handle concurrent requests without deadlock
docs: update CONTRIBUTING with Windows setup instructions
security(rule-engine): tighten shell command detection for encoded payloads
test(hook-server): add integration test for timeout handling
chore(deps): upgrade tauri to 2.1.0
```

### Breaking Changes

If your change breaks backward compatibility (e.g., config file format change), add `BREAKING CHANGE:` in the commit footer:

```
feat(config): migrate config format from TOML to JSON

BREAKING CHANGE: The config file at ~/.config/ai-agent-guard/config.toml
must be manually migrated to config.json. See migration guide in docs/.
```

---

## Pull Request Process

1. **Fork** the repository and create a branch from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```

2. **Make your changes**, keeping commits atomic and well-described.

3. **Ensure all checks pass** before opening a PR:
   ```bash
   cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test
   npm run build
   ```

4. **Open a Pull Request** against `main` with:
   - A clear title following the commit convention (e.g., `feat(rule-engine): detect base64-encoded shell commands`)
   - A description explaining *why* the change is needed, not just what it does
   - Screenshots or screen recordings for UI changes
   - Reference to any related Issues (e.g., `Closes #42`)

5. **Address review feedback** — a maintainer will review within 72 hours (P1 bugs) or 7 days (features).

6. **Squash or rebase** your branch if asked to keep the git history clean.

### What Gets Merged

- Changes must pass CI (lint, test, build)
- New features should include tests for the core logic
- Security rule changes require a comment explaining what attack or misuse the rule prevents
- Breaking changes require an upgrade guide

---

## How to Add a New Security Rule

Security rules live in `src-tauri/src/rule_engine.rs`. Each rule is a `Rule` struct that evaluates incoming hook events.

### Step 1: Understand the Rule struct

```rust
pub struct Rule {
    pub id: String,           // Unique snake_case identifier, e.g. "block_rm_rf"
    pub name: String,         // Human-readable name shown in the UI
    pub description: String,  // One-line explanation of what the rule detects
    pub severity: Severity,   // Critical, High, Medium, Low, Info
    pub enabled: bool,        // Whether the rule is active by default
    pub action: RuleAction,   // Block, Warn, Log
}
```

### Step 2: Implement the evaluation logic

Rules are evaluated in the `evaluate_event` function. Add a new match arm for your rule's ID:

```rust
"block_my_new_rule" => {
    // event.tool_name contains the Claude Code tool being invoked
    // event.params is a serde_json::Value with the tool's arguments
    if let Some(path) = event.params.get("path").and_then(|v| v.as_str()) {
        if path.contains("/etc/passwd") || path.contains("/etc/shadow") {
            return RuleResult::blocked("Access to sensitive system files is not allowed");
        }
    }
    RuleResult::allowed()
}
```

### Step 3: Register the rule in `built_in_rules()`

```rust
pub fn built_in_rules() -> Vec<Rule> {
    vec![
        // ... existing rules ...
        Rule {
            id: "block_my_new_rule".to_string(),
            name: "Block sensitive system file access".to_string(),
            description: "Prevents reading /etc/passwd, /etc/shadow, and similar files".to_string(),
            severity: Severity::High,
            enabled: true,
            action: RuleAction::Block,
        },
    ]
}
```

### Step 4: Write a test

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_block_sensitive_file_access() {
        let event = HookEvent {
            tool_name: "Read".to_string(),
            params: serde_json::json!({ "path": "/etc/passwd" }),
            ..Default::default()
        };
        let result = evaluate_event(&event, &built_in_rules());
        assert_eq!(result.action, RuleAction::Block);
    }
}
```

### Step 5: Document the rule

Add an entry to `docs/security-rules.md` explaining:
- What attack or misuse pattern the rule prevents
- What legitimate use cases might trigger false positives
- How to configure exceptions (via the UI allowlist)

### Rule Severity Guidelines

| Severity | Meaning |
|---|---|
| `Critical` | Could lead to immediate system compromise or data exfiltration |
| `High` | Could cause significant harm or data loss |
| `Medium` | Suspicious behavior that warrants user attention |
| `Low` | Mildly unusual, worth logging but rarely harmful |
| `Info` | Informational only, never blocks or warns |

---

## Code Style

### Rust

- Follow standard Rust idioms; `cargo clippy` is the authoritative linter.
- Use `anyhow::Result` for error handling in application code.
- Use `thiserror` for library-style error types.
- Prefer `tracing::info!` / `tracing::warn!` over `println!` for logging.
- All `pub` functions and structs must have a doc comment (`///`).

### TypeScript / React

- Use functional components with hooks; no class components.
- Keep components small — if a component exceeds ~150 lines, split it.
- Use Tailwind CSS utility classes; avoid inline styles.
- Type all props explicitly; avoid `any`.

---

## Reporting Security Vulnerabilities

**Do not open a public GitHub Issue for security vulnerabilities.**

Please report security issues by sending a private message to the maintainers via GitHub's [Security Advisories](https://github.com/YOUR_ORG/ai-agent-guard/security/advisories/new) feature.

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact assessment
- Suggested fix (if you have one)

We aim to acknowledge reports within 48 hours and release a patch within 14 days for critical issues.
