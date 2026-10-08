/**
 * @file machine.ts
 * @description Pure helpers for the Machine mode: the metric tabs (CPU, RAM, disk,
 * GPU, processes), how each one reads its value and level from a host sample,
 * rolling-window maintenance for live `machine.sample` messages, `claude`
 * process detection and top-process sorting. No React, no I/O — unit-testable.
 */

import type { MachineProcess, MachineProcesses, MachineSample } from "./types";
import { thresholdLevel, type ThresholdLevel } from "./machineThresholds";

export type MachineMetric = "cpu" | "ram" | "disk" | "gpu" | "processes";
export type ProcessSort = "cpu" | "ram";

/** Tab order. The GPU tab is only shown when a GPU reported at least one reading. */
export const MACHINE_METRICS: readonly MachineMetric[] = ["cpu", "ram", "disk", "gpu", "processes"];

/** Rows in the top-process list. */
export const TOP_PROCESS_COUNT = 8;

/** Default rolling window (matches the server's 5 minutes). */
export const MACHINE_WINDOW_MS = 5 * 60 * 1000;

/** One point of a metric's time series. */
export interface SeriesPoint {
  ts: number;
  value: number;
}

/** True for Claude Code processes (`claude`, `claude.exe`, any case). */
export function isClaudeProcess(name: string): boolean {
  return /^claude(\.exe)?$/i.test(name.trim());
}

/**
 * Whole-machine CPU share of the `claude` processes and everything they spawn, as
 * computed by the server; falls back to the `claude` processes alone (older server).
 */
export function claudeCpuPercent(processes: MachineProcesses | null): number | null {
  if (!processes) return null;
  const tree = processes.claudeTreeCpuPercent;
  if (typeof tree === "number" && Number.isFinite(tree)) return tree;
  return processes.items
    .filter((p) => isClaudeProcess(p.name))
    .reduce((sum, p) => sum + (Number.isFinite(p.cpuPercent) ? p.cpuPercent : 0), 0);
}

/**
 * CPU share of one session's claude process and everything it spawned, or null when
 * the server has no reading for it (no PID reported yet, process gone, not Windows).
 */
export function sessionCpuPercent(
  processes: MachineProcesses | null,
  sessionId: string
): number | null {
  const value = processes?.cpuBySession?.[sessionId];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The `count` heaviest processes by CPU or by memory (ties broken by the other key). */
export function topProcesses(
  items: readonly MachineProcess[],
  sort: ProcessSort,
  count = TOP_PROCESS_COUNT
): MachineProcess[] {
  const primary = (p: MachineProcess) => (sort === "cpu" ? p.cpuPercent : p.memoryBytes);
  const secondary = (p: MachineProcess) => (sort === "cpu" ? p.memoryBytes : p.cpuPercent);
  return [...items]
    .sort((a, b) => primary(b) - primary(a) || secondary(b) - secondary(a))
    .slice(0, count);
}

/** Percent value shown for `metric` in a sample (`processes` is not sample-based). */
export function sampleValue(metric: MachineMetric, sample: MachineSample | null | undefined) {
  if (!sample) return null;
  switch (metric) {
    case "cpu":
      return sample.cpu?.percent ?? null;
    case "ram":
      return sample.ram?.percent ?? null;
    case "disk":
      return sample.disk?.activePercent ?? null;
    case "gpu":
      return sample.gpu?.utilPercent ?? null;
    default:
      return null;
  }
}

/** Threshold level for a metric reading. GPU is judged on temperature, processes on CPU. */
export function metricLevel(
  metric: MachineMetric,
  sample: MachineSample | null | undefined,
  claudeCpu: number | null = null
): ThresholdLevel {
  switch (metric) {
    case "cpu":
      return thresholdLevel("cpu", sample?.cpu?.percent);
    case "ram":
      return thresholdLevel("ram", sample?.ram?.percent);
    case "disk":
      return thresholdLevel("disk", sample?.disk?.activePercent);
    case "gpu":
      return thresholdLevel("gpuTemp", sample?.gpu?.temperatureC);
    case "processes":
      return thresholdLevel("cpu", claudeCpu);
  }
}

/** Time series of a sample-based metric, skipping samples without a reading. */
export function sampleSeries(metric: MachineMetric, samples: readonly MachineSample[]) {
  const points: SeriesPoint[] = [];
  for (const s of samples) {
    const value = sampleValue(metric, s);
    if (value != null) points.push({ ts: s.ts, value });
  }
  return points;
}

/** GPU temperature series (°C) for the big-graph overlay. */
export function gpuTempSeries(samples: readonly MachineSample[]): SeriesPoint[] {
  const points: SeriesPoint[] = [];
  for (const s of samples) {
    const value = s.gpu?.temperatureC;
    if (value != null) points.push({ ts: s.ts, value });
  }
  return points;
}

/**
 * Append `item` to an oldest-first window: drops out-of-order duplicates and
 * anything older than `windowMs` before the newest timestamp.
 */
export function appendToWindow<T extends { ts: number }>(
  list: readonly T[],
  item: T,
  windowMs = MACHINE_WINDOW_MS
): T[] {
  const last = list[list.length - 1];
  if (last && item.ts <= last.ts) return list as T[];
  const cutoff = item.ts - windowMs;
  const kept = list.filter((x) => x.ts >= cutoff);
  kept.push(item);
  return kept;
}

/** Whether any sample in the window carries a GPU reading. */
export function hasGpu(samples: readonly MachineSample[]): boolean {
  return samples.some((s) => s.gpu != null);
}
