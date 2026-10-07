/**
 * @file prefs.ts
 * @description localStorage-backed preferences for Braise, the machine flame:
 * shown/hidden and its docked position. Same shapes as Tabby's store, separate
 * keys and event. The default position is picked against Tabby's current spot
 * so both companions never stack on first display.
 */

import { tabbyPrefs, type TabbyPos } from "../Tabby/prefs";

const ENABLED_KEY = "agent-dashboard-braise-enabled";
const POS_KEY = "agent-dashboard-braise-pos";
const EVENT = "braise:prefs";

function readEnabled(): boolean {
  try {
    const v = localStorage.getItem(ENABLED_KEY);
    return v === null ? true : v === "true";
  } catch {
    return true;
  }
}

function writeEnabled(value: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, String(value));
  } catch {
    // Best-effort, like Tabby's prefs (private mode, quota).
  }
  try {
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    // Non-DOM contexts: nothing to notify.
  }
}

function readPos(): TabbyPos | null {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<TabbyPos>;
    if ((p.side === "left" || p.side === "right") && typeof p.y === "number") {
      return { side: p.side, y: Math.min(1, Math.max(0, p.y)) };
    }
    return null;
  } catch {
    return null;
  }
}

function writePos(pos: TabbyPos): void {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(pos));
  } catch {
    // Best-effort.
  }
}

/**
 * First-display spot: Tabby's edge, at the far end of it — bottom when Tabby
 * sits in the upper half (its default is mid-right), top otherwise — so the
 * two are at least half the screen height apart.
 */
export function defaultBraisePos(tabby: TabbyPos | null = tabbyPrefs.getPos()): TabbyPos {
  const side = tabby?.side ?? "right";
  const tabbyY = tabby?.y ?? 0.5;
  return { side, y: tabbyY > 0.5 ? 0 : 1 };
}

export const braisePrefs = {
  getEnabled: readEnabled,
  setEnabled: writeEnabled,
  getPos: readPos,
  setPos: writePos,
  /** Subscribe to visibility changes (this tab and others); returns an unsubscribe fn. */
  subscribe(handler: () => void): () => void {
    const listener = () => handler();
    window.addEventListener(EVENT, listener);
    window.addEventListener("storage", listener);
    return () => {
      window.removeEventListener(EVENT, listener);
      window.removeEventListener("storage", listener);
    };
  },
};
