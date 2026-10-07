/**
 * @file machineThresholds.ts
 * @description Single source of the Machine-mode alert thresholds (orange / red)
 * for CPU %, RAM %, disk activity % and GPU temperature °C, plus the helpers that
 * turn a reading into a level and the level into theme-aware text classes.
 * Every Machine-mode surface (tab, dashboard pill, companion) reads from here.
 */

export type ThresholdMetric = "cpu" | "ram" | "disk" | "gpuTemp";
export type ThresholdLevel = "normal" | "warn" | "crit";

/** Orange (`warn`) and red (`crit`) thresholds; a value at or above a bound takes its level. */
export const MACHINE_THRESHOLDS: Record<ThresholdMetric, { warn: number; crit: number }> = {
  cpu: { warn: 70, crit: 90 },
  ram: { warn: 80, crit: 92 },
  disk: { warn: 80, crit: 95 },
  gpuTemp: { warn: 75, crit: 85 },
};

/** Level of `value` for `metric`; missing readings are `normal`. */
export function thresholdLevel(
  metric: ThresholdMetric,
  value: number | null | undefined
): ThresholdLevel {
  if (value == null || !Number.isFinite(value)) return "normal";
  const { warn, crit } = MACHINE_THRESHOLDS[metric];
  if (value >= crit) return "crit";
  if (value >= warn) return "warn";
  return "normal";
}

/** Worst of several levels (`crit` > `warn` > `normal`). */
export function worstLevel(...levels: ThresholdLevel[]): ThresholdLevel {
  if (levels.includes("crit")) return "crit";
  if (levels.includes("warn")) return "warn";
  return "normal";
}

/**
 * Text colour per level. The orange / red shades are remapped to darker ones
 * under the light theme by the Tailwind light-theme plugin (300 → 700,
 * 400 → 600), so both stay readable on light and dark surfaces.
 */
export const LEVEL_TEXT_CLASS: Record<ThresholdLevel, string> = {
  normal: "text-gray-100",
  warn: "text-orange-300",
  crit: "text-red-400",
};
