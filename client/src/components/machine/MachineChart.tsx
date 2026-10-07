/**
 * @file MachineChart.tsx
 * @description Large 5-minute chart of the selected Machine-mode metric: d3 scales
 * and shape generators rendered as React SVG — filled curve with a light accent
 * gradient, a % axis on the left, clock ticks below, and for the GPU a dashed
 * temperature overlay on its own °C axis, plus thin vertical agent markers
 * (session start / end, end of long shell commands) drawn under the curve with
 * a hover / focus label. Colours come only from theme classes through
 * `currentColor`.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import type { SeriesPoint } from "../../lib/machine";
import type { AgentMarkerKind } from "../../lib/machineMarkers";
import { formatCelsius, formatClock, formatPercent } from "./machineFormat";

const HEIGHT = 220;
const MARGIN = { top: 12, right: 16, bottom: 24, left: 44 };
const TEMP_AXIS_WIDTH = 40;
const FALLBACK_WIDTH = 720;
/** Half-width of the invisible hover strip around a 1 px marker. */
const MARKER_HIT = 4;
/** Distance from an edge under which the label stops being centred. */
const LABEL_EDGE = 120;

/** Theme text colour of each marker kind (remapped darker in light theme). */
export const MARKER_CLASS: Record<AgentMarkerKind, string> = {
  sessionStart: "text-emerald-400",
  sessionEnd: "text-gray-400",
  command: "text-sky-400",
};

/** A marker ready to draw: instant plus the already-translated label lines. */
export interface ChartMarker {
  id: string;
  ts: number;
  kind: AgentMarkerKind;
  /** First label line (e.g. `Session start · 14:02:11`). */
  title: string;
  /** Session name. */
  session: string;
  /** Truncated command, for command markers. */
  detail?: string;
}

interface MachineChartProps {
  points: readonly SeriesPoint[];
  /** Optional °C overlay (GPU temperature). */
  temperature?: readonly SeriesPoint[] | null;
  /** Upper bound of the % axis. */
  max: number;
  /** Fixed time window ending at `endTs`. */
  windowMs: number;
  endTs: number;
  lng: string;
  /** Accessible name of the chart. */
  label: string;
  emptyLabel: string;
  temperatureLabel: string;
  loadLabel: string;
  /** Agent markers; those outside the window are skipped. */
  markers?: readonly ChartMarker[];
}

