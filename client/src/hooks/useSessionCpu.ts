/**
 * @file useSessionCpu.ts
 * @description Live value of one session's CPU tag: the session's share from the
 * `cpuBySession` map of each `machine.sample` WebSocket message (already smoothed by
 * the server), or null while the tag should stay hidden (`lib/sessionCpu`), before the
 * first reading and after the WebSocket disconnects, so a card never shows a stale
 * value. Re-renders only when the displayed value changes. No REST call.
 */

import { useEffect, useRef, useState } from "react";
import { eventBus } from "../lib/eventBus";
import { sessionCpuPercent } from "../lib/machine";
import { sessionCpuVisible } from "../lib/sessionCpu";
import type { MachineSamplePayload, WSMessage } from "../lib/types";

export function useSessionCpu(sessionId: string): number | null {
  const [value, setValue] = useState<number | null>(null);
  const shown = useRef(false);

  useEffect(() => {
    shown.current = false;
    setValue(null);
    const unsubscribe = eventBus.subscribe((msg: WSMessage) => {
      if (msg.type !== "machine.sample") return;
      const reading = sessionCpuPercent(
        (msg.data as MachineSamplePayload)?.processes ?? null,
        sessionId
      );
      shown.current = sessionCpuVisible(shown.current, reading);
      // Same primitive value → React skips the re-render.
      setValue(shown.current ? reading : null);
    });
    const offConnection = eventBus.onConnection((connected: boolean) => {
      if (connected) return;
      shown.current = false;
      setValue(null);
    });
    return () => {
      unsubscribe();
      offConnection();
    };
  }, [sessionId]);

  return value;
}
