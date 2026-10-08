/**
 * @file useMachineMetrics.ts
 * @description React hook feeding the Machine mode: loads the 5-minute window
 * from `GET /api/machine`, then appends every `machine.sample` WebSocket message,
 * and keeps the latest top-process snapshot and sensor status. Every metric's history,
 * claude + its commands included (`sample.claudeCpu`), comes from the server window.
 */

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { eventBus } from "../lib/eventBus";
import { appendToWindow, MACHINE_WINDOW_MS } from "../lib/machine";
import type {
  MachineProcesses,
  MachineSample,
  MachineSamplePayload,
  MachineStatus,
  WSMessage,
} from "../lib/types";

export interface MachineMetricsState {
  /** True until the first snapshot (REST or WebSocket) arrived. */
  loading: boolean;
  /** True when `GET /api/machine` failed and no live sample came in since. */
  error: boolean;
  status: MachineStatus | null;
  cores: number | null;
  windowMs: number;
  samples: MachineSample[];
  processes: MachineProcesses | null;
}

const INITIAL: MachineMetricsState = {
  loading: true,
  error: false,
  status: null,
  cores: null,
  windowMs: MACHINE_WINDOW_MS,
  samples: [],
  processes: null,
};

export function useMachineMetrics(): MachineMetricsState {
  const [state, setState] = useState<MachineMetricsState>(INITIAL);

  useEffect(() => {
    let cancelled = false;

    api.machine
      .get()
      .then((snap) => {
        if (cancelled) return;
        setState((prev) => {
          // Live samples may already have arrived; keep whichever is newer.
          let samples = snap.samples;
          for (const s of prev.samples) samples = appendToWindow(samples, s, snap.windowMs);
          const next: MachineMetricsState = {
            ...prev,
            loading: false,
            error: false,
            status: prev.samples.length ? prev.status : snap.status,
            cores: snap.cores,
            windowMs: snap.windowMs,
            samples,
          };
          return prev.processes ? next : { ...next, processes: snap.processes };
        });
      })
      .catch(() => {
        if (!cancelled)
          setState((prev) => ({ ...prev, loading: false, error: prev.samples.length === 0 }));
      });

    const unsubscribe = eventBus.subscribe((msg: WSMessage) => {
      if (msg.type !== "machine.sample") return;
      const data = msg.data as MachineSamplePayload;
      if (!data?.sample) return;
      setState((prev) => {
        const next: MachineMetricsState = {
          ...prev,
          loading: false,
          error: false,
          status: data.status ?? prev.status,
          samples: appendToWindow(prev.samples, data.sample, prev.windowMs),
        };
        return { ...next, processes: data.processes ?? null };
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return state;
}
