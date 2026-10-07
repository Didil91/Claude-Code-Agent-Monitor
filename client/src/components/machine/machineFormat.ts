/**
 * @file machineFormat.ts
 * @description Locale-aware number formatting for the Machine mode — percentages,
 * temperatures, byte sizes and clock times — built on `Intl` so every supported
 * dashboard language gets its own separators and spacing (e.g. `20 %` in French).
 */

/** `12 %` / `12%` depending on the locale; `—` for a missing reading. */
export function formatPercent(value: number | null | undefined, lng: string, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(lng, {
    style: "percent",
    maximumFractionDigits: digits,
  }).format(value / 100);
}

/** `49 °C`; `—` for a missing reading. */
export function formatCelsius(value: number | null | undefined, lng: string): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(lng, {
    style: "unit",
    unit: "celsius",
    maximumFractionDigits: 0,
  }).format(value);
}

const BYTE_UNITS = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte"] as const;

/** Binary-scaled size (`412 MB`, `1.2 GB`) using the locale's unit names. */
export function formatBytes(bytes: number | null | undefined, lng: string): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "—";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return new Intl.NumberFormat(lng, {
    style: "unit",
    unit: BYTE_UNITS[unit],
    unitDisplay: "short",
    maximumFractionDigits: value >= 100 || unit === 0 ? 0 : 1,
  }).format(value);
}

/** `HH:MM` clock label for the time axis. */
export function formatClock(ts: number, lng: string): string {
  return new Date(ts).toLocaleTimeString(lng, { hour: "2-digit", minute: "2-digit" });
}

/** Plain integer (`12`). */
export function formatInteger(value: number, lng: string): string {
  return new Intl.NumberFormat(lng, { maximumFractionDigits: 0 }).format(value);
}
