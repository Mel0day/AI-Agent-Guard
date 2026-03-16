import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { WarnEventPayload } from "../types";
import RiskBadge from "./RiskBadge";

interface ConfirmDialogProps {
  payload: WarnEventPayload;
  onResolved: () => void;
}

const TIMEOUT_SECONDS = 4;

/// Highlight dangerous keywords in a string
function HighlightedCode({ text }: { text: string }) {
  // Use non-capturing wrapper so split gives clean [before, match, after, match, ...] pairs
  const patterns = [
    /rm\s+-[a-z]*r[a-z]*f|rm\s+-[a-z]*f[a-z]*r/gi,
    /chmod\s+[^\s]*\+x/gi,
    /curl[^|]*\|[^|]*(?:bash|sh)\b/gi,
    /git\s+config\s+--global/gi,
    /https?:\/\/[^\s"']+/gi,
    /\.(?:env|pem|key|p12)(?:\b|$)/gi,
    /id_rsa/gi,
    /~\/\.(?:ssh|aws|gnupg)\//gi,
  ];

  let parts: Array<{ text: string; highlight: boolean }> = [
    { text, highlight: false },
  ];

  for (const pattern of patterns) {
    const newParts: typeof parts = [];
    for (const part of parts) {
      if (part.highlight) {
        newParts.push(part);
        continue;
      }
      // Split using a capturing group wrapper to interleave matches
      const capturePattern = new RegExp(`(${pattern.source})`, pattern.flags);
      const tokens = part.text.split(capturePattern).filter((t) => t !== undefined);
      // tokens: [before, match, after, match, after, ...]
      // Every odd-indexed token (1, 3, 5, ...) is a match
      tokens.forEach((token, idx) => {
        if (token === "") return;
        newParts.push({ text: token, highlight: idx % 2 === 1 });
      });
    }
    parts = newParts;
  }

  return (
    <>
      {parts.map((p, i) =>
        p.highlight ? (
          <mark key={i} className="bg-red-800/70 text-red-200 rounded px-0.5">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </>
  );
}

export default function ConfirmDialog({
  payload,
  onResolved,
}: ConfirmDialogProps) {
  const [secondsLeft, setSecondsLeft] = useState(TIMEOUT_SECONDS);
  const [resolved, setResolved] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (resolved) return;

    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          // Auto-block on timeout
          handleDecision(false, true);
          return 0;
        }
        return s - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [resolved]);

  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  async function handleDecision(allow: boolean, isTimeout = false) {
    if (resolved) return;
    setResolved(true);
    stopTimer();

    try {
      await invoke("confirm_warn_event", {
        eventId: payload.event_id,
        allow,
      });
    } catch {
      // Event may have already timed out on the Rust side — ignore
    }

    if (!isTimeout) {
      onResolved();
    } else {
      // Small delay so user can see the timeout state
      setTimeout(onResolved, 600);
    }
  }

  const progress = ((TIMEOUT_SECONDS - secondsLeft) / TIMEOUT_SECONDS) * 100;
  const inputJson = JSON.stringify(payload.tool_input, null, 2);

  return (
    // Backdrop
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div
        className="w-full max-w-lg mx-4 bg-gray-900 border border-orange-700/60 rounded-2xl shadow-2xl overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        {/* Timeout progress bar */}
        <div className="h-1 bg-gray-700 relative">
          <div
            className={`h-1 transition-all duration-1000 ease-linear ${
              resolved ? "bg-gray-500" : "bg-orange-500"
            }`}
            style={{ width: `${100 - progress}%` }}
          />
        </div>

        <div className="p-5">
          {/* Header */}
          <div className="flex items-start gap-3 mb-4">
            <div className="flex-none mt-0.5">
              <div className="w-9 h-9 rounded-full bg-orange-900/60 border border-orange-700/60 flex items-center justify-center">
                <svg
                  className="w-5 h-5 text-orange-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                  />
                </svg>
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h2
                  id="confirm-title"
                  className="text-base font-semibold text-gray-100"
                >
                  Security Warning
                </h2>
                <RiskBadge level="WARN" size="sm" />
              </div>
              <p className="text-xs text-gray-400 font-mono">
                Tool:{" "}
                <span className="text-purple-300">{payload.tool_name}</span>
              </p>
            </div>

            {/* Countdown */}
            <div className="flex-none text-right">
              <div
                className={`text-2xl font-bold font-mono tabular-nums ${
                  secondsLeft <= 2 ? "text-red-400" : "text-orange-400"
                }`}
              >
                {resolved ? "–" : secondsLeft}
              </div>
              <div className="text-xs text-gray-500">seconds</div>
            </div>
          </div>

          {/* Reason */}
          <div className="mb-3 p-3 bg-orange-950/40 border border-orange-800/40 rounded-lg">
            <p className="text-sm text-orange-200 leading-snug">
              {payload.reason}
            </p>
            {payload.rule_id && (
              <p className="mt-1 text-xs text-orange-400/70 font-mono">
                Rule {payload.rule_id}: {payload.rule_name}
              </p>
            )}
          </div>

          {/* Tool input */}
          <div className="mb-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">
              Tool Input
            </p>
            <pre className="text-xs font-mono bg-gray-950/80 border border-gray-700/40 rounded-lg p-3 max-h-36 overflow-y-auto text-gray-300">
              <HighlightedCode text={inputJson} />
            </pre>
          </div>

          {/* Action buttons */}
          <div className="flex gap-3">
            <button
              onClick={() => handleDecision(false)}
              disabled={resolved}
              className="flex-1 py-2.5 px-4 bg-red-700 hover:bg-red-600 disabled:bg-gray-700 disabled:text-gray-500 text-white font-semibold rounded-lg transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-gray-900"
            >
              Deny Execution
            </button>
            <button
              onClick={() => handleDecision(true)}
              disabled={resolved}
              className="flex-none py-2.5 px-4 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-700 disabled:text-gray-500 text-gray-200 font-medium rounded-lg transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 focus:ring-offset-gray-900"
            >
              Allow Once
            </button>
          </div>

          {!resolved && (
            <p className="mt-2.5 text-center text-xs text-gray-600">
              Auto-denies in {secondsLeft}s if no response
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
