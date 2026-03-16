// ─── Shared TypeScript types mirroring the Rust models ───────────────────────

export type RiskLevel = "CRITICAL" | "WARN" | "INFO";

export type Outcome =
  | "Blocked"
  | "Allowed"
  | "UserAllowed"
  | "UserBlocked"
  | "TimedOutBlocked";

export interface Event {
  id: string;
  timestamp: string; // ISO 8601
  tool_name: string;
  tool_input: Record<string, unknown>;
  risk_level: RiskLevel;
  rule_id: string | null;
  rule_name: string | null;
  reason: string;
  outcome: Outcome;
}

export interface AppState {
  is_paused: boolean;
  pause_until: string | null; // ISO 8601
  today_protected: number;
  today_blocked: number;
  last_event_at: string | null;
}

export interface Rule {
  id: string;
  name: string;
  description: string;
  level: RiskLevel;
  enabled: boolean;
  matcher: MatcherType;
}

export type MatcherType =
  | { type: "BashContains"; value: string }
  | { type: "PathAccess"; value: string }
  | { type: "PathWrite"; value: string }
  | { type: "ExternalUrl" };

export interface McpScanItem {
  source_file: string;
  server_name: string;
  issue: string;
  severity: RiskLevel;
}

export interface EventFilter {
  risk_level?: RiskLevel;
  search?: string;
  limit?: number;
  offset?: number;
}

/// Emitted by Rust when a WARN event needs user decision
export interface WarnEventPayload {
  event_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  rule_id: string;
  rule_name: string;
  reason: string;
  risk_level: "WARN";
}
