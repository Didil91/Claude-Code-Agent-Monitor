/**
 * @file sessionCpu.ts
 * @description Pure display logic for the per-session CPU tag. Raw readings swing
 * every 5 s (a claude process idles on the API, then a build spikes), so the tag shows
 * a moving average of the last few process snapshots, and appears / disappears with
 * hysteresis — like a thermostat — so it never blinks around a single threshold.
 * No React, no I/O.
 */

/** Process snapshots averaged (one every 5 s on Windows → ~20 s). */
export const SESSION_CPU_SMOOTHING = 4;
/** The tag appears once the average reaches this share of the machine… */
export const SESSION_CPU_SHOW_PERCENT = 1.5;
/** …and only hides again below this one. */
export const SESSION_CPU_HIDE_PERCENT = 0.5;

export interface SessionCpuTrack {
  /** Timestamp of the last process snapshot taken into account. */
  ts: number | null;
  /** Latest readings, oldest first, at most `SESSION_CPU_SMOOTHING`. */
  readings: number[];
  visible: boolean;
}

export const EMPTY_SESSION_CPU_TRACK: SessionCpuTrack = { ts: null, readings: [], visible: false };

function average(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Fold one process snapshot into the track. `value` null means the server has no
 * reading for the session (process gone, link lost): the track starts over. A snapshot
 * already seen (same `ts`, repeated by every 2 s machine sample) changes nothing.
 */
export function trackSessionCpu(
  track: SessionCpuTrack,
  snapshot: { ts: number; value: number | null }
): SessionCpuTrack {
  if (snapshot.value === null) return EMPTY_SESSION_CPU_TRACK;
  if (track.ts !== null && snapshot.ts <= track.ts) return track;
  const readings = [...track.readings, snapshot.value].slice(-SESSION_CPU_SMOOTHING);
  const smoothed = average(readings);
  const visible = track.visible
    ? smoothed >= SESSION_CPU_HIDE_PERCENT
    : smoothed >= SESSION_CPU_SHOW_PERCENT;
  return { ts: snapshot.ts, readings, visible };
}

/** Value the tag shows, rounded to 0.1 — null while hidden. */
export function displayedSessionCpu(track: SessionCpuTrack): number | null {
  if (!track.visible || track.readings.length === 0) return null;
  return Math.round(average(track.readings) * 10) / 10;
}
