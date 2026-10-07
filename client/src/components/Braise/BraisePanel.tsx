/**
 * @file BraisePanel.tsx
 * @description Summary card Braise opens on click: CPU, RAM, disk activity and
 * GPU (load · temperature, only when a GPU reports) coloured by threshold level,
 * the number of active agents, the heaviest process, and a button that opens
 * the Machine mode. Presentational — data comes from `Braise.tsx`.
 */

import { useTranslation } from "react-i18next";
import { Cpu, X } from "lucide-react";
import { metricLevel, sampleValue, type MachineMetric } from "../../lib/machine";
import { LEVEL_TEXT_CLASS } from "../../lib/machineThresholds";
import type { MachineProcesses, MachineSample } from "../../lib/types";
import { formatCelsius, formatInteger, formatPercent } from "../machine/machineFormat";
import { heaviestProcess } from "./braiseState";

interface BraisePanelProps {
  sample: MachineSample | null;
  processes: MachineProcesses | null;
  /** `null` while the count is loading or unavailable. */
  activeAgents: number | null;
  onOpenMachine: () => void;
  onClose: () => void;
}

const ROWS: readonly Exclude<MachineMetric, "processes">[] = ["cpu", "ram", "disk", "gpu"];

export function BraisePanel({
  sample,
  processes,
  activeAgents,
  onOpenMachine,
  onClose,
}: BraisePanelProps) {
  const { t, i18n } = useTranslation("dashboard");
  const lng = i18n.language;
  const top = heaviestProcess(processes);
  const rows = ROWS.filter((m) => m !== "gpu" || sample?.gpu != null);

  return (
    <div
      className="w-64 rounded-xl border border-border bg-surface-2 p-4 shadow-xl animate-fade-in"
      role="dialog"
      aria-label={t("braise.panel.title")}
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-100">{t("braise.panel.title")}</h3>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-gray-500 hover:bg-surface-4 hover:text-gray-300"
          aria-label={t("braise.panel.close")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {sample ? (
        <dl className="space-y-1.5 text-xs">
          {rows.map((metric) => {
            const level = metricLevel(metric, sample);
            const value =
              metric === "gpu"
                ? `${formatPercent(sampleValue("gpu", sample), lng)} · ${formatCelsius(
                    sample.gpu?.temperatureC,
                    lng
                  )}`
                : formatPercent(sampleValue(metric, sample), lng);
            return (
              <div key={metric} className="flex items-center justify-between gap-3">
                <dt className="text-gray-400">{t(`machine.metrics.${metric}`)}</dt>
                <dd
                  className={`font-mono tabular-nums ${LEVEL_TEXT_CLASS[level]}`}
                  data-testid={`braise-${metric}`}
                  data-level={level}
                >
                  {value}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <p className="text-xs text-gray-500">{t("braise.panel.noData")}</p>
      )}

      <dl className="mt-3 space-y-1.5 border-t border-border pt-3 text-xs">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-gray-400">{t("braise.panel.activeAgents")}</dt>
          <dd className="font-mono tabular-nums text-gray-100" data-testid="braise-agents">
            {activeAgents == null ? "—" : formatInteger(activeAgents, lng)}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-gray-400">{t("braise.panel.topProcess")}</dt>
          <dd className="flex items-center justify-between gap-3" data-testid="braise-top-process">
            {top ? (
              <>
                <span className="truncate text-gray-100" title={top.name}>
                  {top.name}
                </span>
                <span className="font-mono tabular-nums text-gray-300">
                  {formatPercent(top.cpuPercent, lng, 1)}
                </span>
              </>
            ) : (
              <span className="text-gray-500">{t("braise.panel.noProcess")}</span>
            )}
          </dd>
        </div>
      </dl>

      <button
        type="button"
        onClick={onOpenMachine}
        className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
      >
        <Cpu className="h-3.5 w-3.5" />
        {t("braise.panel.openMachine")}
      </button>
    </div>
  );
}
