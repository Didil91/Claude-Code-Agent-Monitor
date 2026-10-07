/**
 * @file machine.test.ts
 * @description Unit tests for the Machine-mode thresholds (orange / red level per
 * metric and its text colour) and the pure helpers in `lib/machine.ts`: claude
 * process detection, top-process sorting, metric levels and rolling-window upkeep.
 */

import { describe, it, expect } from "vitest";
import {
  LEVEL_TEXT_CLASS,
  MACHINE_THRESHOLDS,
  thresholdLevel,
  worstLevel,
} from "../machineThresholds";
import {
  appendToWindow,
  claudeCpuPercent,
  isClaudeProcess,
  metricLevel,
  topProcesses,
} from "../machine";
import type { MachineProcess, MachineSample } from "../types";

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

describe("machine thresholds", () => {
  it("uses the spec defaults", () => {
    expect(MACHINE_THRESHOLDS).toEqual({
      cpu: { warn: 70, crit: 90 },
      ram: { warn: 80, crit: 92 },
      disk: { warn: 80, crit: 95 },
      gpuTemp: { warn: 75, crit: 85 },
    });
  });

  it.each([
    ["cpu", 69.9, "normal"],
    ["cpu", 70, "warn"],
    ["cpu", 90, "crit"],
    ["ram", 79, "normal"],
    ["ram", 80, "warn"],
    ["ram", 92, "crit"],
    ["disk", 94.9, "warn"],
    ["disk", 95, "crit"],
    ["gpuTemp", 74, "normal"],
    ["gpuTemp", 75, "warn"],
    ["gpuTemp", 85, "crit"],
  ] as const)("%s at %s is %s", (metric, value, level) => {
    expect(thresholdLevel(metric, value)).toBe(level);
  });

  it("treats missing readings as normal", () => {
    expect(thresholdLevel("cpu", null)).toBe("normal");
    expect(thresholdLevel("ram", undefined)).toBe("normal");
    expect(thresholdLevel("disk", Number.NaN)).toBe("normal");
  });

  it("maps levels to orange / red theme classes", () => {
    expect(LEVEL_TEXT_CLASS.warn).toBe("text-orange-300");
    expect(LEVEL_TEXT_CLASS.crit).toBe("text-red-400");
    expect(worstLevel("normal", "warn", "crit")).toBe("crit");
    expect(worstLevel("normal", "warn")).toBe("warn");
  });
});

describe("machine helpers", () => {
  it("detects claude processes", () => {
    expect(isClaudeProcess("claude")).toBe(true);
    expect(isClaudeProcess("Claude.exe")).toBe(true);
    expect(isClaudeProcess("claude-helper")).toBe(false);
  });

  it("sums the CPU of claude processes", () => {
    const items = [proc("claude", 2.5, 1, 1), proc("claude", 1.5, 1, 2), proc("node", 9, 1, 3)];
    expect(claudeCpuPercent({ ts: 1, cores: 8, items })).toBe(4);
    expect(claudeCpuPercent(null)).toBeNull();
  });

  it("keeps the top 8 by CPU or by RAM", () => {
    const items = Array.from({ length: 12 }, (_, i) => proc(`p${i}`, i, (12 - i) * 1000, i));
    expect(topProcesses(items, "cpu").map((p) => p.name)).toEqual([
      "p11",
      "p10",
      "p9",
      "p8",
      "p7",
      "p6",
      "p5",
      "p4",
    ]);
    expect(topProcesses(items, "ram").map((p) => p.name)).toEqual([
      "p0",
      "p1",
      "p2",
      "p3",
      "p4",
      "p5",
      "p6",
      "p7",
    ]);
  });

  it("judges the GPU on temperature and processes on CPU thresholds", () => {
    const sample: MachineSample = {
      ts: 1,
      cpu: { percent: 10, source: "cim" },
      ram: null,
      disk: null,
      volume: null,
      gpu: {
        index: 0,
        utilPercent: 99,
        memUsedMiB: 1,
        memTotalMiB: 2,
        memPercent: 50,
        temperatureC: 86,
        lowPower: false,
      },
    };
    expect(metricLevel("gpu", sample)).toBe("crit");
    expect(metricLevel("cpu", sample)).toBe("normal");
    expect(metricLevel("processes", sample, 72)).toBe("warn");
  });

  it("trims the rolling window and ignores stale samples", () => {
    let list = [{ ts: 0 }, { ts: 1000 }];
    list = appendToWindow(list, { ts: 1000 }, 5000);
    expect(list).toHaveLength(2);
    list = appendToWindow(list, { ts: 5500 }, 5000);
    expect(list.map((x) => x.ts)).toEqual([1000, 5500]);
  });
});
