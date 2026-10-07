/**
 * @file machineMarkers.ts
 * @description Pure helpers behind the agent markers drawn on the Machine-mode
 * chart: turn stored dashboard events into markers (session start / end, end of
 * Bash or PowerShell commands that ran for at least `LONG_COMMAND_MS`), keep the
 * ones inside the chart's time window, and build their hover labels.
 */

import type { DashboardEvent, Session } from "./types";

/** A shell command ending after at least this long gets a marker. */
export const LONG_COMMAND_MS = 10_000;

/** Shell tools whose completion can produce a command marker. */
export const SHELL_TOOLS = ["Bash", "PowerShell"] as const;

/** Event types the markers are read from. */
export const MARKER_EVENT_TYPES = ["SessionStart", "SessionEnd", "PreToolUse", "PostToolUse"];

/** Longest command text shown in a marker label. */
export const COMMAND_LABEL_MAX = 80;

export type AgentMarkerKind = "sessionStart" | "sessionEnd" | "command";

export interface AgentMarker {
  /** Stable key (event id). */
  id: string;
  kind: AgentMarkerKind;
  /** Epoch ms of the marker (event time; command end for commands). */
  ts: number;
  sessionId: string;
  /** Last path segment of the session's working directory, when known. */
  project: string | null;
  /** Full command text for `command` markers. */
  command?: string;
  durationMs?: number;
}

/** Parse an event timestamp; SQLite `YYYY-MM-DD HH:MM:SS` values are UTC. */
export function parseEventTime(value: string): number {
  const iso = /^\d{4}-\d{2}-\d{2} \d/.test(value) ? `${value.replace(" ", "T")}Z` : value;
  return Date.parse(iso);
}

function parseData(event: DashboardEvent): Record<string, unknown> | null {
  if (!event.data) return null;
  try {
    const parsed: unknown = JSON.parse(event.data);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function projectOf(data: Record<string, unknown> | null): string | null {
  const cwd = typeof data?.cwd === "string" ? data.cwd : "";
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? null;
}

function commandOf(data: Record<string, unknown> | null): string | null {
  const input = data?.tool_input as Record<string, unknown> | undefined;
  return typeof input?.command === "string" ? input.command : null;
}

const isShellTool = (name: string | null) =>
  !!name && (SHELL_TOOLS as readonly string[]).includes(name);

/**
 * Build markers from stored events. Session markers come from SessionStart and
 * SessionEnd; command markers from the PostToolUse of a shell tool whose
 * duration (hook `duration_ms`, else the gap since the PreToolUse sharing its
 * `tool_use_id`) reaches `minCommandMs`. Sorted by time.
 */
export function markersFromEvents(
  events: readonly DashboardEvent[],
  minCommandMs = LONG_COMMAND_MS
): AgentMarker[] {
  const preStart = new Map<string, number>();
  for (const e of events) {
    if (e.event_type !== "PreToolUse" || !isShellTool(e.tool_name)) continue;
    const id = parseData(e)?.tool_use_id;
    if (typeof id === "string") preStart.set(id, parseEventTime(e.created_at));
  }

  const markers: AgentMarker[] = [];
  for (const e of events) {
    const ts = parseEventTime(e.created_at);
    if (!Number.isFinite(ts)) continue;
    if (e.event_type === "SessionStart" || e.event_type === "SessionEnd") {
      markers.push({
        id: String(e.id),
        kind: e.event_type === "SessionStart" ? "sessionStart" : "sessionEnd",
        ts,
        sessionId: e.session_id,
        project: projectOf(parseData(e)),
      });
      continue;
    }
    if (e.event_type !== "PostToolUse" || !isShellTool(e.tool_name)) continue;
    const data = parseData(e);
    let durationMs: number | null = null;
    if (typeof data?.duration_ms === "number") durationMs = data.duration_ms;
    else if (typeof data?.tool_use_id === "string" && preStart.has(data.tool_use_id)) {
      durationMs = ts - (preStart.get(data.tool_use_id) as number);
    }
    if (durationMs == null || durationMs < minCommandMs) continue;
    markers.push({
      id: String(e.id),
      kind: "command",
      ts,
      sessionId: e.session_id,
      project: projectOf(data),
      command: commandOf(data) ?? e.tool_name ?? "",
      durationMs,
    });
  }
  return markers.sort((a, b) => a.ts - b.ts);
}

/** Markers falling inside the window `[endTs - windowMs, endTs]`. */
export function markersInWindow(
  markers: readonly AgentMarker[],
  endTs: number,
  windowMs: number
): AgentMarker[] {
  const start = endTs - windowMs;
  return markers.filter((m) => m.ts >= start && m.ts <= endTs);
}

/** Single-line command, cut to `max` characters with an ellipsis. */
export function truncateCommand(command: string, max = COMMAND_LABEL_MAX): string {
  const line = command.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * Display name of a marker's session: the session's own name, else its project
 * folder, else the first 8 characters of its id.
 */
export function markerSessionName(
  marker: AgentMarker,
  sessions: ReadonlyMap<string, Pick<Session, "name" | "cwd">>
): string {
  const session = sessions.get(marker.sessionId);
  if (session?.name) return session.name;
  const project = marker.project ?? projectOf(session?.cwd ? { cwd: session.cwd } : null);
  return project ?? marker.sessionId.slice(0, 8);
}
