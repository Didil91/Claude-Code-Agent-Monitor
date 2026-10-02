/**
 * @file theme.ts
 * @description Colour-theme preference for the dashboard: System / Light / Dark.
 * Holds the pure resolution helpers (`parseThemePreference`, `resolveTheme`),
 * persists the user's choice to `localStorage["theme"]` (defaulting to the
 * original dark look), applies the resolved theme to `<html>` as `data-theme`,
 * the `dark` class and `color-scheme`, and follows `prefers-color-scheme` live
 * while the preference is "system". The inline script in `index.html` mirrors
 * `resolveTheme` so the first paint already uses the right palette.
 */

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "theme";
export const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];
/** Dark is the dashboard's original look, so it stays the default. */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "dark";

const LIGHT_QUERY = "(prefers-color-scheme: light)";

/** Coerce any stored value into a valid preference, falling back to the default. */
export function parseThemePreference(raw: unknown): ThemePreference {
  return raw === "system" || raw === "light" || raw === "dark" ? raw : DEFAULT_THEME_PREFERENCE;
}

/** Turn a preference into the concrete theme to render. */
export function resolveTheme(
  preference: ThemePreference,
  systemPrefersLight: boolean
): ResolvedTheme {
  if (preference === "system") return systemPrefersLight ? "light" : "dark";
  return preference;
}

function systemPrefersLight(): boolean {
  try {
    return typeof window !== "undefined" && !!window.matchMedia?.(LIGHT_QUERY).matches;
  } catch {
    return false;
  }
}

/** Read the persisted preference; storage failures yield the default. */
export function getThemePreference(): ThemePreference {
  try {
    return parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

/** Write the resolved theme onto the document element. */
export function applyTheme(
  preference: ThemePreference,
  root: HTMLElement = document.documentElement
): ResolvedTheme {
  const resolved = resolveTheme(preference, systemPrefersLight());
  root.setAttribute("data-theme", resolved);
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
  return resolved;
}

const listeners = new Set<() => void>();

/** Subscribe to preference changes made through `setThemePreference`. */
export function subscribeToTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Persist and apply a new preference, then notify subscribers. */
export function setThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    /* storage can be blocked; the theme still applies for this page load */
  }
  applyTheme(preference);
  listeners.forEach((listener) => listener());
}

/** Apply the stored theme and track OS changes while "system" is selected. */
export function initTheme(): void {
  applyTheme(getThemePreference());
  try {
    const mql = window.matchMedia?.(LIGHT_QUERY);
    mql?.addEventListener?.("change", () => {
      if (getThemePreference() === "system") applyTheme("system");
    });
  } catch {
    /* matchMedia unavailable */
  }
}
