// Theme preference (UD-04, docs/ui.md 6 ThemeToggle). "system" follows
// prefers-color-scheme in CSS; "light"/"dark" set html[data-theme]. The choice
// is kept in localStorage; every access is wrapped because storage can throw
// (private mode, disabled site data) — then the system setting is used.
import { useSyncExternalStore } from "react";

export type ThemePref = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "jungle5:theme";
export const THEME_ORDER: readonly ThemePref[] = ["system", "light", "dark"];

export const THEME_LABELS: Record<ThemePref, string> = {
  system: "시스템 설정",
  light: "라이트",
  dark: "다크",
};

function isThemePref(v: unknown): v is ThemePref {
  return v === "system" || v === "light" || v === "dark";
}

/** system → light → dark → system. */
export function nextThemePref(current: ThemePref): ThemePref {
  return THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length]!;
}

export function readThemePref(): ThemePref {
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePref(v) ? v : "system";
  } catch {
    return "system";
  }
}

/** Returns false when the choice could not be stored (it still applies to this page). */
function writeThemePref(pref: ThemePref): boolean {
  try {
    if (pref === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, pref);
    return true;
  } catch {
    return false;
  }
}

export function applyThemePref(pref: ThemePref, root: HTMLElement = document.documentElement): void {
  if (pref === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", pref);
}

// --- store for React -------------------------------------------------------

let current: ThemePref | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): ThemePref {
  current ??= readThemePref();
  return current;
}

function emit(pref: ThemePref) {
  current = pref;
  applyThemePref(pref);
  for (const l of listeners) l();
}

/** Called first thing from the module entry: applies the stored choice before React renders. */
export function initTheme(): ThemePref {
  const pref = readThemePref();
  current = pref;
  applyThemePref(pref);
  return pref;
}

export function setThemePref(pref: ThemePref): void {
  writeThemePref(pref);
  emit(pref);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Other tabs changing the theme.
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_STORAGE_KEY || e.key === null) emit(readThemePref());
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useThemePref(): [ThemePref, (pref: ThemePref) => void] {
  const pref = useSyncExternalStore(subscribe, getSnapshot, () => "system" as const);
  return [pref, setThemePref];
}

/** Test helper: forget the cached preference. */
export function resetThemeStoreForTests(): void {
  current = null;
}
