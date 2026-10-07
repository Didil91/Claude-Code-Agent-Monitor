/**
 * @file MachineView.tsx
 * @description Presentational body of the dashboard's Machine tab: AppControl-style
 * metric tabs (CPU, RAM, disk, GPU when present, processes) with live value and
 * sparkline, the big 5-minute chart of the selected metric with a detail line,
 * agent markers (session start / end, long shell commands) labelled on the chart,
 * the top-process table, and a readable banner when the sensor is starting,
 * unavailable, unsupported or disabled. Pure — fed by `useMachineMetrics` and
 * `useAgentMarkers`.
 */

import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { AlertTriangle, Info } from "lucide-react";
import {
  MACHINE_METRICS,
  gpuTempSeries,
  hasGpu,
  isClaudeProcess,
  metricLevel,
  sampleSeries,
  sampleValue,
  type MachineMetric,
  type ProcessSort,
  type SeriesPoint,
} from "../../lib/machine";
import { LEVEL_TEXT_CLASS, thresholdLevel } from "../../lib/machineThresholds";
import type { MachineMetricsState } from "../../hooks/useMachineMetrics";
import type { MachineSample } from "../../lib/types";
import { Sparkline } from "./Sparkline";
import { MachineChart, type ChartMarker } from "./MachineChart";
import { TopProcesses } from "./TopProcesses";
import {
  formatBytes,
  formatCelsius,
  formatClockSeconds,
  formatDuration,
  formatInteger,
  formatPercent,
} from "./machineFormat";
import {
  markerSessionName,
  markersInWindow,
  truncateCommand,
  type AgentMarker,
} from "../../lib/machineMarkers";
import type { MarkerSessions } from "../../hooks/useAgentMarkers";

interface MachineViewProps {
  state: MachineMetricsState;
  selected: MachineMetric;
  onSelect: (metric: MachineMetric) => void;
  sort: ProcessSort;
  onSortChange: (sort: ProcessSort) => void;
  /** Agent markers (any time range; only the chart window is drawn). */
  markers?: readonly AgentMarker[];
  /** Known sessions, to name the markers. */
  markerSessions?: MarkerSessions;
}

/** Translate markers inside the chart window into labelled chart markers. */
export function chartMarkers(
  markers: readonly AgentMarker[],
  sessions: MarkerSessions,
  endTs: number,
  windowMs: number,
  t: TFunction<"dashboard">,
  lng: string
): ChartMarker[] {
  return markersInWindow(markers, endTs, windowMs).map((m) => {
    const time = formatClockSeconds(m.ts, lng);
    const title =
      m.kind === "command"
        ? t("machine.markers.command", { time, duration: formatDuration(m.durationMs ?? 0, lng) })
        : t(`machine.markers.${m.kind}`, { time });
    return {
      id: m.id,
      ts: m.ts,
      kind: m.kind,
      title,
      session: markerSessionName(m, sessions),
      detail: m.kind === "command" && m.command ? truncateCommand(m.command) : undefined,
    };
  });
}

const NO_SESSIONS: MarkerSessions = new Map();

/** % axis bound for the processes curve: at least 10 %, rounded up to a tens step. */
function processesMax(points: readonly SeriesPoint[]): number {
  const peak = points.reduce((m, p) => Math.max(m, p.value), 0);
  return Math.min(100, Math.max(10, Math.ceil(peak / 10) * 10));
}

function StatusBanner({ state }: { state: MachineMetricsState }) {
  const { t } = useTranslation("dashboard");
  let message: string | null = null;
  let warning = false;
  if (state.error) {
    message = t("machine.status.error");
    warning = true;
  } else if (state.status) {
    const { sensor, gpu, retryInMs } = state.status;
    if (sensor === "unavailable") {
      warning = true;
      message =
        retryInMs != null
          ? t("machine.status.unavailable", { seconds: Math.ceil(retryInMs / 1000) })
          : t("machine.status.unavailableNoRetry");
    } else if (sensor === "starting") message = t("machine.status.starting");
    else if (sensor === "unsupported") message = t("machine.status.unsupported");
    else if (sensor === "disabled") message = t("machine.status.disabled");
    else if (gpu === "unavailable") {
      warning = true;
      message = t("machine.status.gpuUnavailable");
    }
  }
  if (!message) return null;
  const Icon = warning ? AlertTriangle : Info;
  return (
    <div
      role="status"
      data-testid="machine-status"
      className={`card flex items-start gap-2 px-4 py-3 text-xs ${
        warning ? "text-orange-300" : "text-gray-400"
      }`}
    >
      <Icon className="w-4 h-4 flex-shrink-0 mt-px" />
      <span>{message}</span>
    </div>
  );
}

