import type { McpScanItem } from "../types";
import RiskBadge from "../components/RiskBadge";

interface McpScanTabProps {
  items: McpScanItem[];
}

export default function McpScanTab({ items }: McpScanTabProps) {
  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="max-w-2xl mx-auto">
        <div className="mb-4">
          <h2 className="text-base font-semibold text-gray-100 mb-1">MCP Configuration Scan</h2>
          <p className="text-xs text-gray-500">
            Static analysis of your MCP server configurations for potential prompt injection
            or dangerous tool patterns.
          </p>
        </div>

        {items.length === 0 ? (
          <div className="card p-8 text-center">
            <div className="flex flex-col items-center gap-3 text-gray-500">
              <svg className="w-10 h-10 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm font-medium text-gray-400">No issues found</p>
              <p className="text-xs opacity-70">
                All scanned MCP configurations look clean
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item, idx) => (
              <div key={idx} className="card p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-none mt-0.5">
                    <RiskBadge level={item.severity} size="sm" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-mono text-purple-300 truncate">
                        {item.server_name}
                      </span>
                    </div>
                    <p className="text-sm text-gray-300 leading-snug">{item.issue}</p>
                    <p className="mt-1.5 text-xs text-gray-600 font-mono">
                      Source: {item.source_file}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {items.length > 0 && (
          <p className="mt-4 text-xs text-gray-600 text-center">
            {items.length} issue{items.length !== 1 ? "s" : ""} found. Review your MCP configurations manually.
          </p>
        )}
      </div>
    </div>
  );
}
