/**
 * @file braiseState.test.ts
 * @description Unit tests for Braise's pure logic: the four looks chosen from
 * the Machine-mode thresholds, the red-zone reading named by the alert bubble,
 * the heaviest process, and the default dock that keeps clear of Tabby.
 */

import { describe, it, expect } from "vitest";
import {
  braiseAlert,
  braiseState,
  heaviestProcess,
  latestSample,
  BRAISE_IDLE_CPU,
} from "../braiseState";
import { defaultBraisePos } from "../prefs";
import type { MachineSample } from "../../../lib/types";

function sample(
  over: { cpu?: number; ram?: number; disk?: number; gpuTemp?: number | null } = {}
): MachineSample {
  return {
    ts: 1,
    cpu: over.cpu == null ? null : { percent: over.cpu, source: "cim" },
    ram: over.ram == null ? null : { usedBytes: 1, totalBytes: 2, percent: over.ram },
    disk:
      over.disk == null
        ? null
        : { activePercent: over.disk, readBytesPerSec: 0, writeBytesPerSec: 0 },
    volume: null,
    gpu:
      over.gpuTemp === undefined
        ? null
        : {
            index: 0,
            utilPercent: 30,
            memUsedMiB: null,
            memTotalMiB: null,
            memPercent: null,
            temperatureC: over.gpuTemp,
            lowPower: false,
          },
  };
}

describe("braiseState", () => {
  it("dozes below the idle CPU bound or without data", () => {
    expect(braiseState(null)).toBe("idle");
    expect(braiseState(sample())).toBe("idle");
    expect(braiseState(sample({ cpu: BRAISE_IDLE_CPU - 0.1, ram: 50 }))).toBe("idle");
  });

  it("is a calm flame under every threshold", () => {
    expect(braiseState(sample({ cpu: BRAISE_IDLE_CPU }))).toBe("normal");
    expect(braiseState(sample({ cpu: 69, ram: 79, disk: 79, gpuTemp: 74 }))).toBe("normal");
  });

  it("takes the worst threshold level across CPU, RAM, disk and GPU temperature", () => {
    expect(braiseState(sample({ cpu: 70 }))).toBe("warn");
    expect(braiseState(sample({ cpu: 5, ram: 80 }))).toBe("warn");
    expect(braiseState(sample({ cpu: 5, disk: 80 }))).toBe("warn");
    expect(braiseState(sample({ cpu: 5, gpuTemp: 75 }))).toBe("warn");
    expect(braiseState(sample({ cpu: 90 }))).toBe("crit");
    expect(braiseState(sample({ cpu: 20, ram: 85, disk: 97 }))).toBe("crit");
    expect(braiseState(sample({ cpu: 20, gpuTemp: 85 }))).toBe("crit");
  });
});

describe("braiseAlert", () => {
  it("is null outside the red zone", () => {
    expect(braiseAlert(null)).toBeNull();
    expect(braiseAlert(sample({ cpu: 89, ram: 91, disk: 94, gpuTemp: 84 }))).toBeNull();
  });

  it("names the red reading, preferring the one furthest past its bound", () => {
    expect(braiseAlert(sample({ cpu: 20, disk: 97 }))).toEqual({ metric: "disk", value: 97 });
    // CPU 99/90 = 1.10 beats disk 97/95 = 1.02.
    expect(braiseAlert(sample({ cpu: 99, disk: 97 }))).toEqual({ metric: "cpu", value: 99 });
    expect(braiseAlert(sample({ cpu: 20, gpuTemp: 95 }))).toEqual({
      metric: "gpuTemp",
      value: 95,
    });
  });
});

describe("heaviestProcess / latestSample", () => {
  it("picks the top CPU process", () => {
    expect(heaviestProcess(null)).toBeNull();
    expect(heaviestProcess({ ts: 1, cores: 8, items: [] })).toBeNull();
    const top = heaviestProcess({
      ts: 1,
      cores: 8,
      items: [
        { name: "a", pid: 1, parentPid: null, cpuPercent: 3, memoryBytes: 10 },
        { name: "chrome", pid: 2, parentPid: null, cpuPercent: 12, memoryBytes: 5 },
      ],
    });
    expect(top?.name).toBe("chrome");
  });

  it("returns the newest sample", () => {
    expect(latestSample([])).toBeNull();
    expect(
      latestSample([
        { ...sample(), ts: 1 },
        { ...sample(), ts: 2 },
      ])?.ts
    ).toBe(2);
  });
});

describe("defaultBraisePos", () => {
  it("sits on Tabby's edge, at the far end from it", () => {
    expect(defaultBraisePos(null)).toEqual({ side: "right", y: 1 });
    expect(defaultBraisePos({ side: "right", y: 0.5 })).toEqual({ side: "right", y: 1 });
    expect(defaultBraisePos({ side: "left", y: 0.2 })).toEqual({ side: "left", y: 1 });
    expect(defaultBraisePos({ side: "right", y: 0.9 })).toEqual({ side: "right", y: 0 });
  });
});