function detailLine(
  metric: MachineMetric,
  latest: MachineSample | undefined,
  state: MachineMetricsState,
  t: TFunction<"dashboard">,
  lng: string
): string[] {
  const parts: string[] = [];
  if (metric === "cpu" && state.cores) {
    parts.push(t("machine.details.cores", { n: formatInteger(state.cores, lng) }));
  }
  if (metric === "ram" && latest?.ram) {
    parts.push(
      t("machine.details.ram", {
        used: formatBytes(latest.ram.usedBytes, lng),
        total: formatBytes(latest.ram.totalBytes, lng),
      })
    );
  }
  if (metric === "disk") {
    if (latest?.disk) {
      parts.push(
        t("machine.details.diskIo", {
          read: formatBytes(latest.disk.readBytesPerSec, lng),
          write: formatBytes(latest.disk.writeBytesPerSec, lng),
        })
      );
    }
    if (latest?.volume) {
      parts.push(
        t("machine.details.volume", {
          path: latest.volume.path,
          percent: formatPercent(latest.volume.percent, lng),
        })
      );
    }
  }
  if (metric === "gpu" && latest?.gpu) {
    if (latest.gpu.lowPower) parts.push(t("machine.details.gpuLowPower"));
    if (latest.gpu.memUsedMiB != null && latest.gpu.memTotalMiB != null) {
      parts.push(
        t("machine.details.gpuMem", {
          used: formatBytes(latest.gpu.memUsedMiB * 1024 * 1024, lng),
          total: formatBytes(latest.gpu.memTotalMiB * 1024 * 1024, lng),
        })
      );
    }
  }
  if (metric === "processes" && state.processes) {
    const n = state.processes.items.filter((p) => isClaudeProcess(p.name)).length;
    parts.push(t("machine.details.claudeCount", { n: formatInteger(n, lng) }));
  }
  return parts;
}

export function MachineView({
  state,
  selected,
  onSelect,
  sort,
  onSortChange,
  markers = [],
  markerSessions = NO_SESSIONS,
}: MachineViewProps) {
  const { t, i18n } = useTranslation("dashboard");
  const lng = i18n.language;
  const latest = state.samples[state.samples.length - 1];
  const gpuPresent = hasGpu(state.samples);
  const metrics = MACHINE_METRICS.filter((m) => m !== "gpu" || gpuPresent);
  const current: MachineMetric = metrics.includes(selected) ? selected : "cpu";
  const claudeNow = state.claudeCpu[state.claudeCpu.length - 1]?.value ?? null;

  const seriesFor = (metric: MachineMetric) =>
    metric === "processes" ? state.claudeCpu : sampleSeries(metric, state.samples);
  const maxFor = (metric: MachineMetric) =>
    metric === "processes" ? processesMax(state.claudeCpu) : 100;

  const endTs =
    latest?.ts ?? state.claudeCpu[state.claudeCpu.length - 1]?.ts ?? state.processes?.ts ?? 0;
  const metricName = t(`machine.metrics.${current}`);
  const chartTitle =
    current === "processes"
      ? t("machine.chartTitleProcesses")
      : t("machine.chartTitle", { metric: metricName });
  const details = detailLine(current, latest, state, t, lng);

  return (
    <div className="flex flex-col gap-4" data-testid="machine-view">
      <StatusBanner state={state} />

      <div
        role="tablist"
        aria-label={t("machine.metricsLabel")}
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3"
      >
        {metrics.map((metric) => {
          const active = metric === current;
          const level = metricLevel(metric, latest, claudeNow);
          const value =
            metric === "processes"
              ? formatPercent(claudeNow, lng, 1)
              : formatPercent(sampleValue(metric, latest), lng);
          const temp = metric === "gpu" ? (latest?.gpu?.temperatureC ?? null) : null;
          return (
            <button
              key={metric}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`machine-tab-${metric}`}
              onClick={() => onSelect(metric)}
              className={`card text-left px-3 py-2.5 transition-colors border ${
                active ? "border-accent bg-accent/10" : "border-border hover:border-border-light"
              }`}
            >
              <div className={`text-xs font-medium ${active ? "text-accent" : "text-gray-400"}`}>
                {t(`machine.metrics.${metric}`)}
              </div>
              <div className="flex items-end justify-between gap-2 mt-1">
                <div className="min-w-0">
                  <div
                    data-testid={`machine-value-${metric}`}
                    data-level={metric === "gpu" ? undefined : level}
                    className={`text-lg font-semibold tabular-nums leading-tight ${
                      metric === "gpu" ? LEVEL_TEXT_CLASS.normal : LEVEL_TEXT_CLASS[level]
                    }`}
                  >
                    {value}
                  </div>
                  {metric === "gpu" && (
                    <div
                      data-testid="machine-value-gpu-temp"
                      data-level={thresholdLevel("gpuTemp", temp)}
                      className={`text-[11px] font-medium tabular-nums ${
                        LEVEL_TEXT_CLASS[thresholdLevel("gpuTemp", temp)]
                      }`}
                    >
                      {formatCelsius(temp, lng)}
                    </div>
                  )}
                  {metric === "processes" && (
                    <div className="text-[11px] text-gray-500 truncate">
                      {t("machine.claudeCpuCaption")}
                    </div>
                  )}
                </div>
                <span className={active ? "text-accent" : "text-gray-500"}>
                  <Sparkline points={seriesFor(metric)} max={maxFor(metric)} />
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="card px-4 py-3" role="tabpanel" aria-label={chartTitle}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-2">
          <h3 className="text-sm font-semibold text-gray-200">{chartTitle}</h3>
          {details.length > 0 && (
            <p className="text-xs text-gray-500" data-testid="machine-details">
              {details.join(" · ")}
            </p>
          )}
        </div>
        <MachineChart
          points={seriesFor(current)}
          temperature={current === "gpu" ? gpuTempSeries(state.samples) : null}
          max={maxFor(current)}
          windowMs={state.windowMs}
          endTs={endTs}
          lng={lng}
          label={t("machine.chartLabel", { metric: metricName })}
          emptyLabel={t("machine.noData")}
          temperatureLabel={t("machine.temperature")}
          loadLabel={t("machine.load")}
          markers={chartMarkers(markers, markerSessions, endTs, state.windowMs, t, lng)}
        />
      </div>

      <TopProcesses processes={state.processes} sort={sort} onSortChange={onSortChange} />
    </div>
  );
}
