/**
 * @file useSessionCpu.test.tsx
 * @description Tests the per-session CPU hook: null until a `machine.sample` carries
 * a reading for the session, follows later samples, ignores other sessions and message
 * types, and resets on WebSocket disconnect or when the session id changes.
 */

import { describe, it, expect, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { eventBus } from "../../lib/eventBus";
import { useSessionCpu } from "../useSessionCpu";
import type { WSMessage } from "../../lib/types";

const sampleWith = (
  cpuBySession: Record<string, number>,
  type: WSMessage["type"] = "machine.sample"
) =>
  ({
    type,
    data: {
      sample: { ts: 1, cpu: null, ram: null, disk: null, volume: null, gpu: null },
      processes: { ts: 1, cores: 8, items: [], cpuBySession },
      status: null,
    },
    timestamp: "",
  }) as unknown as WSMessage;

describe("useSessionCpu", () => {
  afterEach(() => {
    act(() => eventBus.setConnected(true));
  });

  it("is null until a sample carries the session, then follows it", () => {
    const { result } = renderHook(() => useSessionCpu("s1"));
    expect(result.current).toBeNull();

    act(() => eventBus.publish(sampleWith({ other: 50 })));
    expect(result.current).toBeNull();

    act(() => eventBus.publish(sampleWith({ s1: 4.2 })));
    expect(result.current).toBe(4.2);

    act(() => eventBus.publish(sampleWith({ s1: 12 })));
    expect(result.current).toBe(12);

    act(() => eventBus.publish(sampleWith({})));
    expect(result.current).toBeNull();
  });

  it("ignores other message types", () => {
    const { result } = renderHook(() => useSessionCpu("s1"));
    act(() => eventBus.publish(sampleWith({ s1: 9 }, "agent_updated")));
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

    act(() => eventBus.publish(sampleWith({ s1: 3, s2: 8 })));
    rerender({ id: "s2" });
    expect(result.current).toBeNull();
    act(() => eventBus.publish(sampleWith({ s1: 3, s2: 8 })));
    expect(result.current).toBe(8);
  });
});
