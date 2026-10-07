/**
 * @file MachineView.test.tsx
 * @description Renders the Machine tab body from fixed host samples: metric tabs
 * (values, threshold colours, GPU only when present, selection), the big chart,
 * the top-process list (8 rows, CPU / RAM sort, claude badge), the sensor status
 * banner, and checks the Machine-mode strings exist in French and English.
 */

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import i18n from "i18next";
import { MachineView } from "../MachineView";
import type { MachineMetricsState } from "../../../hooks/useMachineMetrics";
import type { MachineProcess, MachineSample } from "../../../lib/types";
import type { MachineMetric, ProcessSort } from "../../../lib/machine";

const T0 = 1_791_364_000_000;

function sample(i: number, over: Partial<MachineSample> = {}): MachineSample {
  return {
    ts: T0 + i * 2000,
    cpu: { percent: 20 + i, source: "cim" },
    ram: { usedBytes: 17e9, totalBytes: 34e9, percent: 50 },
    disk: { activePercent: 5, readBytesPerSec: 0, writeBytesPerSec: 2048 },
    volume: { path: "C:\\", usedBytes: 3e11, totalBytes: 1e12, percent: 30 },
    gpu: null,
    ...over,
  };
}

const proc = (
  name: string,
  cpuPercent: number,
  memoryBytes: number,
  pid: number
): MachineProcess => ({
  name,
  pid,
  parentPid: 1,
  cpuPercent,
  memoryBytes,
});

const PROCESSES = [
  proc("chrome", 12, 900e6, 10),
  proc("claude", 4.2, 412e6, 11),
  proc("node", 3, 1500e6, 12),
  proc("explorer", 1, 100e6, 13),
  proc("code", 2, 800e6, 14),
  proc("svchost", 0.5, 50e6, 15),
  proc("claude", 1.1, 300e6, 16),
  proc("pwsh", 0.2, 60e6, 17),
  proc("dwm", 0.8, 120e6, 18),
  proc("idle-ish", 0.1, 10e6, 19),
];

function state(over: Partial<MachineMetricsState> = {}): MachineMetricsState {
  const samples = [sample(0), sample(1), sample(2)];
  return {
    loading: false,
    error: false,
    status: { sensor: "ok", gpu: "absent", sensorError: null, retryInMs: null },
    cores: 12,
    windowMs: 300_000,
    samples,
    processes: { ts: T0 + 4000, cores: 12, items: PROCESSES },
    claudeCpu: [
      { ts: T0, value: 4 },
      { ts: T0 + 4000, value: 5.3 },
    ],
    ...over,
  };
}

function renderView(
  s: MachineMetricsState,
  opts: { selected?: MachineMetric; sort?: ProcessSort } = {}
) {
  const onSelect = vi.fn();
  const onSortChange = vi.fn();
  render(
    <MachineView
      state={s}
      selected={opts.selected ?? "cpu"}
      onSelect={onSelect}
      sort={opts.sort ?? "cpu"}
      onSortChange={onSortChange}
    />
  );
  return { onSelect, onSortChange };
}

