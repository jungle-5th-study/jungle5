import { nextThemePref, THEME_LABELS, THEME_ORDER, useThemePref, type ThemePref } from "../lib/theme";
import { MonitorIcon, MoonIcon, SunIcon } from "./icons";
import { btn } from "./ui";

const ICONS: Record<ThemePref, typeof SunIcon> = { system: MonitorIcon, light: SunIcon, dark: MoonIcon };

/** Header toggle: system → light → dark (docs/ui.md 6). */
export function ThemeToggle() {
  const [pref, setPref] = useThemePref();
  const next = nextThemePref(pref);
  const Icon = ICONS[pref];
  return (
    <button
      type="button"
      className={`${btn.icon} border border-border`}
      aria-label={`테마: ${THEME_LABELS[pref]} (누르면 ${THEME_LABELS[next]})`}
      title={`테마: ${THEME_LABELS[pref]}`}
      onClick={() => setPref(next)}
    >
      <Icon />
    </button>
  );
}

/** Segmented control for /me. */
export function ThemeSetting() {
  const [pref, setPref] = useThemePref();
  return (
    <fieldset>
      <legend className="sr-only">테마</legend>
      <div className="inline-flex rounded-lg border border-border p-0.5">
        {THEME_ORDER.map((p) => {
          const Icon = ICONS[p];
          return (
            <label
              key={p}
              className={`inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-md px-3 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
                pref === p ? "bg-accent-subtle font-semibold text-accent-subtle-text" : "text-muted hover:text-text"
              }`}
            >
              <input
                type="radio"
                name="theme"
                value={p}
                checked={pref === p}
                onChange={() => setPref(p)}
                className="sr-only"
              />
              <Icon />
              {THEME_LABELS[p]}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