/** Track an element's width so the SVG keeps real pixel text sizes. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      if (el.clientWidth > 0) setWidth(el.clientWidth);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export function MachineChart({
  points,
  temperature,
  max,
  windowMs,
  endTs,
  lng,
  label,
  emptyLabel,
  temperatureLabel,
  loadLabel,
  markers = [],
}: MachineChartProps) {
  const [ref, width] = useWidth();
  const [hovered, setHovered] = useState<string | null>(null);
  const gradientId = `machine-grad-${useId().replace(/:/g, "")}`;
  const hasTemp = !!temperature && temperature.length > 0;
  const right = MARGIN.right + (hasTemp ? TEMP_AXIS_WIDTH : 0);
  const innerW = Math.max(10, width - MARGIN.left - right);
  const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;

  const chart = useMemo(() => {
    const x = d3
      .scaleLinear()
      .domain([endTs - windowMs, endTs])
      .range([0, innerW]);
    const y = d3.scaleLinear().domain([0, max]).range([innerH, 0]).clamp(true);
    const line = d3
      .line<SeriesPoint>()
      .x((p) => x(p.ts))
      .y((p) => y(p.value));
    const area = d3
      .area<SeriesPoint>()
      .x((p) => x(p.ts))
      .y0(innerH)
      .y1((p) => y(p.value));
    const tempY = d3.scaleLinear().domain([0, 100]).range([innerH, 0]).clamp(true);
    const tempLine = d3
      .line<SeriesPoint>()
      .x((p) => x(p.ts))
      .y((p) => tempY(p.value));
    const visible = points.filter((p) => p.ts >= endTs - windowMs);
    const visibleTemp = (temperature ?? []).filter((p) => p.ts >= endTs - windowMs);
    return {
      x,
      y,
      tempY,
      linePath: visible.length > 1 ? (line(visible) ?? "") : "",
      areaPath: visible.length > 1 ? (area(visible) ?? "") : "",
      tempPath: visibleTemp.length > 1 ? (tempLine(visibleTemp) ?? "") : "",
      yTicks: y.ticks(4),
      tempTicks: tempY.ticks(4),
      // Whole minutes, so each `HH:MM` label appears once.
      xTicks: d3
        .scaleTime()
        .domain([endTs - windowMs, endTs])
        .ticks(d3.timeMinute.every(innerW < 360 ? 2 : 1) ?? d3.timeMinute)
        .map((d) => d.getTime()),
    };
  }, [points, temperature, max, windowMs, endTs, innerW, innerH]);

  const empty = chart.linePath === "";
  const visibleMarkers = markers.filter((m) => m.ts >= endTs - windowMs && m.ts <= endTs);
  const active = visibleMarkers.find((m) => m.id === hovered) ?? null;
  const activeX = active ? MARGIN.left + chart.x(active.ts) : 0;

  return (
    <div ref={ref} className="relative w-full">
      {hasTemp && (
        <div className="flex justify-end items-center gap-3 mb-1 text-[10px] text-gray-500">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-0.5 bg-accent" /> {loadLabel}
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 border-t border-dashed border-gray-400" />{" "}
            {temperatureLabel}
          </span>
        </div>
      )}
      <div className="relative">
        <svg
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          role="img"
          aria-label={label}
          className="block"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1" className="text-accent">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.28} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            {/* Grid + % axis */}
            {chart.yTicks.map((v) => (
              <g key={`y-${v}`} transform={`translate(0,${chart.y(v)})`}>
                <line x1={0} x2={innerW} stroke="currentColor" className="text-border" />
                <text
                  x={-8}
                  dy="0.32em"
                  textAnchor="end"
                  fontSize={10}
                  fill="currentColor"
                  className="text-gray-500"
                >
                  {formatPercent(v, lng)}
                </text>
              </g>
            ))}
            {/* Time axis */}
            {chart.xTicks.map((ts) => (
              <text
                key={`x-${ts}`}
                x={chart.x(ts)}
                y={innerH + 16}
                textAnchor="middle"
                fontSize={10}
                fill="currentColor"
                className="text-gray-500"
              >
                {formatClock(ts, lng)}
              </text>
            ))}
            {/* Temperature axis */}
            {hasTemp &&
              chart.tempTicks.map((v) => (
                <text
                  key={`t-${v}`}
                  x={innerW + 8}
                  y={chart.tempY(v)}
                  dy="0.32em"
                  fontSize={10}
                  fill="currentColor"
                  className="text-gray-400"
                >
                  {formatCelsius(v, lng)}
                </text>
              ))}
            {/* Agent markers, under the curve so they never hide it */}
            {visibleMarkers.map((m) => (
              <line
                key={`m-${m.id}`}
                x1={chart.x(m.ts)}
                x2={chart.x(m.ts)}
                y1={0}
                y2={innerH}
                stroke="currentColor"
                strokeWidth={1}
                strokeOpacity={m.id === hovered ? 0.95 : 0.55}
                shapeRendering="crispEdges"
                className={MARKER_CLASS[m.kind]}
                data-testid="machine-marker"
                data-kind={m.kind}
              />
            ))}
            {!empty && (
              <g className="text-accent">
                <path d={chart.areaPath} fill={`url(#${gradientId})`} />
                <path
                  d={chart.linePath}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  data-testid="machine-chart-line"
                />
              </g>
            )}
            {chart.tempPath && (
              <path
                d={chart.tempPath}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                className="text-gray-400"
                data-testid="machine-chart-temperature"
              />
            )}
            {/* Hover / focus strips over the markers */}
            {visibleMarkers.map((m) => (
              <rect
                key={`h-${m.id}`}
                x={chart.x(m.ts) - MARKER_HIT}
                y={0}
                width={MARKER_HIT * 2}
                height={innerH}
                fill="transparent"
                tabIndex={0}
                role="img"
                aria-label={[m.title, m.session, m.detail].filter(Boolean).join(" — ")}
                className="cursor-default focus:outline-none"
                data-testid="machine-marker-hit"
                onMouseEnter={() => setHovered(m.id)}
                onMouseLeave={() => setHovered((h) => (h === m.id ? null : h))}
                onFocus={() => setHovered(m.id)}
                onBlur={() => setHovered((h) => (h === m.id ? null : h))}
              />
            ))}
          </g>
        </svg>
        {active && (
          <div
            role="tooltip"
            data-testid="machine-marker-label"
            className="absolute z-10 pointer-events-none max-w-[280px] px-2 py-1.5 rounded-md border border-border bg-surface-2 shadow-lg text-[11px] leading-snug"
            style={{
              top: MARGIN.top,
              ...(activeX < LABEL_EDGE
                ? { left: Math.max(0, activeX) }
                : activeX > width - LABEL_EDGE
                  ? { right: Math.max(0, width - activeX) }
                  : { left: activeX, transform: "translateX(-50%)" }),
            }}
          >
            <div className={`font-medium ${MARKER_CLASS[active.kind]}`}>{active.title}</div>
            <div className="text-gray-200 truncate">{active.session}</div>
            {active.detail && (
              <div className="font-mono text-gray-400 break-all">{active.detail}</div>
            )}
          </div>
        )}
      </div>
      {empty && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-500">
          {emptyLabel}
        </div>
      )}
    </div>
  );
}
