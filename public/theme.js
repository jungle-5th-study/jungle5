// Runs before first paint (blocking <script src> in <head>; allowed by CSP
// script-src 'self'). Keep in sync with src/web/lib/theme.ts — a test checks it.
(function () {
  try {
    var t = window.localStorage.getItem("jungle5:theme");
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
  } catch {
    // Storage unavailable: follow the system setting (CSS prefers-color-scheme).
  }
})();
