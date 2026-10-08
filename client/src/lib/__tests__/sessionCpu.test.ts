/**
 * @file sessionCpu.test.ts
 * @description Tests when the per-session CPU tag shows: hidden while idle, shown once
 * busy enough, kept between the two thresholds (no blinking), hidden without reading.
 */

import { describe, it, expect } from "vitest";
import { sessionCpuVisible } from "../sessionCpu";

describe("sessionCpuVisible", () => {
  it("shows a hidden tag only once the session is busy enough", () => {
    expect(sessionCpuVisible(false, 0.3)).toBe(false);
    expect(sessionCpuVisible(false, 1)).toBe(false);
    expect(sessionCpuVisible(false, 1.5)).toBe(true);
  });

  it("keeps a shown tag until the session is nearly idle", () => {
    expect(sessionCpuVisible(true, 1)).toBe(true);
    expect(sessionCpuVisible(true, 0.5)).toBe(true);
    expect(sessionCpuVisible(true, 0.4)).toBe(false);
  });

  it("hides without a reading", () => {
    expect(sessionCpuVisible(true, null)).toBe(false);
  });
});
