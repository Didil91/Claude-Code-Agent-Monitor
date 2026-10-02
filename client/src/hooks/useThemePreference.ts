/**
 * @file useThemePreference.ts
 * @description React binding for the theme preference in `lib/theme.ts`: returns
 * the current preference and a setter, staying in sync across components
 * (Settings, command palette) via `useSyncExternalStore`.
 */

import { useSyncExternalStore } from "react";
import {
  getThemePreference,
  setThemePreference,
  subscribeToTheme,
  type ThemePreference,
} from "../lib/theme";

export function useThemePreference(): [ThemePreference, (preference: ThemePreference) => void] {
  const preference = useSyncExternalStore(subscribeToTheme, getThemePreference, getThemePreference);
  return [preference, setThemePreference];
}
