import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AppState, Event, EventFilter, McpScanItem, RiskLevel, Rule } from "../types";
import EventRow from "../components/EventRow";
import RiskBadge from "../components/RiskBadge";
import McpScanTab from "./McpScanTab";
import SettingsTab from "./SettingsTab";

type Tab = "logs" | "mcp" | "settings";
type FilterLevel = "ALL" | RiskLevel;

const INITIAL_LIMIT = 100;
const LOAD_MORE_STEP = 100;
const MAX_EVENTS = 1000;

function StatusDot({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ${
        active ? "bg-green-400 shadow-lg shadow-green-500/40" : "bg-yellow-400 shadow-lg shadow-yellow-500/40"
      }`}
    />
  );
}

export default function LogWindow() {
  const [tab, setTab] = useState<Tab>("logs");
  const [events, setEvents] = useState<Event[]>([]);
  const [appState, setAppState] = useState<AppState | null>(null);
  const [filterLevel, setFilterLevel] = useState<FilterLevel>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mcpItems, setMcpItems] = useState<McpScanItem[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchQuery]);

  // Load more events (appends to existing list)
  const loadMoreEvents = useCallback(async () => {
    setLoading(true);
    try {
      const filter: EventFilter = {
        risk_level: filterLevel !== "ALL" ? filterLevel : undefined,
        search: debouncedSearch.trim() || undefined,
        limit: LOAD_MORE_STEP,
        offset,
      };
      const fetched = await invoke<Event[]>("get_events", { filter });
      setEvents((prev) => {
        const merged = [...prev, ...fetched];
        return merged.slice(0, MAX_EVENTS);
      });
      const newOffset = offset + fetched.length;
      setOffset(newOffset);
      setHasMore(fetched.length === LOAD_MORE_STEP && newOffset < MAX_EVENTS);
    } catch (err) {
      console.error("Failed to load more events:", err);
    } finally {
      setLoading(false);
    }
  }, [filterLevel, debouncedSearch, offset]);

  const loadAppState = useCallback(async () => {
    try {
      const state = await invoke<AppState>("get_state");
      setAppState(state);
    } catch (err) {
      console.error("Failed to load app state:", err);
    }
  }, []);

  // Reload events + state when filters change
  useEffect(() => {
    setOffset(0);
    const doLoad = async () => {
      setLoading(true);
      try {
        const filter: EventFilter = {
          risk_level: filterLevel !== "ALL" ? filterLevel : undefined,
          search: debouncedSearch.trim() || undefined,
          limit: INITIAL_LIMIT,
          offset: 0,
        };
        const fetched = await invoke<Event[]>("get_events", { filter });
        setEvents(fetched.slice(0, MAX_EVENTS));
        setOffset(fetched.length);
        setHasMore(fetched.length === INITIAL_LIMIT && fetched.length < MAX_EVENTS);
      } catch (err) {
        console.error("Failed to load events:", err);
      } finally {
        setLoading(false);
      }
    };
    doLoad();
    loadAppState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterLevel, debouncedSearch]);

  // Periodic state refresh
  useEffect(() => {
    const interval = setInterval(loadAppState, 5000);
    return () => clearInterval(interval);
  }, []);

  // Listen for new events from Rust
  useEffect(() => {
    const unlisten = listen<Event>("new_event", (evt) => {
      setEvents((prev) => {
        // Check filter match
        const e = evt.payload;
        if (filterLevel !== "ALL" && e.risk_level !== filterLevel) return prev;
        if (debouncedSearch) {
          const q = debouncedSearch.toLowerCase();
          const match =
            e.tool_name.toLowerCase().includes(q) ||
            e.reason.toLowerCase().includes(q) ||
            JSON.stringify(e.tool_input).toLowerCase().includes(q);
          if (!match) return prev;
        }
        return [e, ...prev].slice(0, MAX_EVENTS);
      });
      // Update counters
      setAppState((prev) =>
        prev
          ? {
              ...prev,
              today_protected: prev.today_protected + 1,
              today_blocked:
                evt.payload.outcome === "Blocked" ||
                evt.payload.outcome === "UserBlocked" ||
                evt.payload.outcome === "TimedOutBlocked"
                  ? prev.today_blocked + 1
                  : prev.today_blocked,
              last_event_at: evt.payload.timestamp,
            }
          : null
      );
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [filterLevel, debouncedSearch]);

  // Load MCP items when switching to that tab
  useEffect(() => {
    if (tab === "mcp") {
      invoke<McpScanItem[]>("get_mcp_scan_result")
        .then(setMcpItems)
        .catch(console.error);
    }
    if (tab === "settings") {
      invoke<Rule[]>("get_rules").then(setRules).catch(console.error);
    }
  }, [tab]);

  async function handlePause(minutes?: number) {
    try {
      await invoke("toggle_pause", { durationMinutes: minutes ?? null });
      await loadAppState();
    } catch (err) {
      console.error("Failed to toggle pause:", err);
    }
  }

  async function handleResume() {
    try {
      await invoke("resume_protection");
      await loadAppState();
    } catch (err) {
      console.error("Failed to resume protection:", err);
    }
  }

  const isPaused = appState?.is_paused ?? false;
  const pauseUntil = appState?.pause_until
    ? new Date(appState.pause_until).toLocaleTimeString()
    : null;

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Top status bar */}
      <header className="flex items-center gap-4 px-4 py-3 bg-gray-900 border-b border-gray-700/60 shrink-0">
        {/* Logo + status */}
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <span className="text-sm font-semibold text-gray-100">AI Agent Guard</span>
          <StatusDot active={!isPaused} />
          {isPaused && (
            <span className="text-xs text-yellow-400">
              Paused{pauseUntil ? ` until ${pauseUntil}` : ""}
            </span>
          )}
        </div>

        {/* Stats */}
        {appState && (
          <div className="flex items-center gap-4 text-xs text-gray-400">
            <span>
              Today:{" "}
              <span className="text-gray-200 font-semibold">
                {appState.today_protected}
              </span>{" "}
              checked
            </span>
            <span>
              <span className="text-red-400 font-semibold">
                {appState.today_blocked}
              </span>{" "}
              blocked
            </span>
          </div>
        )}

        <div className="flex-1" />

        {/* Pause / Resume controls */}
        {isPaused ? (
          <button
            onClick={handleResume}
            className="btn-primary text-xs py-1.5 px-3"
          >
            Resume Protection
          </button>
        ) : (
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-500 mr-1">Pause:</span>
            {[15, 30, 60].map((m) => (
              <button
                key={m}
                onClick={() => handlePause(m)}
                className="btn-secondary text-xs py-1 px-2"
              >
                {m}m
              </button>
            ))}
          </div>
        )}
      </header>

      {/* Tab navigation */}
      <nav className="flex gap-1 px-4 pt-2 pb-0 bg-gray-900 border-b border-gray-700/60 shrink-0">
        {(["logs", "mcp", "settings"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
              tab === t
                ? "border-blue-500 text-blue-400 bg-gray-800/50"
                : "border-transparent text-gray-500 hover:text-gray-300 hover:bg-gray-800/30"
            }`}
          >
            {t === "logs" && "Event Log"}
            {t === "mcp" && (
              <span className="flex items-center gap-1.5">
                MCP Scan
                {mcpItems.length > 0 && (
                  <span className="bg-orange-600 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
                    {mcpItems.length}
                  </span>
                )}
              </span>
            )}
            {t === "settings" && "Rules & Settings"}
          </button>
        ))}
      </nav>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === "logs" && (
          <div className="flex flex-col h-full">
            {/* Filters */}
            <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-900 border-b border-gray-700/40 shrink-0">
              {/* Level segmented control */}
              <div className="flex bg-gray-800 rounded-lg p-0.5 gap-0.5">
                {(["ALL", "CRITICAL", "WARN", "INFO"] as FilterLevel[]).map(
                  (level) => (
                    <button
                      key={level}
                      onClick={() => setFilterLevel(level)}
                      className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                        filterLevel === level
                          ? "bg-gray-700 text-gray-100 shadow"
                          : "text-gray-500 hover:text-gray-300"
                      }`}
                    >
                      {level === "ALL" ? "All" : <RiskBadge level={level as RiskLevel} />}
                    </button>
                  )
                )}
              </div>

              {/* Search */}
              <div className="flex-1 relative">
                <svg
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                <input
                  type="text"
                  placeholder="Search tool, path, command…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700/60 rounded-lg pl-9 pr-3 py-1.5 text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>

              {/* Count */}
              <span className="text-xs text-gray-600">
                {events.length} event{events.length !== 1 ? "s" : ""}
              </span>
            </div>

            {/* Event list */}
            <div className="flex-1 overflow-y-auto">
              {events.length === 0 && !loading ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-600">
                  <svg className="w-12 h-12 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  <p className="text-sm">No events yet</p>
                  <p className="text-xs opacity-60">Events will appear here when Claude Code tools are used</p>
                </div>
              ) : (
                <div>
                  {events.map((event) => (
                    <EventRow key={event.id} event={event} />
                  ))}

                  {/* Load more */}
                  {hasMore && (
                    <div className="p-4 text-center">
                      <button
                        onClick={loadMoreEvents}
                        disabled={loading}
                        className="btn-secondary text-xs"
                      >
                        {loading ? "Loading…" : `Load more (${offset} loaded, max ${MAX_EVENTS})`}
                      </button>
                    </div>
                  )}

                  {loading && events.length === 0 && (
                    <div className="p-8 text-center text-gray-600 text-sm">
                      Loading events…
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "mcp" && <McpScanTab items={mcpItems} />}
        {tab === "settings" && (
          <SettingsTab
            rules={rules}
            onRuleUpdate={async (id, enabled, level) => {
              await invoke("update_rule", {
                ruleId: id,
                enabled,
                level: level ?? null,
              });
              const updated = await invoke<Rule[]>("get_rules");
              setRules(updated);
            }}
            appState={appState}
            onPause={handlePause}
            onResume={handleResume}
          />
        )}
      </div>
    </div>
  );
}
