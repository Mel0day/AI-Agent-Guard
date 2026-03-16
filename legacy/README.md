# AI Guard · AI 守卫

> A lightweight macOS menu bar app that watches your AI coding assistant and blocks dangerous actions before they happen.
>
> 一款轻量的 macOS 菜单栏应用，实时监控 AI 编程助手的操作，在危险行为发生前将其拦截。

---

## What it does

AI coding tools like Claude Code can run shell commands, delete files, and modify system configs on your behalf. Most of the time that's fine — but occasionally an AI makes a mistake, misunderstands your intent, or gets manipulated by malicious content in your codebase.

**AI Guard sits in your menu bar and acts as a last line of defense:**

- 🚨 **Auto-blocks** critical actions (e.g. `rm -rf`, writing to sensitive paths)
- ⚠️ **Asks you to confirm** suspicious-but-not-catastrophic actions
- ✅ **Silently allows** safe actions — no interruptions for normal work
- 📋 **Logs everything** so you can review what your AI has been up to

## How it works

AI Guard runs a local HTTP server on `127.0.0.1:47821`. AI tools that support hook-based auditing (such as Claude Code via `PreToolUse` hooks) send each tool call to this server before executing it. AI Guard evaluates the risk and responds with `{ allow: true }` or `{ allow: false }`.

```
AI Tool → PreToolUse hook → AI Guard (local server) → allow / block
```

The app never sends your data anywhere. Everything runs locally.

## Setup

### 1. Install

```bash
git clone https://github.com/Mel0day/ai-guard.git
cd ai-guard
npm install
npm start
```

### 2. Connect Claude Code

Add a `PreToolUse` hook to your Claude Code settings (`~/.claude/settings.json`):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "curl -s -X POST http://127.0.0.1:47821 -H 'Content-Type: application/json' -d '{\"risk\": \"'$(echo $CLAUDE_TOOL_NAME | grep -qiE 'bash|exec' && echo WARN || echo INFO)'\", \"aiDecision\": \"ALLOW\", \"toolName\": \"'$CLAUDE_TOOL_NAME'\", \"reason\": \"Tool use request\"}'"
          }
        ]
      }
    ]
  }
}
```

> For a more sophisticated hook that actually analyzes the tool input and assigns risk levels, see the [ai-auditor hook](https://github.com/Mel0day/ai-guard/wiki) (coming soon).

### 3. Use it

Launch AI Guard. It will auto-detect Claude Code if you've configured the hook. The shield icon in your menu bar shows your protection status at a glance.

## Features

| Feature | Details |
|---|---|
| **Menu bar icon** | Outline shield — green dot when safe, shows blocked count |
| **Auto-block** | `risk: CRITICAL` or `aiDecision: BLOCK` → silently rejected |
| **Confirm dialog** | `aiDecision: WARN` → native macOS dialog asks you to approve |
| **Event log** | Last 10 events with timestamp, action type, tool name & input |
| **Pause / Resume** | Temporarily disable monitoring without quitting |
| **Daily reset** | Blocked count resets at midnight automatically |
| **Bilingual** | Chinese and English, chosen on first launch |

## Event API

AI Guard accepts `POST /` with a JSON body:

```json
{
  "risk": "CRITICAL" | "WARN" | "INFO",
  "aiDecision": "BLOCK" | "WARN" | "ALLOW",
  "explanation": "Human-readable reason shown in UI and notifications",
  "toolName": "Bash",
  "params": { "command": "rm -rf /tmp/foo" }
}
```

Response:

```json
{ "allow": true }
{ "allow": false }
```

**Decision logic:**

- `risk === CRITICAL` or `aiDecision === BLOCK` → blocked silently, notification shown
- `aiDecision === WARN` → native confirm dialog, user decides
- Everything else → allowed, logged silently

## Requirements

- macOS 12+
- Node.js 18+
- [Electron](https://electronjs.org) (installed via `npm install`)

## Tech stack

- **Electron** — native macOS app, menu bar tray
- **Vanilla JS / HTML / CSS** — no framework, no bundler
- **Built-in PNG generation** — shield icon drawn in code, no image assets needed
- **`~/.aisec/config.json`** — persists settings and event history locally

## License

MIT
