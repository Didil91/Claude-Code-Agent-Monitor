/**
 * @file Braise.test.tsx
 * @description Component tests for Braise, the machine flame: its look follows
 * live `machine.sample` messages, the red-zone alert bubble, the summary card
 * (metrics, active agents, heaviest process, Machine-mode shortcut), the
 * Settings visibility preference, and the remembered docked position.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import i18n from "i18next";
import { Braise, BRAISE_SIZE } from "../Braise";
import { braisePrefs } from "../prefs";
import { TABBY_MARGIN } from "../../Tabby/useTabbyPosition";
import { api } from "../../../lib/api";
import { eventBus } from "../../../lib/eventBus";
import type {
  MachineProcesses,
  MachineSample,
  MachineSnapshot,
  MachineStatus,
  Stats,
  WSMessage,
} from "../../../lib/types";

const STATUS: MachineStatus = { sensor: "ok", gpu: "ok", sensorError: null, retryInMs: null };

let nextTs = 10_000;
function sample(cpu: number, ram = 40, disk = 5, gpuTemp = 50): MachineSample {
  nextTs += 2000;
  return {
    ts: nextTs,
    cpu: { percent: cpu, source: "cim" },
    ram: { usedBytes: 4, totalBytes: 10, percent: ram },
    disk: { activePercent: disk, readBytesPerSec: 0, writeBytesPerSec: 0 },
    volume: null,
    gpu: {
      index: 0,
      utilPercent: 39,
      memUsedMiB: 1,
      memTotalMiB: 2,
      memPercent: 50,
      temperatureC: gpuTemp,
      lowPower: false,
    },
  };
}

const PROCESSES: MachineProcesses = {
  ts: 1,
  cores: 8,
  items: [
    { name: "node", pid: 1, parentPid: null, cpuPercent: 4, memoryBytes: 100 },
    { name: "chrome", pid: 2, parentPid: null, cpuPercent: 18.5, memoryBytes: 50 },
  ],
};

function snapshot(samples: MachineSample[]): MachineSnapshot {
  return {
    platform: "win32",
    cores: 8,
    intervalMs: 2000,
    processIntervalMs: 5000,
    windowMs: 300_000,
    status: STATUS,
    samples,
    processes: PROCESSES,
  };
}

function publishSample(s: MachineSample) {
  act(() => {
    eventBus.publish({
      type: "machine.sample",
      data: { sample: s, processes: PROCESSES, status: STATUS },
      timestamp: "",
    } as WSMessage);
  });
}

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

function renderBraise() {
  return render(
    <MemoryRouter initialEntries={["/sessions"]}>
      <Braise />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
}

const flame = () => screen.getByRole("img", { name: /braise/i });
const button = () => screen.getByRole("button", { name: /braise/i });

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.spyOn(api.machine, "get").mockResolvedValue(snapshot([sample(25)]));
  vi.spyOn(api.stats, "get").mockResolvedValue({ active_agents: 3 } as Stats);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Braise state", () => {
  it("follows the thresholds as live samples arrive", async () => {
    renderBraise();
    await waitFor(() => expect(flame()).toHaveAttribute("data-state", "normal"));

    publishSample(sample(4));
    expect(flame()).toHaveAttribute("data-state", "idle");

    publishSample(sample(75));
    expect(flame()).toHaveAttribute("data-state", "warn");

    publishSample(sample(30, 40, 97));
    expect(flame()).toHaveAttribute("data-state", "crit");
  });

  it("shows a red-zone alert bubble that can be dismissed", async () => {
    renderBraise();
    await waitFor(() => expect(flame()).toHaveAttribute("data-state", "normal"));
    expect(screen.queryByRole("alert")).toBeNull();

    publishSample(sample(30, 40, 97));
    const bubble = screen.getByRole("alert");
    expect(bubble).toHaveTextContent("The disk is at 97%");

    fireEvent.click(bubble);
    expect(screen.queryByRole("alert")).toBeNull();
    // Still red: stays dismissed.
    publishSample(sample(30, 40, 98));
    expect(screen.queryByRole("alert")).toBeNull();
    // Back to calm, then red again: the bubble returns.
    publishSample(sample(30));
    publishSample(sample(95));
    expect(screen.getByRole("alert")).toHaveTextContent("The CPU is at 95%");
  });

  it("words the alert in French", async () => {
    await i18n.changeLanguage("fr");
    renderBraise();
    await waitFor(() => expect(flame()).toHaveAttribute("data-state", "normal"));
    publishSample(sample(30, 40, 97));
    expect(screen.getByRole("alert").textContent).toMatch(/^Le disque est à 97\s%$/);
  });
});

describe("Braise summary card", () => {
  it("opens on click with metrics, active agents and heaviest process", async () => {
    renderBraise();
    await waitFor(() => expect(flame()).toHaveAttribute("data-state", "normal"));
    publishSample(sample(72, 51, 2, 49));

    fireEvent.click(button());
    const card = screen.getByRole("dialog", { name: "Machine summary" });
    expect(card).toBeInTheDocument();
    expect(screen.getByTestId("braise-cpu")).toHaveTextContent("72%");
    expect(screen.getByTestId("braise-cpu")).toHaveAttribute("data-level", "warn");
    expect(screen.getByTestId("braise-ram")).toHaveTextContent("51%");
    expect(screen.getByTestId("braise-disk")).toHaveTextContent("2%");
    expect(screen.getByTestId("braise-gpu")).toHaveTextContent("39% · 49°C");
    expect(screen.getByTestId("braise-top-process")).toHaveTextContent("chrome");
    expect(screen.getByTestId("braise-top-process")).toHaveTextContent("18.5%");
    await waitFor(() => expect(screen.getByTestId("braise-agents")).toHaveTextContent("3"));
  });

  it("opens the Machine mode from the card", async () => {
    renderBraise();
    await waitFor(() => expect(flame()).toHaveAttribute("data-state", "normal"));
    fireEvent.click(button());
    fireEvent.click(screen.getByRole("button", { name: /open machine mode/i }));
    expect(screen.getByTestId("where")).toHaveTextContent("/?tab=machine");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes with Escape", async () => {
    renderBraise();
    await waitFor(() => expect(flame()).toHaveAttribute("data-state", "normal"));
    fireEvent.click(button());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Braise preferences", () => {
  it("renders nothing while hidden and reacts to the Settings toggle", async () => {
    braisePrefs.setEnabled(false);
    renderBraise();
    expect(screen.queryByRole("img", { name: /braise/i })).toBeNull();
    expect(api.machine.get).not.toHaveBeenCalled();

    act(() => braisePrefs.setEnabled(true));
    await waitFor(() => expect(flame()).toBeInTheDocument());

    act(() => braisePrefs.setEnabled(false));
    expect(screen.queryByRole("img", { name: /braise/i })).toBeNull();
    expect(localStorage.getItem("agent-dashboard-braise-enabled")).toBe("false");
  });

  it("restores its remembered dock, separate from Tabby's", () => {
    localStorage.setItem("agent-dashboard-braise-pos", JSON.stringify({ side: "left", y: 0 }));
    renderBraise();
    expect(button().style.left).toBe(`${TABBY_MARGIN}px`);
    expect(button().style.top).toBe(`${TABBY_MARGIN}px`);
    expect(button().style.width).toBe(`${BRAISE_SIZE}px`);
  });

  it("first shows at the bottom of Tabby's edge, away from the centred cat", () => {
    renderBraise();
    expect(button().style.left).toBe(`${window.innerWidth - BRAISE_SIZE - TABBY_MARGIN}px`);
    expect(button().style.top).toBe(`${window.innerHeight - BRAISE_SIZE - TABBY_MARGIN}px`);
  });

  it("persists a drag without opening the card", () => {
    renderBraise();
    const btn = button();
    act(() => {
      fireEvent.pointerDown(btn, { clientX: 990, clientY: 700, button: 0 });
      fireEvent.pointerMove(btn, { clientX: 60, clientY: 40 });
      fireEvent.pointerUp(btn, { clientX: 60, clientY: 40 });
    });
    fireEvent.click(btn);
    expect(screen.queryByRole("dialog")).toBeNull();
    const saved = JSON.parse(localStorage.getItem("agent-dashboard-braise-pos") ?? "null");
    expect(saved.side).toBe("left");
    expect(localStorage.getItem("agent-dashboard-tabby-pos")).toBeNull();
  });
});
