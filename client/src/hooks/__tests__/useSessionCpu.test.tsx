/**
 * @file useSessionCpu.test.tsx
 * @description Tests the per-session CPU hook wiring: null until a `machine.sample`
 * carries a busy-enough reading for the session, smoothed over new process snapshots
 * only, ignores other sessions and message types, and resets on WebSocket disconnect
 * or when the session id changes. Smoothing rules themselves: `lib/sessionCpu`.
 */

import { describe, it, expect, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { eventBus } from "../../lib/eventBus";
import { useSessionCpu } from "../useSessionCpu";
import type { WSMessage } from "../../lib/types";

let nextTs = 1;

/** A `machine.sample` carrying a new process snapshot (unless `ts` is given). */
const sampleWith = (
  cpuBySession: Record<string, number>,
  { ts = nextTs++, type = "machine.sample" }: { ts?: number; type?: WSMessage["type"] } = {}
) =>
  ({
    type,
    data: {
      sample: { ts, cpu: null, ram: null, disk: null, volume: null, gpu: null },
      processes: { ts, cores: 8, items: [], cpuBySession },
      status: null,
    },
    timestamp: "",
  }) as unknown as WSMessage;

describe("useSessionCpu", () => {
  afterEach(() => {
    act(() => eventBus.setConnected(true));
  });

  it("stays null for an idle or unknown session", () => {
    const { result } = renderHook(() => useSessionCpu("s1"));
    act(() => eventBus.publish(sampleWith({ other: 50 })));
    act(() => eventBus.publish(sampleWith({ s1: 0.2 })));
    expect(result.current).toBeNull();
  });

  it("shows the average of new snapshots, ignoring repeats of the same one", () => {
    const { result } = renderHook(() => useSessionCpu("s1"));
    act(() => eventBus.publish(sampleWith({ s1: 4 }, { ts: 100 })));
    expect(result.current).toBe(4);
    act(() => eventBus.publish(sampleWith({ s1: 90 }, { ts: 100 }))); // same snapshot
    expect(result.current).toBe(4);
    act(() => eventBus.publish(sampleWith({ s1: 8 }, { ts: 101 })));
    expect(result.current).toBe(6);
  });

  it("ignores other message types", () => {
    const { result } = renderHook(() => useSessionCpu("s1"));
    act(() => eventBus.publish(sampleWith({ s1: 9 }, { type: "agent_updated" })));
    expect(result.current).toBeNull();
  });

  it("resets on disconnect and when the session changes", () => {
    const { result, rerender } = renderHook(({ id }) => useSessionCpu(id), {
      initialProps: { id: "s1" },
    });
    act(() => eventBus.publish(sampleWith({ s1: 3, s2: 8 })));
    expect(result.current).toBe(3);

    act(() => eventBus.setConnected(false));
    expect(result.current).toBeNull();

    rerender({ id: "s2" });
    expect(result.current).toBeNull();
    act(() => eventBus.publish(sampleWith({ s1: 3, s2: 8 })));
    expect(result.current).toBe(8);
  });
});
