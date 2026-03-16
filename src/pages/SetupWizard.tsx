import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Event } from "../types";

interface SetupWizardProps {
  onComplete: () => void;
}

type Step = 1 | 2 | 3 | 4;

function StepIndicator({ current, total }: { current: Step; total: number }) {
  return (
    <div className="flex items-center gap-2 mb-6">
      {Array.from({ length: total }, (_, i) => i + 1).map((step) => (
        <div key={step} className="flex items-center">
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-all ${
              step < current
                ? "bg-green-600 text-white"
                : step === current
                ? "bg-blue-600 text-white ring-2 ring-blue-400 ring-offset-2 ring-offset-gray-900"
                : "bg-gray-700 text-gray-500"
            }`}
          >
            {step < current ? (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              step
            )}
          </div>
          {step < total && (
            <div
              className={`w-8 h-0.5 mx-1 ${
                step < current ? "bg-green-600" : "bg-gray-700"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export default function SetupWizard({ onComplete }: SetupWizardProps) {
  const [step, setStep] = useState<Step>(1);
  const [claudeInstalled, setClaudeInstalled] = useState<boolean | null>(null);
  const [injecting, setInjecting] = useState(false);
  const [injectError, setInjectError] = useState("");
  const [testEventDetected, setTestEventDetected] = useState(false);

  // Step 1: detect Claude Code
  useEffect(() => {
    if (step !== 1) return;
    checkClaudeInstalled().then(setClaudeInstalled);
  }, [step]);

  // Step 3: listen for any event (proof the hook works)
  useEffect(() => {
    if (step !== 3) return;

    const unlisten = listen<Event>("new_event", () => {
      setTestEventDetected(true);
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, [step]);

  async function checkClaudeInstalled(): Promise<boolean> {
    try {
      const result = await invoke<boolean>("check_claude_installed");
      return result;
    } catch {
      // Fallback: assume installed (user can proceed manually)
      return true;
    }
  }

  async function handleInjectHook() {
    setInjecting(true);
    setInjectError("");
    try {
      await invoke("inject_claude_hook");
      setStep(3);
    } catch (err) {
      setInjectError(`Failed to inject hook: ${err}`);
    } finally {
      setInjecting(false);
    }
  }

  return (
    <div className="h-full flex items-center justify-center bg-gray-900 p-6">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600 to-purple-700 flex items-center justify-center mx-auto mb-4 shadow-xl shadow-blue-900/40">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-100">AI Agent Guard</h1>
          <p className="text-sm text-gray-500 mt-1">Setup Wizard</p>
        </div>

        <StepIndicator current={step} total={4} />

        {/* Step 1: Welcome */}
        {step === 1 && (
          <div className="card p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-100">Welcome</h2>
            <p className="text-sm text-gray-400 leading-relaxed">
              AI Agent Guard monitors every tool call made by Claude Code, blocking dangerous
              commands and alerting you to suspicious activity in real time.
            </p>

            <div className="flex items-start gap-3 p-3 bg-gray-700/30 rounded-lg border border-gray-700/40">
              <div
                className={`w-2.5 h-2.5 rounded-full mt-1 flex-none ${
                  claudeInstalled === null
                    ? "bg-yellow-400 animate-pulse"
                    : claudeInstalled
                    ? "bg-green-400"
                    : "bg-red-400"
                }`}
              />
              <div>
                <p className="text-sm font-medium text-gray-200">
                  Claude Code
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {claudeInstalled === null
                    ? "Checking…"
                    : claudeInstalled
                    ? "Detected on this system"
                    : "Not detected — you can still proceed but hooks won't take effect until Claude Code is installed"}
                </p>
              </div>
            </div>

            <button onClick={() => setStep(2)} className="btn-primary w-full justify-center py-2.5">
              Get Started
            </button>
          </div>
        )}

        {/* Step 2: Inject hook */}
        {step === 2 && (
          <div className="card p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-100">Install Hook</h2>
            <p className="text-sm text-gray-400 leading-relaxed">
              AI Agent Guard will modify the following file to intercept Claude Code tool
              calls. No other changes are made to your system.
            </p>

            <div className="bg-gray-900/80 border border-gray-700/50 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-1 uppercase tracking-wider">File to modify</p>
              <code className="text-sm font-mono text-green-400">
                ~/.claude/settings.json
              </code>
              <p className="text-xs text-gray-600 mt-1">
                Adds a{" "}
                <code className="bg-gray-700 px-1 rounded text-gray-300">PreToolUse</code> hook that
                calls <code className="bg-gray-700 px-1 rounded text-gray-300">127.0.0.1:47821</code>{" "}
                before each tool execution.
              </p>
            </div>

            <div className="text-xs text-gray-600 space-y-1">
              <p>The hook script uses only standard tools: <code className="bg-gray-700 px-1 rounded text-gray-400">curl</code> and <code className="bg-gray-700 px-1 rounded text-gray-400">python3</code></p>
              <p>If this app is not running, the hook <strong className="text-gray-400">fails open</strong> (allows all actions).</p>
            </div>

            {injectError && (
              <p className="text-xs text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg p-3">
                {injectError}
              </p>
            )}

            <div className="flex gap-3">
              <button onClick={() => setStep(1)} className="btn-secondary flex-none">
                Back
              </button>
              <button
                onClick={handleInjectHook}
                disabled={injecting}
                className="btn-primary flex-1 justify-center py-2.5"
              >
                {injecting ? "Injecting…" : "Inject Hook"}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Test */}
        {step === 3 && (
          <div className="card p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-100">Test the Hook</h2>
            <p className="text-sm text-gray-400 leading-relaxed">
              The hook has been injected. Now test it by running any command in Claude Code
              (even a simple one like listing files).
            </p>

            <div className="flex items-center gap-3 p-3 bg-gray-700/30 rounded-lg border border-gray-700/40">
              {testEventDetected ? (
                <div className="w-8 h-8 rounded-full bg-green-700 flex items-center justify-center">
                  <svg className="w-4 h-4 text-green-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              ) : (
                <div className="w-8 h-8 rounded-full border-2 border-blue-500/60 border-t-blue-400 animate-spin" />
              )}
              <div>
                <p className="text-sm font-medium text-gray-200">
                  {testEventDetected
                    ? "Event detected! Hook is working."
                    : "Waiting for a Claude Code event…"}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {testEventDetected
                    ? "AI Agent Guard is successfully intercepting tool calls."
                    : "Run any tool in Claude Code to verify the hook is working."}
                </p>
              </div>
            </div>

            {testEventDetected && (
              <button
                onClick={() => setStep(4)}
                className="btn-primary w-full justify-center py-2.5"
              >
                Continue
              </button>
            )}

            <button
              onClick={() => setStep(4)}
              className="text-xs text-gray-600 hover:text-gray-400 w-full text-center transition-colors"
            >
              Skip test and finish anyway
            </button>
          </div>
        )}

        {/* Step 4: Done */}
        {step === 4 && (
          <div className="card p-6 text-center space-y-4">
            <div className="w-14 h-14 rounded-full bg-green-700/30 border border-green-600/40 flex items-center justify-center mx-auto">
              <svg className="w-7 h-7 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-100">All Done!</h2>
            <p className="text-sm text-gray-400">
              AI Agent Guard is now protecting your Claude Code sessions. You can adjust rules
              and settings from the main window.
            </p>
            <button onClick={onComplete} className="btn-primary w-full justify-center py-2.5">
              Open Dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
