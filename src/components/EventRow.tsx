import { useState } from "react";
import type { Event } from "../types";
import RiskBadge from "./RiskBadge";

interface EventRowProps {
  event: Event;
}

const OUTCOME_LABELS: Record<string, string> = {
  Blocked: "Auto-Blocked",
  Allowed: "Allowed",
  UserAllowed: "User Allowed",
  UserBlocked: "User Blocked",
  TimedOutBlocked: "Timeout Blocked",
};

const OUTCOME_COLORS: Record<string, string> = {
  Blocked: "text-red-400",
  Allowed: "text-green-400",
  UserAllowed: "text-green-300",
  UserBlocked: "text-orange-400",
  TimedOutBlocked: "text-orange-500",
};

/// Highlight dangerous keywords in a string
function highlightDangerous(text: string): JSX.Element {
  const dangerousPatterns = [
    /rm\s+-rf/gi,
    /curl[^|]*\|[^|]*bash/gi,
    /wget[^|]*\|[^|]*sh/gi,
    /chmod\s+[^\s]*\+x/gi,
    /git\s+config\s+--global/gi,
    /https?:\/\/[^\s"']+/gi,
  ];

  let parts: Array<{ text: string; highlight: boolean }> = [
    { text, highlight: false },
  ];

  for (const pattern of dangerousPatterns) {
    const newParts: typeof parts = [];
    for (const part of parts) {
      if (part.highlight) {
        newParts.push(part);
        continue;
      }
      const capturePattern = new RegExp(`(${pattern.source})`, pattern.flags);
      const tokens = part.text.split(capturePattern).filter((t) => t !== undefined);
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
          <mark key={i} className="bg-red-900/50 text-red-300 rounded px-0.5">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function summarizeInput(input: Record<string, unknown>): string {
  // Try to extract the most meaningful field
  if (typeof input.command === "string") {
    return input.command.length > 80
      ? input.command.slice(0, 80) + "…"
      : input.command;
  }
  if (typeof input.path === "string") return input.path;
  if (typeof input.file_path === "string") return input.file_path;
  const str = JSON.stringify(input);
  return str.length > 80 ? str.slice(0, 80) + "…" : str;
}

export default function EventRow({ event }: EventRowProps) {
  const [expanded, setExpanded] = useState(false);
  const inputJson = JSON.stringify(event.tool_input, null, 2);

  return (
    <div
      className="border-b border-gray-700/50 hover:bg-gray-800/40 transition-colors"
    >
      {/* Summary row */}
      <button
        className="w-full text-left px-4 py-2.5 flex items-center gap-3 min-w-0"
        onClick={() => setExpanded((e) => !e)}
      >
        {/* Time */}
        <div className="flex-none w-24 text-right">
          <div className="text-xs text-gray-400 font-mono">{formatTime(event.timestamp)}</div>
          <div className="text-xs text-gray-600 font-mono">{formatDate(event.timestamp)}</div>
        </div>

        {/* Risk badge */}
        <div className="flex-none w-20">
          <RiskBadge level={event.risk_level} />
        </div>

        {/* Tool name */}
        <div className="flex-none w-28">
          <span className="text-sm font-mono text-purple-300 truncate block">
            {event.tool_name}
          </span>
        </div>

        {/* Summary */}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-300 truncate font-mono">
            {summarizeInput(event.tool_input)}
          </p>
          {event.rule_name && (
            <p className="text-xs text-gray-500 truncate">
              {event.rule_id}: {event.rule_name}
            </p>
          )}
        </div>

        {/* Outcome */}
        <div className="flex-none w-32 text-right">
          <span
            className={`text-xs font-semibold ${
              OUTCOME_COLORS[event.outcome] ?? "text-gray-400"
            }`}
          >
            {OUTCOME_LABELS[event.outcome] ?? event.outcome}
          </span>
        </div>

        {/* Expand chevron */}
        <div className="flex-none w-5 text-gray-500">
          <svg
            className={`w-4 h-4 transition-transform duration-150 ${
              expanded ? "rotate-180" : ""
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 bg-gray-800/60 border-t border-gray-700/30">
          <div className="pt-3 space-y-3">
            {/* Risk reason */}
            <div>
              <span className="text-xs text-gray-500 uppercase tracking-wider">
                Reason
              </span>
              <p className="mt-1 text-sm text-gray-300">{event.reason}</p>
            </div>

            {/* Full tool input */}
            <div>
              <span className="text-xs text-gray-500 uppercase tracking-wider">
                Tool Input
              </span>
              <pre className="mt-1 text-xs font-mono bg-gray-900/80 rounded-lg p-3 overflow-x-auto text-gray-200 border border-gray-700/40 max-h-48">
                {highlightDangerous(inputJson)}
              </pre>
            </div>

            {/* Rule info */}
            {event.rule_id && (
              <div className="flex gap-4 text-xs text-gray-500">
                <span>
                  <span className="text-gray-400">Rule:</span>{" "}
                  <span className="font-mono text-purple-300">{event.rule_id}</span>
                </span>
                <span>
                  <span className="text-gray-400">Name:</span>{" "}
                  {event.rule_name}
                </span>
              </div>
            )}

            {/* Outcome */}
            <div className="text-xs text-gray-500">
              <span className="text-gray-400">Outcome:</span>{" "}
              <span className={OUTCOME_COLORS[event.outcome] ?? "text-gray-400"}>
                {OUTCOME_LABELS[event.outcome] ?? event.outcome}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
