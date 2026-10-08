/**
 * @file useSessionCpu.ts
 * @description Live value of one session's CPU tag: reads the session's share from
 * the `cpuBySession` map of each `machine.sample` WebSocket message and folds every new
 * process snapshot into the smoothing / hysteresis track of `lib/sessionCpu`. Null
 * while the tag should stay hidden (idle session, no reading yet) and after the
 * WebSocket disconnects, so a card never shows a stale value. Re-renders only when
 * the displayed value changes. No REST call.
 */

import { useEffect, useRef, useState } from "react";
import { eventBus } from "../lib/eventBus";
import { sessionCpuPercent } from "../lib/machine";
import {
  EMPTY_SESSION_CPU_TRACK,
  displayedSessionCpu,
  trackSessionCpu,
  type SessionCpuTrack,
} from "../lib/sessionCpu";
import type { MachineSamplePayload, WSMessage } from "../lib/types";

export function useSessionCpu(sessionId: string): number | null {
  const [value, setValue] = useState<number | null>(null);
  const track = useRef<SessionCpuTrack>(EMPTY_SESSION_CPU_TRACK);

  useEffect(() => {
    track.current = EMPTY_SESSION_CPU_TRACK;
    setValue(null);
    const unsubscribe = eventBus.subscribe((msg: WSMessage) => {
      if (msg.type !== "machine.sample") return;
      const processes = (msg.data as MachineSamplePayload)?.processes ?? null;
      track.current = trackSessionCpu(track.current, {
        ts: processes?.ts ?? Date.now(),
        value: sessionCpuPercent(processes, sessionId),
      });
      // Same primitive value → React skips the re-render.
      setValue(displayedSessionCpu(track.current));
    });
    const offConnection = eventBus.onConnection((connected: boolean) => {
      if (connected) return;
      track.current = EMPTY_SESSION_CPU_TRACK;
      setValue(null);
    });
    return () => {
      unsubscribe();
      offConnection();
    };
  }, [sessionId]);

  return value;
}
