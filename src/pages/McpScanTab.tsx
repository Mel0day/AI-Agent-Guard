import { useState } from "react";
import type { McpScanEntry } from "../types";
import RiskBadge from "../components/RiskBadge";

interface McpScanTabProps {
  history: McpScanEntry[];
  onRescan: () => Promise<void>;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function McpScanTab({ history, onRescan }: McpScanTabProps) {
  const [scanning, setScanning] = useState(false);

  async function handleRescan() {
    setScanning(true);
    try {
      await onRescan();
    } finally {
      setScanning(false);
    }
  }

  const latestIssueCount = history[0]?.items.length ?? 0;

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="max-w-2xl mx-auto">

        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-gray-100 mb-1">MCP Configuration Scan</h2>
            <p className="text-xs text-gray-500">
              Static analysis of MCP server configurations for prompt injection and dangerous tool patterns.
              {history.length > 0 && (
                <span className="ml-1 text-gray-600">
                  {history.length} scan{history.length !== 1 ? "s" : ""} recorded this session.
                </span>
              )}
            </p>
          </div>
          <button
            onClick={handleRescan}
            disabled={scanning}
            className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5 shrink-0 ml-4"
          >
            <svg
              className={`w-3.5 h-3.5 ${scanning ? "animate-spin" : ""}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {scanning ? "Scanning…" : "Rescan"}
          </button>
        </div>

        {/* No history yet */}
        {history.length === 0 && (
          <div className="card p-8 text-center">
            <div className="flex flex-col items-center gap-3 text-gray-500">
              <svg className="w-10 h-10 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm font-medium text-gray-400">No scans yet</p>
              <p className="text-xs opacity-70">Click Rescan or wait for a config file change</p>
            </div>
          </div>
        )}

        {/* Scan history — newest first */}
        <div className="space-y-4">
          {history.map((entry, idx) => {
            const isLatest = idx === 0;
            const hasIssues = entry.items.length > 0;

            return (
              <div key={entry.scanned_at} className="card overflow-hidden">
                {/* Entry header */}
                <div className={`flex items-center justify-between px-4 py-2.5 border-b border-gray-700/60
                  ${isLatest ? "bg-gray-800/60" : "bg-gray-800/30"}`}>
                  <div className="flex items-center gap-2">
                    {isLatest && (
                      <span className="text-xs font-medium text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded">
                        Latest
                      </span>
                    )}
                    <span className="text-xs text-gray-400 font-mono">
                      {formatTime(entry.scanned_at)}
                    </span>
                  </div>
                  <span className={`text-xs font-medium ${hasIssues ? "text-orange-400" : "text-green-400"}`}>
                    {hasIssues
                      ? `${entry.items.length} issue${entry.items.length !== 1 ? "s" : ""} found`
                      : "✓ No issues"}
                  </span>
                </div>

                {/* Issues list */}
                {hasIssues ? (
                  <div className="divide-y divide-gray-700/40">
                    {entry.items.map((item, i) => (
                      <div key={i} className="flex items-start gap-3 px-4 py-3">
                        <div className="flex-none mt-0.5">
                          <RiskBadge level={item.severity} size="sm" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-mono text-purple-300 truncate block">
                            {item.server_name}
                          </span>
                          <p className="text-sm text-gray-300 leading-snug mt-0.5">{item.issue}</p>
                          <p className="mt-1 text-xs text-gray-600 font-mono">
                            {item.source_file}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="px-4 py-3 text-xs text-gray-600">
                    All scanned MCP configurations looked clean at this time.
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Summary footer */}
        {history.length > 1 && (
          <p className="mt-4 text-xs text-gray-600 text-center">
            Current state:{" "}
            <span className={latestIssueCount > 0 ? "text-orange-400" : "text-green-400"}>
              {latestIssueCount > 0
                ? `${latestIssueCount} active issue${latestIssueCount !== 1 ? "s" : ""}`
                : "clean"}
            </span>
          </p>
        )}
      </div>
    </div>
  );
}
