/**
 * @file useAgentMarkers.test.tsx
 * @description Tests the Machine-mode agent-marker hook: it loads the stored
 * events of the window from the API, names sessions from the session list and
 * live session messages, and reloads after a session start arrives over the
 * WebSocket (but not for unrelated events).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { eventBus } from "../../lib/eventBus";
import { api } from "../../lib/api";
import { useAgentMarkers } from "../useAgentMarkers";
import type { DashboardEvent, Session, WSMessage } from "../../lib/types";

const NOW = Date.now();

const ev = (
  id: number,
  event_type: string,
  over: Partial<DashboardEvent> = {}
): DashboardEvent => ({
  id,
  session_id: "s1",
  agent_id: null,
  event_type,
  tool_name: null,
  summary: null,
  data: null,
  created_at: new Date(NOW - 1000 * id).toISOString(),
  ...over,
});

const page = (events: DashboardEvent[]) => ({
  events,
  limit: 500,
  offset: 0,
  total: events.length,
});
const message = (type: WSMessage["type"], data: unknown) =>
  ({ type, data, timestamp: "" }) as WSMessage;

describe("useAgentMarkers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loads stored markers, then reloads after a live session start", async () => {
    const list = vi
      .spyOn(api.events, "list")
      .mockImplementation(async (params) =>
        params?.event_type?.includes("SessionStart") ? page([ev(3, "SessionStart")]) : page([])
      );
    vi.spyOn(api.sessions, "list").mockResolvedValue({
      sessions: [{ id: "s1", name: "Named", cwd: "/p" } as Session],
      total: 1,
      limit: 100,
      offset: 0,
    });

    const { result } = renderHook(() => useAgentMarkers(300_000));
    await waitFor(() => expect(result.current.markers).toHaveLength(1));
    await waitFor(() => expect(result.current.sessions.get("s1")?.name).toBe("Named"));
    const [sessionCall, toolCall] = list.mock.calls.map((c) => c[0]);
    expect(sessionCall?.event_type).toEqual(["SessionStart", "SessionEnd"]);
    expect(toolCall?.tool_name).toEqual(["Bash", "PowerShell"]);
    expect(Date.parse(sessionCall?.from ?? "")).toBeGreaterThanOrEqual(NOW - 300_000 - 5000);

    list.mockImplementation(async (params) =>
      params?.event_type?.includes("SessionStart")
        ? page([ev(3, "SessionStart"), ev(1, "SessionStart", { session_id: "s2" })])
        : page([])
    );
    act(() => {
      eventBus.publish(message("new_event", { event_type: "PreToolUse", tool_name: "Bash" }));
      eventBus.publish(message("session_created", { id: "s2", name: "Live one", cwd: null }));
    });
    expect(result.current.sessions.get("s2")?.name).toBe("Live one");
    const callsBefore = list.mock.calls.length;
    act(() => {
      eventBus.publish(message("new_event", { event_type: "SessionStart", session_id: "s2" }));
    });
    await waitFor(() => expect(result.current.markers).toHaveLength(2));
    // One reload (two requests) for the session start, none for the PreToolUse.
    expect(list.mock.calls.length).toBe(callsBefore + 2);
  });
});
