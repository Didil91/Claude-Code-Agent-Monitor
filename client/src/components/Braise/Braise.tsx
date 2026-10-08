/**
 * @file Braise.tsx
 * @description Braise, the machine flame: a floating companion mounted next to
 * Tabby in Layout. Reads host metrics through `useMachineMetrics`, maps the
 * latest sample to one of four looks (idle ember, calm, agitated, red alert),
 * shows an alert bubble while a reading is in the red zone, and opens a
 * summary card on click (four metrics, active agents from `GET /api/stats`,
 * heaviest process, shortcut to the Machine mode). Dragging, docking and the
 * remembered position reuse Tabby's `useTabbyPosition`; hidden from Settings.
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { eventBus } from "../../lib/eventBus";
import type { WSMessage } from "../../lib/types";
import { useMachineMetrics } from "../../hooks/useMachineMetrics";
import { formatCelsius, formatPercent } from "../machine/machineFormat";
import { TabbyFlyout, usePrefersReducedMotion, type Anchor } from "../Tabby/Tabby";
import { useTabbyPosition } from "../Tabby/useTabbyPosition";
import { BraiseFlame } from "./BraiseFlame";
import { BraisePanel } from "./BraisePanel";
import { braiseAlert, braiseState, latestSample } from "./braiseState";
import { braisePrefs, defaultBraisePos } from "./prefs";
import "./braise.css";

/** Button footprint in px (smaller than Tabby's 60). */
export const BRAISE_SIZE = 60;

/** WebSocket messages that can change the active-agent count. */
const AGENT_EVENTS = new Set<WSMessage["type"]>([
  "agent_created",
  "agent_updated",
  "session_created",
  "session_updated",
]);

/** Active-agent count, fetched while `active` and refreshed on agent events. */
function useActiveAgents(active: boolean): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = () => {
      api.stats
        .get()
        .then((s) => {
          if (!cancelled) setCount(s.active_agents);
        })
        .catch(() => {
          // Keep the last known count; the panel shows "—" until one arrives.
        });
    };
    load();
    const unsubscribe = eventBus.subscribe((msg: WSMessage) => {
      if (!AGENT_EVENTS.has(msg.type)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(load, 1000);
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [active]);

  return count;
}

function BraiseCompanion() {
  const { t, i18n } = useTranslation("dashboard");
  const navigate = useNavigate();
  const reducedMotion = usePrefersReducedMotion();
  const metrics = useMachineMetrics();
  const place = useTabbyPosition({
    size: BRAISE_SIZE,
    getPos: braisePrefs.getPos,
    setPos: braisePrefs.setPos,
    defaultPos: defaultBraisePos,
  });
  const [open, setOpen] = useState(false);
  const activeAgents = useActiveAgents(open);

  const sample = latestSample(metrics.samples);
  const state = braiseState(sample);
  const alert = braiseAlert(sample);

  // A dismissed alert stays hidden until the readings leave the red zone.
  const [dismissed, setDismissed] = useState(false);
  const alerting = alert != null;
  useEffect(() => {
    if (!alerting) setDismissed(false);
  }, [alerting]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const openMachine = useCallback(() => {
    setOpen(false);
    navigate("/?tab=machine");
  }, [navigate]);

  const anchor: Anchor = {
    left: place.left,
    top: place.top,
    size: place.size,
    side: place.side,
    openUp: place.openUp,
  };

  const alertText = alert
    ? t(`braise.alert.${alert.metric}`, {
        value:
          alert.metric === "gpuTemp"
            ? formatCelsius(alert.value, i18n.language)
            : formatPercent(alert.value, i18n.language),
      })
    : null;

  return (
    <>
      {!place.dragging && open && (
        <TabbyFlyout anchor={anchor}>
          <BraisePanel
            sample={sample}
            processes={metrics.processes}
            activeAgents={activeAgents}
            onOpenMachine={openMachine}
            onClose={() => setOpen(false)}
          />
        </TabbyFlyout>
      )}

      {!place.dragging && !open && alertText && !dismissed && (
        <TabbyFlyout anchor={anchor}>
          <div
            className="max-w-[16rem] cursor-pointer rounded-xl border border-red-500/40 bg-surface-2 px-3 py-2 text-[0.8125rem] font-medium text-red-400 shadow-xl animate-fade-in"
            role="alert"
            onClick={() => setDismissed(true)}
            title={t("braise.dismiss")}
          >
            {alertText}
          </div>
        </TabbyFlyout>
      )}

      <button
        type="button"
        className="braise-btn"
        data-dragging={place.dragging ? "1" : "0"}
        data-state={state}
        style={{ left: place.left, top: place.top, width: BRAISE_SIZE, height: BRAISE_SIZE }}
        onPointerDown={place.onPointerDown}
        onPointerMove={place.onPointerMove}
        onPointerUp={place.onPointerUp}
        onClick={() => {
          // Swallow the click that ends a drag so moving never opens the card.
          if (place.consumeDrag()) return;
          setOpen((v) => !v);
        }}
        aria-label={open ? t("braise.close") : t("braise.open")}
        aria-expanded={open}
        title={t("braise.hint")}
      >
        <BraiseFlame
          state={state}
          reducedMotion={reducedMotion}
          size={BRAISE_SIZE}
          label={`${t("braise.name")} — ${t(`braise.state.${state}`)}`}
        />
      </button>
    </>
  );
}

/** Mount point: renders nothing (and polls nothing) while hidden in Settings. */
export function Braise() {
  const [enabled, setEnabled] = useState(() => braisePrefs.getEnabled());
  useEffect(() => braisePrefs.subscribe(() => setEnabled(braisePrefs.getEnabled())), []);
  return enabled ? <BraiseCompanion /> : null;
}
