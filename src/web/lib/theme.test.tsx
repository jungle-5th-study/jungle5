import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bootScript from "../../../public/theme.js?raw";
import { ThemeToggle } from "../components/ThemeToggle";
import {
  applyThemePref,
  initTheme,
  nextThemePref,
  readThemePref,
  resetThemeStoreForTests,
  setThemePref,
  THEME_STORAGE_KEY,
} from "./theme";

const root = document.documentElement;

beforeEach(() => {
  resetThemeStoreForTests();
  root.removeAttribute("data-theme");
});
afterEach(() => {
  root.removeAttribute("data-theme");
});

describe("theme preference (UD-04)", () => {
  it("cycles system → light → dark → system", () => {
    expect(nextThemePref("system")).toBe("light");
    expect(nextThemePref("light")).toBe("dark");
    expect(nextThemePref("dark")).toBe("system");
  });

  it("applies a stored value to <html> on init", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    expect(initTheme()).toBe("dark");
    expect(root.getAttribute("data-theme")).toBe("dark");
  });

  it("leaves <html> alone when nothing (or garbage) is stored so CSS follows the OS", () => {
    expect(initTheme()).toBe("system");
    expect(root.hasAttribute("data-theme")).toBe(false);
    localStorage.setItem(THEME_STORAGE_KEY, "purple");
    expect(readThemePref()).toBe("system");
  });

  it("stores light/dark and removes the key for system", () => {
    setThemePref("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(root.getAttribute("data-theme")).toBe("light");
    setThemePref("system");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(root.hasAttribute("data-theme")).toBe(false);
  });

  it("does not crash when storage throws; the choice still applies to the page", () => {
    const boom = () => {
      throw new DOMException("denied", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(boom);
    expect(readThemePref()).toBe("system");
    expect(initTheme()).toBe("system");
    expect(() => setThemePref("dark")).not.toThrow();
    expect(root.getAttribute("data-theme")).toBe("dark");
    vi.restoreAllMocks();
    vi.spyOn(window, "localStorage", "get").mockImplementation(boom);
    expect(readThemePref()).toBe("system");
    expect(() => setThemePref("light")).not.toThrow();
  });

  it("applyThemePref sets and clears the attribute", () => {
    applyThemePref("light");
    expect(root.getAttribute("data-theme")).toBe("light");
    applyThemePref("system");
    expect(root.hasAttribute("data-theme")).toBe(false);
  });

  it("the header toggle cycles and persists", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    const btn = screen.getByRole("button", { name: /테마: 시스템 설정/ });
    await user.click(btn);
    expect(screen.getByRole("button", { name: /테마: 라이트/ })).toBeInTheDocument();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    await user.click(screen.getByRole("button", { name: /테마: 라이트/ }));
    expect(root.getAttribute("data-theme")).toBe("dark");
    act(() => setThemePref("system"));
    expect(screen.getByRole("button", { name: /테마: 시스템 설정/ })).toBeInTheDocument();
  });
});

describe("public/theme.js (blocking boot script)", () => {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- runs the shipped file as the browser would
  const run = new Function(bootScript) as () => void;

  it("uses the same storage key and values as lib/theme.ts", () => {
    expect(bootScript).toContain(`"${THEME_STORAGE_KEY}"`);
  });

  it("applies a stored light/dark choice and ignores anything else", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    run();
    expect(root.getAttribute("data-theme")).toBe("dark");
    root.removeAttribute("data-theme");
    localStorage.setItem(THEME_STORAGE_KEY, "<script>");
    run();
    expect(root.hasAttribute("data-theme")).toBe(false);
  });

  it("does not throw when storage is unavailable", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(run).not.toThrow();
    expect(root.hasAttribute("data-theme")).toBe(false);
  });
});
