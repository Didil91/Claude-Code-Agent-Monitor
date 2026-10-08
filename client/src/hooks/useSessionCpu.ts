/**
 * @file useSessionCpu.ts
 * @description Live CPU share of one session's claude process and everything it
 * spawned, read from the `cpuBySession` map of each `machine.sample` WebSocket
 * message. Null until the server has a reading for the session, and again when the
 * WebSocket disconnects so a card never shows a stale value. No REST call: the first
 * value arrives with the next sample (every 2 s).
 */

import { useEffect, useState } from "react";
import { eventBus } from "../lib/eventBus";
import { sessionCpuPercent } from "../lib/machine";
import type { MachineSamplePayload, WSMessage } from "../lib/types";

export function useSessionCpu(sessionId: string): number | null {
  const [value, setValue] = useState<number | null>(null);

  useEffect(() => {
    setValue(null);
    const unsubscribe = eventBus.subscribe((msg: WSMessage) => {
      if (msg.type !== "machine.sample") return;
      const data = msg.data as MachineSamplePayload;
      // Same primitive value → React skips the re-render.
      setValue(sessionCpuPercent(data?.processes ?? null, sessionId));
    });
    const offConnection = eventBus.onConnection((connected: boolean) => {
      if (!connected) setValue(null);
    });
    return () => {
      unsubscribe();
      offConnection();
    };
  }, [sessionId]);

  return value;
}
