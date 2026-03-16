import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppState, RiskLevel, Rule } from "../types";
import RiskBadge from "../components/RiskBadge";

interface SettingsTabProps {
  rules: Rule[];
  onRuleUpdate: (id: string, enabled: boolean, level?: RiskLevel) => Promise<void>;
  appState: AppState | null;
  onPause: (minutes?: number) => void;
  onResume: () => void;
}

export default function SettingsTab({
  rules,
  onRuleUpdate,
  appState,
  onPause,
  onResume,
}: SettingsTabProps) {
  const [hookStatus, setHookStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [hookMessage, setHookMessage] = useState("");

  async function handleInjectHook() {
    setHookStatus("loading");
    setHookMessage("");
    try {
      await invoke("inject_claude_hook");
      setHookStatus("success");
      setHookMessage("Hook injected successfully into ~/.claude/settings.json");
    } catch (err) {
      setHookStatus("error");
      setHookMessage(`Failed: ${err}`);
    }
  }

  async function handleRemoveHook() {
    setHookStatus("loading");
    setHookMessage("");
    try {
      await invoke("remove_claude_hook");
      setHookStatus("success");
      setHookMessage("Hook removed from ~/.claude/settings.json");
    } catch (err) {
      setHookStatus("error");
      setHookMessage(`Failed: ${err}`);
    }
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Protection controls */}
        <section>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Protection Status
          </h2>
          <div className="card p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-200">
                  {appState?.is_paused ? "Protection is paused" : "Protection is active"}
                </p>
                {appState?.pause_until && (
                  <p className="text-xs text-yellow-400 mt-0.5">
                    Resumes at {new Date(appState.pause_until).toLocaleTimeString()}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                {appState?.is_paused ? (
                  <button onClick={onResume} className="btn-primary text-xs py-1.5 px-3">
                    Resume
                  </button>
                ) : (
                  <>
                    {[15, 30, 60].map((m) => (
                      <button
                        key={m}
                        onClick={() => onPause(m)}
                        className="btn-secondary text-xs py-1.5 px-2"
                      >
                        Pause {m}m
                      </button>
                    ))}
                  </>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Hook management */}
        <section>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Claude Code Hook
          </h2>
          <div className="card p-4 space-y-3">
            <p className="text-xs text-gray-500 leading-relaxed">
              The hook is injected into{" "}
              <code className="bg-gray-700 px-1 rounded text-gray-300 text-xs">
                ~/.claude/settings.json
              </code>{" "}
              as a <code className="bg-gray-700 px-1 rounded text-gray-300 text-xs">PreToolUse</code>{" "}
              hook. It calls this app's local server before every tool execution.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleInjectHook}
                disabled={hookStatus === "loading"}
                className="btn-primary text-xs py-1.5 px-3"
              >
                {hookStatus === "loading" ? "Working…" : "Inject Hook"}
              </button>
              <button
                onClick={handleRemoveHook}
                disabled={hookStatus === "loading"}
                className="btn-secondary text-xs py-1.5 px-3"
              >
                Remove Hook
              </button>
            </div>
            {hookMessage && (
              <p
                className={`text-xs ${
                  hookStatus === "success" ? "text-green-400" : "text-red-400"
                }`}
              >
                {hookMessage}
              </p>
            )}
          </div>
        </section>

        {/* Rules */}
        <section>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Security Rules
          </h2>
          <div className="card divide-y divide-gray-700/50">
            {rules.length === 0 && (
              <div className="p-4 text-center text-gray-600 text-sm">
                Loading rules…
              </div>
            )}
            {rules.map((rule) => (
              <RuleRow key={rule.id} rule={rule} onUpdate={onRuleUpdate} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

interface RuleRowProps {
  rule: Rule;
  onUpdate: (id: string, enabled: boolean, level?: RiskLevel) => Promise<void>;
}

const LEVEL_OPTIONS: RiskLevel[] = ["CRITICAL", "WARN", "INFO"];

function RuleRow({ rule, onUpdate }: RuleRowProps) {
  const [busy, setBusy] = useState(false);

  async function handleToggle() {
    setBusy(true);
    try {
      await onUpdate(rule.id, !rule.enabled);
    } finally {
      setBusy(false);
    }
  }

  async function handleLevelChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setBusy(true);
    try {
      await onUpdate(rule.id, rule.enabled, e.target.value as RiskLevel);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`flex items-start gap-3 p-3.5 transition-opacity ${rule.enabled ? "" : "opacity-50"}`}>
      {/* Toggle */}
      <button
        onClick={handleToggle}
        disabled={busy}
        className={`flex-none mt-0.5 w-9 h-5 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 focus:ring-offset-gray-800 ${
          rule.enabled ? "bg-blue-600" : "bg-gray-600"
        }`}
        role="switch"
        aria-checked={rule.enabled}
        aria-label={`Toggle rule ${rule.id}`}
      >
        <span
          className={`block w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 mx-0.5 ${
            rule.enabled ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-xs font-mono text-gray-500">{rule.id}</span>
          <span className="text-sm font-medium text-gray-200">{rule.name}</span>
        </div>
        <p className="text-xs text-gray-500 leading-snug">{rule.description}</p>
      </div>

      {/* Level selector */}
      <div className="flex-none">
        <select
          value={rule.level}
          onChange={handleLevelChange}
          disabled={busy || !rule.enabled}
          className="bg-gray-800 border border-gray-700 rounded-md text-xs text-gray-300 py-1 pl-2 pr-6 focus:outline-none focus:border-blue-500 disabled:opacity-50"
        >
          {LEVEL_OPTIONS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </div>

      {/* Current badge */}
      <div className="flex-none">
        <RiskBadge level={rule.level} />
      </div>
    </div>
  );
}
