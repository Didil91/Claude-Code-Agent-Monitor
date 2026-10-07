/**
 * @file MachineChart.tsx
 * @description Large 5-minute chart of the selected Machine-mode metric: d3 scales
 * and shape generators rendered as React SVG — filled curve with a light accent
 * gradient, a % axis on the left, clock ticks below, and for the GPU a dashed
 * temperature overlay on its own °C axis. Colours come only from theme classes
 * through `currentColor`.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import type { SeriesPoint } from "../../lib/machine";
import { formatCelsius, formatClock, formatPercent } from "./machineFormat";

const HEIGHT = 220;
const MARGIN = { top: 12, right: 16, bottom: 24, left: 44 };
const TEMP_AXIS_WIDTH = 40;
const FALLBACK_WIDTH = 720;

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
}: MachineChartProps) {
  const [ref, width] = useWidth();
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
        </g>
      </svg>
      {empty && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-500">
          {emptyLabel}
        </div>
      )}
    </div>
  );
}
