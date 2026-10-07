/**
 * @file MachinePill.tsx
 * @description Compact live machine-metrics pill shown in the dashboard header
 * next to the "Live" badge: `CPU 20 %  RAM 51 %  Disque 2 %  GPU 39 % · 49 °C`.
 * Values come from the latest `machine.sample` WebSocket message and take the
 * Machine-mode threshold colours; GPU is omitted when the server reports none,
 * the whole pill is hidden while the sensor is unavailable or disabled, and
 * readings drop out progressively on narrow screens. Clicking opens the Machine tab.
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Cpu } from "lucide-react";
import {
  useLatestMachineSample,
  type LatestMachineSample,
} from "../../hooks/useLatestMachineSample";
import { metricLevel, sampleValue, type MachineMetric } from "../../lib/machine";
import { LEVEL_TEXT_CLASS, type ThresholdLevel } from "../../lib/machineThresholds";
import { formatCelsius, formatPercent } from "./machineFormat";

interface MachinePillViewProps {
  latest: LatestMachineSample | null;
  onOpen: () => void;
}

/** Breakpoint at which each reading appears — CPU always, then RAM, disk, GPU. */
const VISIBILITY: Record<Exclude<MachineMetric, "processes">, string> = {
  cpu: "inline-flex",
  ram: "hidden sm:inline-flex",
  disk: "hidden md:inline-flex",
  gpu: "hidden lg:inline-flex",
};

function Reading({
  metric,
  label,
  children,
}: {
  metric: keyof typeof VISIBILITY;
  label: string;
  children: ReactNode;
}) {
  return (
    <span
      data-testid={`machine-pill-${metric}`}
      className={`${VISIBILITY[metric]} items-center gap-1`}
    >
      <span className="text-gray-500">{label}</span>
      {children}
    </span>
  );
}

function Value({ level, children }: { level: ThresholdLevel; children: ReactNode }) {
  return (
    <span data-level={level} className={`${LEVEL_TEXT_CLASS[level]} font-medium`}>
      {children}
    </span>
  );
}

/** Pure pill body; renders nothing when there is no usable reading. */
export function MachinePillView({ latest, onOpen }: MachinePillViewProps) {
  const { t, i18n } = useTranslation("dashboard");
  const lng = i18n.language;
  if (!latest) return null;
  const { sample, status } = latest;
  if (status?.sensor === "unavailable" || status?.sensor === "disabled") return null;
  if (!sample.cpu && !sample.ram) return null;

  const percent = (metric: "cpu" | "ram" | "disk") => {
    const value = sampleValue(metric, sample);
    if (value == null) return null;
    return (
      <Reading metric={metric} label={t(`machine.metrics.${metric}`)}>
        <Value level={metricLevel(metric, sample)}>{formatPercent(value, lng)}</Value>
      </Reading>
    );
  };

  const gpu = sample.gpu;
  const gpuReading =
    gpu && (gpu.utilPercent != null || gpu.temperatureC != null) ? (
      <Reading metric="gpu" label={t("machine.metrics.gpu")}>
        {gpu.utilPercent != null && (
          <Value level="normal">{formatPercent(gpu.utilPercent, lng)}</Value>
        )}
        {gpu.utilPercent != null && gpu.temperatureC != null && (
          <span className="text-gray-600">·</span>
        )}
        {gpu.temperatureC != null && (
          <Value level={metricLevel("gpu", sample)}>{formatCelsius(gpu.temperatureC, lng)}</Value>
        )}
      </Reading>
    ) : null;

  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="machine-pill"
      title={t("machine.pill.open")}
      aria-label={t("machine.pill.open")}
      className="flex items-center gap-2.5 min-w-0 max-w-full overflow-hidden whitespace-nowrap text-[11px] tabular-nums bg-surface-2 border border-border hover:border-accent/40 px-2 py-0.5 rounded-full transition-colors"
    >
      <Cpu className="w-3 h-3 flex-shrink-0 text-gray-500" aria-hidden="true" />
      {percent("cpu")}
      {percent("ram")}
      {percent("disk")}
      {gpuReading}
    </button>
  );
}

/** Live pill wired to the WebSocket. */
export function MachinePill({ onOpen }: { onOpen: () => void }) {
  const latest = useLatestMachineSample();
  return <MachinePillView latest={latest} onOpen={onOpen} />;
}
