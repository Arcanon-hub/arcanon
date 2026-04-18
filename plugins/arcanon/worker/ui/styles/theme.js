/**
 * theme.js — Arcanon UI theme switcher.
 *
 * Resolves the active theme on load from (in priority order):
 *   1. localStorage("arcanon.theme")  — user preference set via toggle
 *   2. prefers-color-scheme media query
 *   3. "dark" fallback (the plugin's historical default)
 *
 * Exposes a CustomEvent "arcanon:theme" on document when the theme changes so
 * the canvas renderer can re-read color tokens from getComputedStyle and
 * trigger a redraw.
 */

const STORAGE_KEY = "arcanon.theme";
const THEMES = /** @type {const} */ (["light", "dark"]);

/**
 * Resolve the starting theme.
 * @returns {"light"|"dark"}
 */
export function resolveInitialTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch { /* privacy mode, etc. */ }
  if (window.matchMedia?.("(prefers-color-scheme: light)").matches) return "light";
  return "dark";
}

/**
 * Apply a theme to the document root and persist the choice.
 * @param {"light"|"dark"} theme
 */
export function applyTheme(theme) {
  if (!THEMES.includes(theme)) return;
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch { /* ignore */ }
  document.dispatchEvent(new CustomEvent("arcanon:theme", { detail: { theme } }));
}

/** Flip between light and dark. Returns the new theme. */
export function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme");
  const next = current === "light" ? "dark" : "light";
  applyTheme(next);
  return next;
}

/**
 * Read a CSS custom property as a color string. Used by the canvas renderer
 * so it can paint with the currently-active palette.
 *
 * @param {string} name  e.g. "--color-node-service"
 * @param {string} [fallback]
 * @returns {string}
 */
export function readToken(name, fallback = "#000000") {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** One-shot initialization — call from the entry script before any rendering. */
export function initTheme() {
  applyTheme(resolveInitialTheme());
  // React to system-level changes only when the user hasn't picked explicitly.
  try {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    mq.addEventListener?.("change", (e) => {
      if (localStorage.getItem(STORAGE_KEY)) return;
      applyTheme(e.matches ? "light" : "dark");
    });
  } catch { /* ignore */ }
}
