# AI Agent Guard

A security monitor and gatekeeper for [Claude Code](https://claude.ai/code) tool executions, built with Tauri v2 (Rust + React + TypeScript).

## What It Does

AI Agent Guard intercepts every tool call made by Claude Code via a `PreToolUse` hook, evaluates it against 9 built-in security rules, and either blocks it automatically or prompts you for a decision.

| Risk Level | Behavior |
|---|---|
| **CRITICAL** | Automatically blocked immediately |
| **WARN** | Confirmation dialog — 4s timeout auto-blocks |
| **INFO** | Allowed and logged |

## Built-in Rules

| ID | Name | Level |
|---|---|---|
| R001 | Destructive rm command (`rm -rf`) | CRITICAL |
| R002 | Pipe to shell (`curl\|bash`, `wget\|sh`) | CRITICAL |
| R003 | Access to `~/.ssh/`, `~/.aws/`, `~/.gnupg/` | CRITICAL |
| R004 | Write to `/etc/`, `~/.bashrc`, `~/.zshrc`, `~/.profile` | CRITICAL |
| R005 | `chmod +x` | WARN |
| R006 | `git config --global` | WARN |
| R007 | Access to `.env`, `.pem`, `.key`, `.p12`, `id_rsa` | WARN |
| R008 | Write to `.claude/settings.json` | WARN |
| R009 | External URL in bash command | INFO |

## Architecture

```
ai-guard/
├── src-tauri/              # Rust backend (Tauri + axum)
│   └── src/
│       ├── main.rs         # Entry point
│       ├── lib.rs          # Tauri commands + app setup
│       ├── hook_server.rs  # axum HTTP server on port 47821
│       ├── rule_engine.rs  # Rule evaluation logic
│       ├── mcp_scanner.rs  # MCP config static analysis
│       ├── event_logger.rs # JSONL event persistence
│       ├── config.rs       # Config read/write
│       └── models.rs       # Shared data types
└── src/                    # React frontend
    ├── App.tsx
    ├── pages/
    │   ├── LogWindow.tsx   # Main event log UI
    │   ├── McpScanTab.tsx  # MCP scan results
    │   ├── SettingsTab.tsx # Rules & settings
    │   └── SetupWizard.tsx # First-run wizard
    └── components/
        ├── EventRow.tsx
        ├── RiskBadge.tsx
        └── ConfirmDialog.tsx
```

## Data Storage

All data is stored in `~/.aigentguard/`:

- `events.jsonl` — append-only event log, one JSON object per line
- `config.json` — app configuration (pause state, rule overrides, whitelist paths)

The log file rotates at 10 MB. The in-memory ring buffer holds the 100 most recent events for fast display.

## Installation

Download the latest release for your platform from the [Releases](https://github.com/Mel0day/AI-Agent-Guard/releases) page.

| Platform | File |
|---|---|
| macOS Apple Silicon | `AI.Agent.Guard_x.x.x_aarch64.dmg` |
| macOS Intel | `AI.Agent.Guard_x.x.x_x64.dmg` |
| Windows | `AI.Agent.Guard_x.x.x_x64-setup.exe` |
| Linux (Debian/Ubuntu) | `AI.Agent.Guard_x.x.x_amd64.deb` |
| Linux (AppImage) | `AI.Agent.Guard_x.x.x_amd64.AppImage` |

### macOS: Gatekeeper warning

The app is ad-hoc signed but not notarized with an Apple Developer certificate, so macOS will block it on first launch. There are two possible warnings depending on your macOS version:

**"AI Agent Guard" cannot be opened because it is from an unidentified developer**

1. Double-click the `.dmg` and drag the app to `/Applications`
2. Try to open the app — macOS blocks it with this warning
3. Open **System Settings → Privacy & Security**
4. Scroll to the **Security** section — you will see:
   > *"AI Agent Guard" was blocked from use because it is not from an identified developer.*
5. Click **Open Anyway**, then click **Open** in the confirmation dialog

**"AI Agent Guard" is damaged and can't be opened**

This means macOS quarantined the download. The Privacy & Security screen will not show an "Open Anyway" button for this error — use the terminal instead:

```bash
xattr -cr /Applications/AI\ Agent\ Guard.app
```

Then open the app normally. This removes the quarantine attribute macOS added when you downloaded the file.

---

## Development

### Prerequisites

- [Rust](https://rustup.rs/) 1.75+
- [Node.js](https://nodejs.org/) 18+
- [Tauri CLI v2](https://tauri.app/start/prerequisites/)
- On macOS: Xcode Command Line Tools

### Install dependencies

```bash
npm install
```

### Run in development mode

```bash
npm run tauri dev
```

### Build for production

```bash
npm run tauri build
```

## Hook Details

The hook injected into `~/.claude/settings.json` looks like:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "RESPONSE=$(curl -s -m 4 -X POST http://127.0.0.1:47821/hook ..."
          }
        ]
      }
    ]
  }
}
```

**Fail-open guarantee:** If this app is not running or the server is unreachable, `curl` will fail silently and Claude Code proceeds normally. The 4-second `-m` timeout ensures Claude Code's own 5-second hook timeout is never hit.

## API

The local HTTP server (`127.0.0.1:47821`) accepts:

```
POST /hook
Content-Type: application/json

{
  "tool_name": "Bash",
  "tool_input": { "command": "rm -rf /" },
  "session_id": "optional-session-id"
}
```

Response:
```json
{ "allow": false, "reason": "Bash command contains 'rm -rf'..." }
```

## License

MIT — see [LICENSE](LICENSE).
