/**
 * @file SessionCpu.tsx
 * @description Compact CPU reading of one session — its claude process plus every
 * command it spawned — for agent and session cards. Coloured with the Machine-mode CPU
 * thresholds. `SessionCpuView` is pure (value in, markup out); `SessionCpu` wires it to
 * the live WebSocket through `useSessionCpu`. Renders nothing without a reading, so
 * cards stay unchanged off Windows, for remote sessions or before the first hook.
 */

import { useTranslation } from "react-i18next";
import { Gauge } from "lucide-react";
import { useSessionCpu } from "../../hooks/useSessionCpu";
import { LEVEL_TEXT_CLASS, thresholdLevel } from "../../lib/machineThresholds";
import { formatPercent } from "./machineFormat";

/** Pure badge; nothing when `value` is null. */
export function SessionCpuView({ value }: { value: number | null }) {
  const { t, i18n } = useTranslation("dashboard");
  if (value === null) return null;
  const level = thresholdLevel("cpu", value);
  const percent = formatPercent(value, i18n.language, 1);
  return (
    <span
      data-testid="session-cpu"
      data-level={level}
      title={t("machine.sessionCpu.title")}
      aria-label={t("machine.sessionCpu.label", { value: percent })}
      className="flex items-center gap-1 flex-shrink-0 tabular-nums"
    >
      <Gauge className="w-3 h-3" aria-hidden="true" />
      <span className={LEVEL_TEXT_CLASS[level]}>{percent}</span>
    </span>
  );
}

/** Live badge for `sessionId`. */
export function SessionCpu({ sessionId }: { sessionId: string }) {
  return <SessionCpuView value={useSessionCpu(sessionId)} />;
}
