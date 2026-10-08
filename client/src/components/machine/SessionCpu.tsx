/**
 * @file SessionCpu.tsx
 * @description CPU tag of one session — its claude process plus every command it
 * spawned — shaped like the status badges it sits next to on agent cards: gauge icon,
 * value and a small fill bar, tinted by the Machine-mode CPU thresholds.
 * `SessionCpuView` is pure (value in, markup out); `SessionCpu` wires it to the live
 * WebSocket through `useSessionCpu`. Renders nothing without a reading, so cards stay
 * unchanged off Windows, for remote sessions or before the session's first hook.
 */

import { useTranslation } from "react-i18next";
import { Gauge } from "lucide-react";
import { useSessionCpu } from "../../hooks/useSessionCpu";
import { thresholdLevel, type ThresholdLevel } from "../../lib/machineThresholds";
import { formatPercent } from "./machineFormat";

/** Tag tint per CPU level, in the `badge` palette of the status badges. */
const LEVEL_TAG_CLASS: Record<ThresholdLevel, string> = {
  normal: "bg-accent/10 border-accent/20 text-accent",
  warn: "bg-orange-500/10 border-orange-500/25 text-orange-400",
  crit: "bg-red-500/10 border-red-500/25 text-red-400",
};

// Keep a sliver of fill visible for near-idle sessions.
const MIN_FILL_PERCENT = 4;

/** Pure tag; nothing when `value` is null. */
export function SessionCpuView({ value }: { value: number | null }) {
  const { t, i18n } = useTranslation("dashboard");
  if (value === null) return null;
  const level = thresholdLevel("cpu", value);
  const percent = formatPercent(value, i18n.language, 1);
  const fill = Math.min(100, Math.max(MIN_FILL_PERCENT, value));
  return (
    <span
      data-testid="session-cpu"
      data-level={level}
      title={t("machine.sessionCpu.title")}
      aria-label={t("machine.sessionCpu.label", { value: percent })}
      className={`badge tabular-nums ${LEVEL_TAG_CLASS[level]}`}
    >
      <Gauge className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
      {percent}
      <span className="relative w-8 h-1.5 rounded-full overflow-hidden" aria-hidden="true">
        <span className="absolute inset-0 bg-current opacity-20" />
        <span
          data-testid="session-cpu-fill"
          className="absolute inset-y-0 left-0 rounded-full bg-current transition-[width] duration-500"
          style={{ width: `${fill}%` }}
        />
      </span>
    </span>
  );
}

/** Live tag for `sessionId`. */
export function SessionCpu({ sessionId }: { sessionId: string }) {
  return <SessionCpuView value={useSessionCpu(sessionId)} />;
}
