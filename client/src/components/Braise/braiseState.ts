/**
 * @file braiseState.ts
 * @description Pure logic behind Braise, the machine flame: which of the four
 * looks (idle ember, calm flame, agitated flame, red alert) a host sample maps
 * to, which red-zone reading the alert bubble names, and which process is the
 * heaviest. Thresholds come from `lib/machineThresholds.ts`. No React, no I/O.
 */

import {
  MACHINE_THRESHOLDS,
  thresholdLevel,
  worstLevel,
  type ThresholdMetric,
} from "../../lib/machineThresholds";
import { topProcesses } from "../../lib/machine";
import type { MachineProcess, MachineProcesses, MachineSample } from "../../lib/types";

export type BraiseState = "idle" | "normal" | "warn" | "crit";

/** Below this CPU %, with nothing over a threshold, Braise dozes as an ember. */
export const BRAISE_IDLE_CPU = 10;

/** Reading of each threshold metric in a sample (disk = activity, GPU = °C). */
export function metricReadings(
  sample: MachineSample | null | undefined
): Record<ThresholdMetric, number | null> {
  return {
    cpu: sample?.cpu?.percent ?? null,
    ram: sample?.ram?.percent ?? null,
    disk: sample?.disk?.activePercent ?? null,
    gpuTemp: sample?.gpu?.temperatureC ?? null,
  };
}

const METRIC_ORDER: readonly ThresholdMetric[] = ["cpu", "ram", "disk", "gpuTemp"];

/**
 * Look of the flame for a sample: the worst threshold level across CPU, RAM,
 * disk activity and GPU temperature; under every threshold it is `idle` when
 * CPU is below {@link BRAISE_IDLE_CPU} (or unknown), else `normal`.
 */
export function braiseState(sample: MachineSample | null | undefined): BraiseState {
  const readings = metricReadings(sample);
  const level = worstLevel(...METRIC_ORDER.map((m) => thresholdLevel(m, readings[m])));
  if (level !== "normal") return level;
  const cpu = readings.cpu;
  return cpu == null || !Number.isFinite(cpu) || cpu < BRAISE_IDLE_CPU ? "idle" : "normal";
}

export interface BraiseAlert {
  metric: ThresholdMetric;
  value: number;
}

/**
 * The red-zone reading the alert bubble talks about, or `null` when nothing is
 * at its red threshold. With several, the one furthest past its bound wins
 * (ties follow CPU, RAM, disk, GPU order).
 */
export function braiseAlert(sample: MachineSample | null | undefined): BraiseAlert | null {
  const readings = metricReadings(sample);
  let best: BraiseAlert | null = null;
  let bestScore = -Infinity;
  for (const metric of METRIC_ORDER) {
    const value = readings[metric];
    if (value == null || thresholdLevel(metric, value) !== "crit") continue;
    // Ratio to the red bound puts % and °C on the same scale.
    const score = value / MACHINE_THRESHOLDS[metric].crit;
    if (score > bestScore) {
      best = { metric, value };
      bestScore = score;
    }
  }
  return best;
}

/** Heaviest process by CPU share, or `null` without a process snapshot. */
export function heaviestProcess(processes: MachineProcesses | null): MachineProcess | null {
  if (!processes || processes.items.length === 0) return null;
  return topProcesses(processes.items, "cpu", 1)[0] ?? null;
}

/** Latest sample of an oldest-first window. */
export function latestSample(samples: readonly MachineSample[]): MachineSample | null {
  return samples[samples.length - 1] ?? null;
}
