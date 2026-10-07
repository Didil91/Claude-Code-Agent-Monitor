/**
 * @file useAgentMarkers.ts
 * @description React hook feeding the agent markers of the Machine-mode chart.
 * Reads the already-stored session start/end and shell-tool events of the last
 * window through `GET /api/events` (no new collection), resolves session names
 * from `GET /api/sessions`, and reloads the window shortly after a matching
 * `new_event` WebSocket message — that message carries no hook payload, so the
 * command text and duration have to be read back from the API.
 */

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { eventBus } from "../lib/eventBus";
import { MACHINE_WINDOW_MS } from "../lib/machine";
import { markersFromEvents, SHELL_TOOLS, type AgentMarker } from "../lib/machineMarkers";
import type { DashboardEvent, Session, WSMessage } from "../lib/types";

/** Coalesces bursts of events into one reload. */
const RELOAD_DELAY_MS = 400;
/** Recent sessions fetched once to name the markers. */
const SESSION_NAME_LIMIT = 100;
const EVENT_LIMIT = 500;

export type MarkerSessions = Map<string, Pick<Session, "name" | "cwd">>;

export interface AgentMarkersState {
  markers: AgentMarker[];
  sessions: MarkerSessions;
}

function isMarkerEvent(event: Partial<DashboardEvent> | undefined): boolean {
  if (!event) return false;
  if (event.event_type === "SessionStart" || event.event_type === "SessionEnd") return true;
  return (
    event.event_type === "PostToolUse" &&
    (SHELL_TOOLS as readonly string[]).includes(event.tool_name ?? "")
  );
}

async function loadMarkers(windowMs: number): Promise<AgentMarker[]> {
  const from = new Date(Date.now() - windowMs).toISOString();
  const [sessionEvents, toolEvents] = await Promise.all([
    api.events.list({ event_type: ["SessionStart", "SessionEnd"], from, limit: EVENT_LIMIT }),
    api.events.list({
      event_type: ["PreToolUse", "PostToolUse"],
      tool_name: [...SHELL_TOOLS],
      from,
      limit: EVENT_LIMIT,
    }),
  ]);
  return markersFromEvents([...sessionEvents.events, ...toolEvents.events]);
}

export function useAgentMarkers(windowMs = MACHINE_WINDOW_MS): AgentMarkersState {
  const [markers, setMarkers] = useState<AgentMarker[]>([]);
  const [sessions, setSessions] = useState<MarkerSessions>(() => new Map());

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const reload = () => {
      loadMarkers(windowMs)
        .then((next) => {
          if (!cancelled) setMarkers(next);
        })
        // Markers are decoration: a failed load keeps the previous set.
        .catch(() => {});
    };
    const scheduleReload = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(reload, RELOAD_DELAY_MS);
    };

    reload();
    api.sessions
      .list({ limit: SESSION_NAME_LIMIT })
      .then(({ sessions: list }) => {
        if (cancelled) return;
        setSessions((prev) => {
          const next: MarkerSessions = new Map(
            list.map((s) => [s.id, { name: s.name, cwd: s.cwd }])
          );
          for (const [id, s] of prev) next.set(id, s);
          return next;
        });
      })
      .catch(() => {});

    const unsubscribe = eventBus.subscribe((msg: WSMessage) => {
      if (msg.type === "session_created" || msg.type === "session_updated") {
        const s = msg.data as Session | undefined;
        if (!s?.id) return;
        setSessions((prev) => {
          const known = prev.get(s.id);
          if (known && known.name === s.name && known.cwd === s.cwd) return prev;
          return new Map(prev).set(s.id, { name: s.name, cwd: s.cwd });
        });
        return;
      }
      if (msg.type === "new_event" && isMarkerEvent(msg.data as Partial<DashboardEvent>)) {
        scheduleReload();
      }
    });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [windowMs]);

  return { markers, sessions };
}