describe("MachineView", () => {
  it("renders one tab per metric with its live value, without GPU when absent", () => {
    renderView(state());
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      expect.stringContaining("CPU"),
      expect.stringContaining("RAM"),
      expect.stringContaining("Disk"),
      expect.stringContaining("Processes"),
    ]);
    expect(screen.getByTestId("machine-value-cpu")).toHaveTextContent("22%");
    expect(screen.getByTestId("machine-value-ram")).toHaveTextContent("50%");
    expect(screen.getByTestId("machine-value-disk")).toHaveTextContent("5%");
    expect(screen.getByTestId("machine-value-processes")).toHaveTextContent("5.3%");
    expect(screen.queryByTestId("machine-tab-gpu")).not.toBeInTheDocument();
    expect(screen.getByTestId("machine-tab-cpu")).toHaveAttribute("aria-selected", "true");
  });

  it("colours each value by its threshold", () => {
    renderView(
      state({
        samples: [
          sample(0, {
            cpu: { percent: 75, source: "cim" },
            ram: { usedBytes: 1, totalBytes: 1, percent: 93 },
            disk: { activePercent: 10, readBytesPerSec: 0, writeBytesPerSec: 0 },
          }),
        ],
      })
    );
    const cpu = screen.getByTestId("machine-value-cpu");
    expect(cpu).toHaveAttribute("data-level", "warn");
    expect(cpu).toHaveClass("text-orange-300");
    const ram = screen.getByTestId("machine-value-ram");
    expect(ram).toHaveAttribute("data-level", "crit");
    expect(ram).toHaveClass("text-red-400");
    expect(screen.getByTestId("machine-value-disk")).toHaveAttribute("data-level", "normal");
  });

  it("shows the GPU tab with load and a temperature coloured by its threshold", () => {
    const gpu = {
      index: 0,
      utilPercent: 39,
      memUsedMiB: 1024,
      memTotalMiB: 4096,
      memPercent: 25,
      temperatureC: 78,
      lowPower: false,
    };
    renderView(state({ samples: [sample(0, { gpu }), sample(1, { gpu })] }), { selected: "gpu" });
    expect(screen.getByTestId("machine-value-gpu")).toHaveTextContent("39%");
    const temp = screen.getByTestId("machine-value-gpu-temp");
    expect(temp).toHaveTextContent("78");
    expect(temp).toHaveAttribute("data-level", "warn");
    expect(screen.getByTestId("machine-chart-temperature")).toBeInTheDocument();
    expect(screen.getByTestId("machine-details")).toHaveTextContent("Memory 1 GB / 4 GB");
  });

  it("draws the big chart of the selected metric and reports tab clicks", () => {
    const { onSelect } = renderView(state(), { selected: "ram" });
    expect(screen.getByRole("heading", { name: "RAM — last 5 minutes" })).toBeInTheDocument();
    expect(screen.getByTestId("machine-chart-line").getAttribute("d")).toMatch(/^M/);
    fireEvent.click(screen.getByTestId("machine-tab-disk"));
    expect(onSelect).toHaveBeenCalledWith("disk");
  });

  it("lists the 8 heaviest processes by CPU and badges claude", () => {
    renderView(state());
    const rows = screen.getAllByTestId("machine-process-row");
    expect(rows).toHaveLength(8);
    expect(rows.map((r) => within(r).getAllByRole("cell")[0]!.textContent)).toEqual([
      "chrome",
      "claudeclaude",
      "node",
      "code",
      "claudeclaude",
      "explorer",
      "dwm",
      "svchost",
    ]);
    expect(rows.filter((r) => r.hasAttribute("data-claude"))).toHaveLength(2);
  });

  it("sorts by RAM and reports header clicks", () => {
    const { onSortChange } = renderView(state(), { sort: "ram" });
    const rows = screen.getAllByTestId("machine-process-row");
    expect(within(rows[0]!).getAllByRole("cell")[0]).toHaveTextContent("node");
    fireEvent.click(screen.getByRole("button", { name: /CPU/ }));
    expect(onSortChange).toHaveBeenCalledWith("cpu");
  });

  it("explains an unavailable sensor", () => {
    renderView(
      state({
        status: { sensor: "unavailable", gpu: "absent", sensorError: "exit 1", retryInMs: 8000 },
        processes: null,
      })
    );
    expect(screen.getByTestId("machine-status")).toHaveTextContent(
      "Sensor unavailable — retrying in 8 s"
    );
    expect(screen.getByText("No process data from the sensor")).toBeInTheDocument();
  });

  it("shows an empty chart state before any reading", () => {
    renderView(state({ samples: [], processes: null, claudeCpu: [] }));
    expect(screen.getByText("No readings yet")).toBeInTheDocument();
    expect(screen.getByTestId("machine-value-cpu")).toHaveTextContent("—");
  });

  it("renders in French", async () => {
    await i18n.changeLanguage("fr");
    renderView(state(), { selected: "disk" });
    expect(
      screen.getByRole("heading", { name: "Disque — 5 dernières minutes" })
    ).toBeInTheDocument();
    expect(screen.getByText("Processus les plus gourmands")).toBeInTheDocument();
    // French percent formatting uses a (narrow) no-break space before %.
    expect(screen.getByTestId("machine-value-cpu").textContent).toMatch(/^22\s%$/);
  });
});

describe("Machine-mode translations", () => {
  const flatten = (value: unknown, prefix = ""): Record<string, unknown> =>
    value && typeof value === "object"
      ? Object.entries(value).reduce(
          (acc, [k, v]) => ({ ...acc, ...flatten(v, prefix ? `${prefix}.${k}` : k) }),
          {} as Record<string, unknown>
        )
      : { [prefix]: value };

  it("exist in French and English with non-empty strings", () => {
    const en = flatten(i18n.getResource("en", "dashboard", "machine"));
    const fr = flatten(i18n.getResource("fr", "dashboard", "machine"));
    expect(Object.keys(en).length).toBeGreaterThan(20);
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
    for (const value of [...Object.values(en), ...Object.values(fr)]) {
      expect(typeof value === "string" && value.length > 0).toBe(true);
    }
    expect(i18n.getResource("en", "dashboard", "tabs.machine")).toBe("Machine");
    expect(i18n.getResource("fr", "dashboard", "tabs.machine")).toBe("Machine");
    expect(fr["metrics.disk"]).toBe("Disque");
  });
});
