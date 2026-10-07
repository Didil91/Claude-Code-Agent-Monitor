/**
 * @file Sparkline.tsx
 * @description Tiny d3-computed line + soft area for a Machine-mode metric tab.
 * Draws in `currentColor`, so the parent's text class (accent when selected,
 * muted otherwise) sets its colour under both themes.
 */

import { useMemo } from "react";
import * as d3 from "d3";
import type { SeriesPoint } from "../../lib/machine";

interface SparklineProps {
  points: readonly SeriesPoint[];
  /** Upper bound of the y scale (100 for percentages). */
  max: number;
  width?: number;
  height?: number;
}

export function Sparkline({ points, max, width = 96, height = 28 }: SparklineProps) {
  const paths = useMemo(() => {
    if (points.length < 2) return null;
    const x = d3
      .scaleLinear()
      .domain(d3.extent(points, (p) => p.ts) as [number, number])
      .range([1, width - 1]);
    const y = d3
      .scaleLinear()
      .domain([0, max])
      .range([height - 1, 1])
      .clamp(true);
    const line = d3
      .line<SeriesPoint>()
      .x((p) => x(p.ts))
      .y((p) => y(p.value));
    const area = d3
      .area<SeriesPoint>()
      .x((p) => x(p.ts))
      .y0(height)
      .y1((p) => y(p.value));
    return { line: line(points as SeriesPoint[]) ?? "", area: area(points as SeriesPoint[]) ?? "" };
  }, [points, max, width, height]);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {paths && (
        <>
          <path d={paths.area} fill="currentColor" fillOpacity={0.12} />
          <path d={paths.line} fill="none" stroke="currentColor" strokeWidth={1.5} />
        </>
      )}
    </svg>
  );
}
