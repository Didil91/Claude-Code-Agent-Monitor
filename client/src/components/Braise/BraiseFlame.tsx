/**
 * @file BraiseFlame.tsx
 * @description Braise's SVG body. One drawing for all four looks: `data-state`
 * (idle / normal / warn / crit) drives size, colours and the CSS flicker in
 * `braise.css`. Idle shows closed eyes and a "z", crit adds rising sparks.
 * Animation stops under `prefers-reduced-motion` or `reducedMotion`.
 */

import type { BraiseState } from "./braiseState";

interface BraiseFlameProps {
  state: BraiseState;
  reducedMotion?: boolean;
  size?: number;
  /** Accessible name of the drawing. */
  label: string;
}

export function BraiseFlame({ state, reducedMotion = false, size = 48, label }: BraiseFlameProps) {
  return (
    <svg
      className="braise-flame"
      data-state={state}
      data-reduced={reducedMotion ? "1" : "0"}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={label}
    >
      <ellipse className="braise-glow" cx="50" cy="88" rx="30" ry="7" />
      <g className="braise-body">
        <path
          className="braise-outer"
          d="M50 6 C56 22 70 30 76 46 C82 62 78 82 64 90 C56 95 44 95 36 90 C22 82 18 62 26 46 C30 38 36 34 38 24 C44 32 46 38 46 44 C50 34 52 22 50 6 Z"
        />
        <path
          className="braise-inner"
          d="M50 40 C54 50 64 56 64 70 C64 82 58 88 50 88 C42 88 36 82 36 70 C36 62 42 58 44 50 C46 56 48 58 50 60 C52 54 52 48 50 40 Z"
        />
        <g className="braise-eyes-open">
          <ellipse className="braise-eye" cx="43" cy="72" rx="3" ry="4" />
          <ellipse className="braise-eye" cx="57" cy="72" rx="3" ry="4" />
        </g>
        <g className="braise-eyes-closed">
          <path className="braise-lid" d="M39 72 Q43 75 47 72" />
          <path className="braise-lid" d="M53 72 Q57 75 61 72" />
        </g>
      </g>
      <g className="braise-sparks">
        <circle cx="28" cy="40" r="2.5" />
        <circle cx="72" cy="34" r="2" />
        <circle cx="62" cy="18" r="1.8" />
      </g>
      <text className="braise-zzz" x="70" y="34">
        z
      </text>
    </svg>
  );
}
