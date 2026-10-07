/**
 * @file useMachineMetrics.ts
 * @description React hook feeding the Machine mode: loads the 5-minute window
 * from `GET /api/machine`, then appends every `machine.sample` WebSocket message,
 * keeps the latest top-process snapshot and sensor status, and builds the
 * client-side history of the `claude` processes' CPU share (the server keeps no
 * process history, so that curve starts when the hook mounts).
 */

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { eventBus } from "../lib/eventBus";
import {
  appendToWindow,
  claudeCpuPercent,
  MACHINE_WINDOW_MS,
  type SeriesPoint,
} from "../lib/machine";
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
  /** Summed CPU % of `claude` processes, one point per process snapshot. */
  claudeCpu: SeriesPoint[];
}

const INITIAL: MachineMetricsState = {
  loading: true,
  error: false,
  status: null,
  cores: null,
  windowMs: MACHINE_WINDOW_MS,
  samples: [],
  processes: null,
  claudeCpu: [],
};

function withProcesses(
  state: MachineMetricsState,
  processes: MachineProcesses | null
): MachineMetricsState {
  if (!processes) return { ...state, processes: null };
  const value = claudeCpuPercent(processes) ?? 0;
  return {
    ...state,
    processes,
    claudeCpu: appendToWindow(state.claudeCpu, { ts: processes.ts, value }, state.windowMs),
  };
}

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
          return prev.processes ? next : withProcesses(next, snap.processes);
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
        if (data.processes?.ts === prev.processes?.ts && data.processes) return next;
        return withProcesses(next, data.processes ?? null);
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return state;
}
