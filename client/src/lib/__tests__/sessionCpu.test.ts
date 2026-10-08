/**
 * @file sessionCpu.test.ts
 * @description Tests the per-session CPU tag logic: moving average over the last
 * snapshots, show/hide hysteresis (no blinking around one threshold), repeated
 * snapshots ignored, and a lost reading starting over.
 */

import { describe, it, expect } from "vitest";
import {
  EMPTY_SESSION_CPU_TRACK,
  SESSION_CPU_SMOOTHING,
  displayedSessionCpu,
  trackSessionCpu,
  type SessionCpuTrack,
} from "../sessionCpu";

/** Feed readings as successive snapshots (ts 1, 2, 3…). */
function feed(values: Array<number | null>, from: SessionCpuTrack = EMPTY_SESSION_CPU_TRACK) {
  return values.reduce<SessionCpuTrack>(
    (track, value, i) => trackSessionCpu(track, { ts: (from.ts ?? 0) + i + 1, value }),
    from
  );
}

describe("session CPU tag logic", () => {
  it("stays hidden while the session idles", () => {
    expect(displayedSessionCpu(feed([0, 0.3, 1.2, 0.4]))).toBeNull();
  });

  it("shows the average of the last snapshots once it is busy enough", () => {
    const track = feed([0, 0, 2, 8, 10]);
    expect(track.readings).toHaveLength(SESSION_CPU_SMOOTHING);
    expect(displayedSessionCpu(track)).toBe(5); // (0 + 2 + 8 + 10) / 4
  });

  it("smooths a single spike instead of jumping to it", () => {
    expect(displayedSessionCpu(feed([1, 1, 1, 9]))).toBe(3);
  });

  it("keeps the tag between the two thresholds, hides it below the low one", () => {
    const shown = feed([2, 2, 2, 2]);
    expect(displayedSessionCpu(shown)).toBe(2);
    const settling = feed([1, 1, 1, 1], shown); // average 1: under show, above hide
    expect(displayedSessionCpu(settling)).toBe(1);
    const idle = feed([0, 0, 0, 0], settling);
    expect(displayedSessionCpu(idle)).toBeNull();
  });

  it("does not show a session sitting between the thresholds from hidden", () => {
    expect(displayedSessionCpu(feed([1, 1, 1, 1]))).toBeNull();
  });

  it("ignores a snapshot it has already seen", () => {
    const track = feed([4]);
    expect(trackSessionCpu(track, { ts: track.ts!, value: 90 })).toBe(track);
  });

  it("starts over when the reading is lost", () => {
    const lost = trackSessionCpu(feed([5, 5]), { ts: 10, value: null });
    expect(lost).toEqual(EMPTY_SESSION_CPU_TRACK);
    expect(displayedSessionCpu(lost)).toBeNull();
  });
});
