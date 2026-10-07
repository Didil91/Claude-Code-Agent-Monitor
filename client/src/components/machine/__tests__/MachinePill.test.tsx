/**
 * @file MachinePill.test.tsx
 * @description Tests the dashboard machine-metrics pill: threshold colours per
 * reading, GPU omitted when absent, pill hidden while the sensor is unavailable,
 * click opening the Machine tab, live updates from `machine.sample` messages and
 * reset on WebSocket disconnect, and the French / English strings.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import i18n from "i18next";
import { MachinePill, MachinePillView } from "../MachinePill";
import { eventBus } from "../../../lib/eventBus";
import type { LatestMachineSample } from "../../../hooks/useLatestMachineSample";
import type { MachineSample, MachineStatus, WSMessage } from "../../../lib/types";

const STATUS: MachineStatus = { sensor: "ok", gpu: "ok", sensorError: null, retryInMs: null };

function sample(over: Partial<MachineSample> = {}): MachineSample {
  return {
    ts: 1000,
    cpu: { percent: 20, source: "cim" },
    ram: { usedBytes: 17e9, totalBytes: 34e9, percent: 51 },
    disk: { activePercent: 2, readBytesPerSec: 0, writeBytesPerSec: 0 },
    volume: null,
    gpu: {
      index: 0,
      utilPercent: 39,
      memUsedMiB: 1000,
      memTotalMiB: 8000,
      memPercent: 12.5,
      temperatureC: 49,
      lowPower: false,
    },
    ...over,
  };
}

const latest = (
  over: Partial<MachineSample> = {},
  status: MachineStatus | null = STATUS
): LatestMachineSample => ({ sample: sample(over), status });

const levelOf = (metric: string) =>
  screen.getByTestId(`machine-pill-${metric}`).querySelector("[data-level]:last-child")!;

describe("MachinePillView", () => {
  it("shows every reading with neutral colours under the thresholds", () => {
    render(<MachinePillView latest={latest()} onOpen={() => {}} />);
    const pill = screen.getByTestId("machine-pill");
    expect(pill.textContent).toMatch(/CPU\s*20\s?%/);
    expect(pill.textContent).toMatch(/RAM\s*51\s?%/);
    expect(pill.textContent).toMatch(/39\s?%·49\s?°C/);
    for (const m of ["cpu", "ram", "disk", "gpu"]) {
      expect(levelOf(m).getAttribute("data-level")).toBe("normal");
      expect(levelOf(m).className).toContain("text-gray-100");
    }
  });

  it("turns orange then red above the shared thresholds", () => {
    render(
      <MachinePillView
        latest={latest({
          cpu: { percent: 75, source: "cim" },
          ram: { usedBytes: 1, totalBytes: 1, percent: 95 },
          disk: { activePercent: 85, readBytesPerSec: 0, writeBytesPerSec: 0 },
          gpu: { ...sample().gpu!, temperatureC: 86 },
        })}
        onOpen={() => {}}
      />
    );
    expect(levelOf("cpu").getAttribute("data-level")).toBe("warn");
    expect(levelOf("cpu").className).toContain("text-orange-300");
    expect(levelOf("ram").getAttribute("data-level")).toBe("crit");
    expect(levelOf("ram").className).toContain("text-red-400");
    expect(levelOf("disk").getAttribute("data-level")).toBe("warn");
    // GPU is judged on temperature, like the Machine tab.
    expect(levelOf("gpu").getAttribute("data-level")).toBe("crit");
  });

  it("omits the GPU when the server reports none", () => {
    render(<MachinePillView latest={latest({ gpu: null })} onOpen={() => {}} />);
    expect(screen.getByTestId("machine-pill-cpu")).toBeTruthy();
    expect(screen.queryByTestId("machine-pill-gpu")).toBeNull();
  });

  it("omits missing readings such as the disk off Windows", () => {
    render(<MachinePillView latest={latest({ disk: null })} onOpen={() => {}} />);
    expect(screen.queryByTestId("machine-pill-disk")).toBeNull();
    expect(screen.getByTestId("machine-pill-ram")).toBeTruthy();
  });

  it("is hidden without data or while the sensor is unavailable or disabled", () => {
    const { rerender } = render(<MachinePillView latest={null} onOpen={() => {}} />);
    expect(screen.queryByTestId("machine-pill")).toBeNull();
    rerender(
      <MachinePillView
        latest={latest({}, { ...STATUS, sensor: "unavailable", retryInMs: 5000 })}
        onOpen={() => {}}
      />
    );
    expect(screen.queryByTestId("machine-pill")).toBeNull();
    rerender(
      <MachinePillView latest={latest({}, { ...STATUS, sensor: "disabled" })} onOpen={() => {}} />
    );
    expect(screen.queryByTestId("machine-pill")).toBeNull();
  });

  it("hides readings progressively on narrow screens", () => {
    render(<MachinePillView latest={latest()} onOpen={() => {}} />);
    expect(screen.getByTestId("machine-pill-cpu").className).not.toContain("hidden");
    expect(screen.getByTestId("machine-pill-ram").className).toContain("hidden sm:inline-flex");
    expect(screen.getByTestId("machine-pill-disk").className).toContain("hidden md:inline-flex");
    expect(screen.getByTestId("machine-pill-gpu").className).toContain("hidden lg:inline-flex");
  });

  it("opens the Machine tab on click", () => {
    const onOpen = vi.fn();
    render(<MachinePillView latest={latest()} onOpen={onOpen} />);
    fireEvent.click(screen.getByTestId("machine-pill"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("has its strings in French and English", () => {
    for (const lng of ["fr", "en"]) {
      expect(i18n.exists("dashboard:machine.pill.open", { lng })).toBe(true);
    }
    expect(i18n.getFixedT("fr", "dashboard")("machine.pill.open")).toContain("Machine");
  });
});

describe("MachinePill (live)", () => {
  afterEach(() => {
    act(() => eventBus.setConnected(false));
  });

  const message = (s: MachineSample): WSMessage =>
    ({
      type: "machine.sample",
      data: { sample: s, processes: null, status: STATUS },
      timestamp: "",
    }) as WSMessage;

  it("follows machine.sample messages and clears on disconnect", () => {
    render(<MachinePill onOpen={() => {}} />);
    expect(screen.queryByTestId("machine-pill")).toBeNull();

    act(() => eventBus.publish(message(sample({ ts: 1000 }))));
    expect(screen.getByTestId("machine-pill-cpu").textContent).toMatch(/20/);

    act(() => eventBus.publish(message(sample({ ts: 3000, cpu: { percent: 92, source: "cim" } }))));
    expect(screen.getByTestId("machine-pill-cpu").textContent).toMatch(/92/);
    expect(levelOf("cpu").getAttribute("data-level")).toBe("crit");

    // An out-of-order older sample is ignored.
    act(() => eventBus.publish(message(sample({ ts: 2000 }))));
    expect(screen.getByTestId("machine-pill-cpu").textContent).toMatch(/92/);

    act(() => eventBus.setConnected(false));
    expect(screen.queryByTestId("machine-pill")).toBeNull();
  });
});
