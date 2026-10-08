/**
 * @file sessionCpu.ts
 * @description When the per-session CPU tag shows. The value itself arrives already
 * smoothed by the server (the same ~20 s average as the Machine tile), so the client
 * only decides visibility, with hysteresis — like a thermostat — so the tag never
 * blinks around a single threshold while the session works in bursts. No React, no I/O.
 */

/** The tag appears once the session reaches this share of the machine… */
export const SESSION_CPU_SHOW_PERCENT = 1.5;
/** …and only hides again below this one. */
export const SESSION_CPU_HIDE_PERCENT = 0.5;

/** Whether the tag shows `value`, given whether it is shown right now. */
export function sessionCpuVisible(shown: boolean, value: number | null): boolean {
  if (value === null) return false;
  return value >= (shown ? SESSION_CPU_HIDE_PERCENT : SESSION_CPU_SHOW_PERCENT);
}
