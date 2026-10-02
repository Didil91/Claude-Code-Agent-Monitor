/**
 * @file tailwind.config.js
 * @description Tailwind CSS configuration — content globs and the dashboard's design tokens, which read CSS variables (see index.css) so the Dark and Light themes share one set of class names.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import plugin from "tailwindcss/plugin";
import twColors from "tailwindcss/colors";

const rgb = (name) => `rgb(var(--${name}) / <alpha-value>)`;
const grayShades = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

// Light theme: the 100-400 shades of the status hues are tuned for dark
// surfaces; darken them so coloured text keeps contrast on light panels.
const LIGHT_HUES = [
  "red",
  "emerald",
  "green",
  "amber",
  "yellow",
  "orange",
  "blue",
  "sky",
  "cyan",
  "teal",
  "indigo",
  "violet",
  "purple",
  "pink",
  "rose",
  "fuchsia",
  "lime",
];
const LIGHT_SHADE_MAP = { 100: 900, 200: 800, 300: 700, 400: 600 };

const lightThemePlugin = plugin(({ addBase }) => {
  const rules = {};
  for (const hue of LIGHT_HUES) {
    for (const [from, to] of Object.entries(LIGHT_SHADE_MAP)) {
      rules[`[data-theme="light"] .text-${hue}-${from}`] = { color: twColors[hue][to] };
    }
  }
  addBase(rules);
});

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: Object.fromEntries([0, 1, 2, 3, 4, 5].map((n) => [n, rgb(`surface-${n}`)])),
        border: {
          DEFAULT: rgb("border"),
          light: rgb("border-light"),
        },
        accent: {
          DEFAULT: rgb("accent"),
          hover: rgb("accent-hover"),
          muted: "rgba(99, 102, 241, 0.15)",
        },
        tip: {
          bg: rgb("tip-bg"),
          border: rgb("tip-border"),
        },
        gray: Object.fromEntries(grayShades.map((n) => [n, rgb(`gray-${n}`)])),
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "Consolas", "monospace"],
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fadeIn 0.3s ease-out",
        "slide-up": "slideUp 0.3s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [lightThemePlugin],
};
