/**
 * @file useLatestMachineSample.ts
 * @description Lightweight React hook for the dashboard's machine-metrics pill:
 * keeps only the latest `machine.sample` WebSocket payload (sample + sensor
 * status) and forgets it when the WebSocket disconnects, so the pill never shows
 * stale readings. No REST call and no history — the Machine tab owns those.
 */

import { useEffect, useState } from "react";
import { eventBus } from "../lib/eventBus";
import type { MachineSample, MachineSamplePayload, MachineStatus, WSMessage } from "../lib/types";

export interface LatestMachineSample {
  sample: MachineSample;
  status: MachineStatus | null;
}

export function useLatestMachineSample(): LatestMachineSample | null {
  const [latest, setLatest] = useState<LatestMachineSample | null>(null);

  useEffect(() => {
    const unsubscribe = eventBus.subscribe((msg: WSMessage) => {
      if (msg.type !== "machine.sample") return;
      const data = msg.data as MachineSamplePayload;
      if (!data?.sample) return;
      setLatest((prev) =>
        prev && data.sample.ts <= prev.sample.ts
          ? prev
          : { sample: data.sample, status: data.status ?? null }
      );
    });
    const offConnection = eventBus.onConnection((connected: boolean) => {
      if (!connected) setLatest(null);
    });
    return () => {
      unsubscribe();
      offConnection();
    };
  }, []);

  return latest;
}
