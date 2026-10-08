/**
 * @file SessionCpu.test.tsx
 * @description Tests the per-session CPU badge: hidden without a reading, value with
 * one decimal coloured by the CPU thresholds, live wiring to `machine.sample` for its
 * own session only, and its strings in every dashboard language.
 */

import { describe, it, expect, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import i18n from "i18next";
import { SessionCpu, SessionCpuView } from "../SessionCpu";
import { eventBus } from "../../../lib/eventBus";
import type { WSMessage } from "../../../lib/types";

const sampleWith = (cpuBySession: Record<string, number>) =>
  ({
    type: "machine.sample",
    data: {
      sample: { ts: 1, cpu: null, ram: null, disk: null, volume: null, gpu: null },
      processes: { ts: 1, cores: 8, items: [], cpuBySession },
      status: null,
    },
    timestamp: "",
  }) as unknown as WSMessage;

describe("SessionCpuView", () => {
  it("renders nothing without a reading", () => {
    const { container } = render(<SessionCpuView value={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the value with one decimal and a threshold level", () => {
    render(<SessionCpuView value={4.25} />);
    const badge = screen.getByTestId("session-cpu");
    expect(badge.textContent).toMatch(/4[.,]3\s?%/);
    expect(badge).toHaveAttribute("data-level", "normal");
  });

  it("flags a heavy session", () => {
    render(<SessionCpuView value={95} />);
    expect(screen.getByTestId("session-cpu")).toHaveAttribute("data-level", "crit");
  });
});

describe("SessionCpu", () => {
  afterEach(() => {
    act(() => eventBus.setConnected(true));
  });

  it("follows its own session's reading from live samples", () => {
    render(<SessionCpu sessionId="s1" />);
    expect(screen.queryByTestId("session-cpu")).toBeNull();

    act(() => eventBus.publish(sampleWith({ s2: 40 })));
    expect(screen.queryByTestId("session-cpu")).toBeNull();

    act(() => eventBus.publish(sampleWith({ s1: 12 })));
    expect(screen.getByTestId("session-cpu").textContent).toMatch(/12/);
  });
});

describe("SessionCpu strings", () => {
  it("exist in every dashboard language", () => {
    for (const lng of ["en", "fr", "es", "ko", "vi", "zh"]) {
      expect(i18n.exists("dashboard:machine.sessionCpu.title", { lng })).toBe(true);
      expect(i18n.exists("dashboard:machine.sessionCpu.label", { lng })).toBe(true);
    }
    expect(
      i18n.getFixedT("fr", "dashboard")("machine.sessionCpu.label", { value: "3 %" })
    ).toContain("3 %");
  });
});
