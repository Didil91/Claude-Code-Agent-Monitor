/**
 * @file theme.test.ts
 * @description Unit tests for the theme helpers: preference parsing, System /
 * Light / Dark resolution, localStorage persistence, and the attributes applied
 * to the document element.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_THEME_PREFERENCE,
  THEME_STORAGE_KEY,
  applyTheme,
  getThemePreference,
  parseThemePreference,
  resolveTheme,
  setThemePreference,
  subscribeToTheme,
} from "../theme";

function mockSystemLight(light: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: light,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
}

describe("parseThemePreference", () => {
  it("accepts the three valid values", () => {
    expect(parseThemePreference("system")).toBe("system");
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
  });

  it("falls back to the dark default for anything else", () => {
    expect(DEFAULT_THEME_PREFERENCE).toBe("dark");
    expect(parseThemePreference(null)).toBe("dark");
    expect(parseThemePreference("")).toBe("dark");
    expect(parseThemePreference("Light")).toBe("dark");
    expect(parseThemePreference(42)).toBe("dark");
  });
});

describe("resolveTheme", () => {
  it("returns explicit choices regardless of the OS", () => {
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("dark", true)).toBe("dark");
  });

  it("follows the OS for system", () => {
    expect(resolveTheme("system", true)).toBe("light");
    expect(resolveTheme("system", false)).toBe("dark");
  });
});

describe("persistence and application", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.className = "";
    mockSystemLight(false);
  });

  it("defaults to dark when nothing is stored", () => {
    expect(getThemePreference()).toBe("dark");
  });

  it("ignores a corrupt stored value", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "purple");
    expect(getThemePreference()).toBe("dark");
  });

  it("persists, applies and notifies on set", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToTheme(listener);
    setThemePreference("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(getThemePreference()).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setThemePreference("dark");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("applies the OS theme for system", () => {
    mockSystemLight(true);
    expect(applyTheme("system")).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    mockSystemLight(false);
    expect(applyTheme("system")).toBe("dark");
  });
});
