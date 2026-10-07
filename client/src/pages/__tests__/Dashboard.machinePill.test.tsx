/**
 * @file Dashboard.machinePill.test.tsx
 * @description Integration test for the machine-metrics pill in the Dashboard
 * header: it stays hidden until a `machine.sample` WebSocket message arrives,
 * then shows the live readings, and clicking it switches to the Machine tab
 * (`?tab=machine`).
 */

import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { Dashboard } from "../Dashboard";
import { eventBus } from "../../lib/eventBus";
import type { MachineSample, WSMessage } from "../../lib/types";

// jsdom lacks the responsive-layout API the Dashboard observes.
class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
globalThis.ResizeObserver =
  globalThis.ResizeObserver || (ObserverStub as unknown as typeof ResizeObserver);

vi.mock("../../lib/api", () => ({
  api: {
    stats: {
      get: vi.fn(() =>
        Promise.resolve({
          total_sessions: 0,
          active_sessions: 0,
          active_agents: 0,
          total_agents: 0,
          total_events: 0,
          events_today: 0,
          ws_connections: 0,
          agents_by_status: {},
          sessions_by_status: {},
        })
      ),
    },
    agents: { list: vi.fn(() => Promise.resolve({ agents: [] })) },
    events: { list: vi.fn(() => Promise.resolve({ events: [], total: 0 })) },
    pricing: { totalCost: vi.fn(() => Promise.resolve({ total_cost: 0 })) },
    sessions: { list: vi.fn(() => Promise.resolve({ sessions: [] })) },
    settings: { info: vi.fn(() => Promise.resolve({})) },
    workflows: { get: vi.fn(() => Promise.resolve({})) },
    machine: { get: vi.fn(() => new Promise(() => {})) },
  },
}));

const SAMPLE: MachineSample = {
  ts: 1000,
  cpu: { percent: 20, source: "cim" },
  ram: { usedBytes: 17e9, totalBytes: 34e9, percent: 51 },
  disk: { activePercent: 2, readBytesPerSec: 0, writeBytesPerSec: 0 },
  volume: null,
  gpu: null,
};

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.search}</div>;
}

describe("Dashboard - machine metrics pill", () => {
  it("shows live readings and opens the Machine tab on click", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Dashboard />
        <LocationProbe />
      </MemoryRouter>
    );
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByTestId("machine-pill")).toBeNull();

    act(() => {
      eventBus.publish({
        type: "machine.sample",
        data: {
          sample: SAMPLE,
          processes: null,
          status: { sensor: "ok", gpu: "absent", sensorError: null, retryInMs: null },
        },
        timestamp: "",
      } as WSMessage);
    });

    const pill = await screen.findByTestId("machine-pill");
    expect(pill.textContent).toMatch(/CPU\s*20/);
    expect(screen.queryByTestId("machine-pill-gpu")).toBeNull();

    fireEvent.click(pill);
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toContain("tab=machine")
    );
  });
});
