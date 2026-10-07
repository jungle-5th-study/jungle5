// public/theme.js already set html[data-theme] before first paint (blocking
// script in <head>). This re-applies the same choice from the module entry
// (no-op if unchanged) and primes the React theme store.
import { initTheme } from "./theme";

initTheme();
