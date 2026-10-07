/**
 * @file machineMarkers.test.ts
 * @description Tests the agent-marker selection of the Machine mode: session
 * start / end markers, shell commands kept only from `LONG_COMMAND_MS` (hook
 * duration or PreToolUse pairing), the 5-minute window filter, command
 * truncation and the session-name fallbacks.
 */

import { describe, it, expect } from "vitest";
import {
  LONG_COMMAND_MS,
  markerSessionName,
  markersFromEvents,
  markersInWindow,
  parseEventTime,
  truncateCommand,
  type AgentMarker,
} from "../machineMarkers";
import type { DashboardEvent } from "../types";

const T0 = Date.parse("2026-10-07T12:00:00.000Z");
let nextId = 1;

function event(
  event_type: string,
  atMs: number,
  over: Partial<DashboardEvent> = {},
  data: Record<string, unknown> | null = { cwd: "C:\\work\\agent-monitor" }
): DashboardEvent {
  return {
    id: nextId++,
    session_id: "sess-1234567890",
    agent_id: null,
    event_type,
    tool_name: null,
    summary: null,
    data: data ? JSON.stringify(data) : null,
    created_at: new Date(atMs).toISOString(),
    ...over,
  };
}

const post = (atMs: number, data: Record<string, unknown>, tool = "Bash") =>
  event("PostToolUse", atMs, { tool_name: tool }, { cwd: "/home/me/proj", ...data });

describe("markersFromEvents", () => {
  it("turns SessionStart / SessionEnd into session markers with the project name", () => {
    const markers = markersFromEvents([
      event("SessionEnd", T0 + 5000),
      event("SessionStart", T0),
      event("Stop", T0 + 1000),
    ]);
    expect(markers.map((m) => [m.kind, m.ts, m.project])).toEqual([
      ["sessionStart", T0, "agent-monitor"],
      ["sessionEnd", T0 + 5000, "agent-monitor"],
    ]);
  });

  it("keeps shell commands from the threshold and drops short ones", () => {
    const markers = markersFromEvents([
      post(T0 + 1000, { duration_ms: LONG_COMMAND_MS - 1, tool_input: { command: "ls" } }),
      post(T0 + 2000, { duration_ms: LONG_COMMAND_MS, tool_input: { command: "npm test" } }),
      post(
        T0 + 3000,
        { duration_ms: 42_000, tool_input: { command: "npm run build" } },
        "PowerShell"
      ),
      post(T0 + 4000, { duration_ms: 60_000, tool_input: { file_path: "x" } }, "Read"),
    ]);
    expect(markers.map((m) => [m.kind, m.command, m.durationMs])).toEqual([
      ["command", "npm test", LONG_COMMAND_MS],
      ["command", "npm run build", 42_000],
    ]);
  });

  it("falls back to the matching PreToolUse when the hook gave no duration", () => {
    const markers = markersFromEvents([
      event("PreToolUse", T0, { tool_name: "Bash" }, { tool_use_id: "a" }),
      event("PreToolUse", T0 + 8000, { tool_name: "Bash" }, { tool_use_id: "b" }),
      post(T0 + 12_000, { tool_use_id: "a", tool_input: { command: "sleep 12" } }),
      post(T0 + 12_000, { tool_use_id: "b", tool_input: { command: "sleep 4" } }),
      post(T0 + 13_000, { tool_use_id: "unknown", tool_input: { command: "?" } }),
    ]);
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ command: "sleep 12", durationMs: 12_000, ts: T0 + 12_000 });
  });

  it("ignores events with an unreadable payload or time", () => {
    const broken = { ...post(T0, {}), data: "{not json" };
    const noTime = { ...event("SessionStart", T0), created_at: "nope" };
    expect(markersFromEvents([broken, noTime])).toEqual([]);
  });
});

describe("markersInWindow", () => {
  const at = (ts: number): AgentMarker => ({
    id: String(ts),
    kind: "sessionStart",
    ts,
    sessionId: "s",
    project: null,
  });

  it("keeps only the markers of the last 5 minutes up to the chart end", () => {
    const end = T0 + 600_000;
    const markers = [at(end - 300_001), at(end - 300_000), at(end - 1000), at(end), at(end + 1)];
    expect(markersInWindow(markers, end, 300_000).map((m) => m.ts)).toEqual([
      end - 300_000,
      end - 1000,
      end,
    ]);
  });
});

describe("labels", () => {
  it("truncates long commands to one line with an ellipsis", () => {
    expect(truncateCommand("npm   run\n build")).toBe("npm run build");
    const long = truncateCommand("x".repeat(200));
    expect(long).toHaveLength(80);
    expect(long.endsWith("…")).toBe(true);
  });

  it("names the session by name, then project folder, then short id", () => {
    const marker: AgentMarker = {
      id: "1",
      kind: "sessionStart",
      ts: T0,
      sessionId: "abcdef1234",
      project: null,
    };
    const sessions = new Map([["abcdef1234", { name: "Fix the chart", cwd: "/a/b" }]]);
    expect(markerSessionName(marker, sessions)).toBe("Fix the chart");
    expect(
      markerSessionName(marker, new Map([["abcdef1234", { name: null, cwd: "/a/proj" }]]))
    ).toBe("proj");
    expect(markerSessionName({ ...marker, project: "here" }, new Map())).toBe("here");
    expect(markerSessionName(marker, new Map())).toBe("abcdef12");
  });

  it("reads SQLite-style timestamps as UTC", () => {
    expect(parseEventTime("2026-10-07 12:00:00")).toBe(T0);
  });
});
