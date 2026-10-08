/**
 * @file useMachineMetrics.test.tsx
 * @description Tests the Machine-mode data hook: it seeds from `GET /api/machine`,
 * appends live `machine.sample` WebSocket messages, ignores other message types,
 * keeps the latest process snapshot, and flags a failed load.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { eventBus } from "../../lib/eventBus";
import { api } from "../../lib/api";
import { useMachineMetrics } from "../useMachineMetrics";
import type { MachineSample, MachineSnapshot, MachineStatus, WSMessage } from "../../lib/types";

const STATUS: MachineStatus = { sensor: "ok", gpu: "absent", sensorError: null, retryInMs: null };

const sample = (ts: number, cpu: number): MachineSample => ({
  ts,
  cpu: { percent: cpu, source: "cim" },
  ram: null,
  disk: null,
  volume: null,
  gpu: null,
});

const snapshot: MachineSnapshot = {
  platform: "win32",
  cores: 8,
  intervalMs: 2000,
  processIntervalMs: 5000,
  windowMs: 300_000,
  status: STATUS,
  samples: [sample(1000, 10), sample(3000, 12)],
  processes: {
    ts: 2000,
    cores: 8,
    items: [{ name: "claude", pid: 1, parentPid: 0, cpuPercent: 3, memoryBytes: 1 }],
  },
};

const message = (data: unknown, type: WSMessage["type"] = "machine.sample") =>
  ({ type, data, timestamp: "" }) as WSMessage;

describe("useMachineMetrics", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("seeds from the REST snapshot then appends live samples", async () => {
    vi.spyOn(api.machine, "get").mockResolvedValue(snapshot);
    const { result } = renderHook(() => useMachineMetrics());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.samples.map((s) => s.ts)).toEqual([1000, 3000]);
    expect(result.current.processes?.ts).toBe(2000);
    expect(result.current.cores).toBe(8);

    act(() => {
      eventBus.publish(
        message({ sample: sample(5000, 40), processes: snapshot.processes, status: STATUS })
      );
      eventBus.publish(message({ id: "x" }, "session_updated"));
    });
    expect(result.current.samples.map((s) => s.ts)).toEqual([1000, 3000, 5000]);

    act(() => {
      eventBus.publish(
        message({
          sample: sample(7000, 41),
          processes: {
            ts: 7000,
            cores: 8,
            items: [
              { name: "claude", pid: 1, parentPid: 0, cpuPercent: 2, memoryBytes: 1 },
              { name: "claude.exe", pid: 2, parentPid: 0, cpuPercent: 1.5, memoryBytes: 1 },
            ],
          },
          status: STATUS,
        })
      );
    });
    expect(result.current.processes?.ts).toBe(7000);
  });

  it("flags a failed load", async () => {
    vi.spyOn(api.machine, "get").mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useMachineMetrics());
    await waitFor(() => expect(result.current.error).toBe(true));
  });
});
