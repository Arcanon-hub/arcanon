/**
 * a11y.js — Accessibility utilities for the Arcanon graph UI.
 *
 * Exposes a single announce() function that writes to an aria-live region.
 * Debounced so rapid updates (e.g. scan progress) don't flood assistive tech.
 *
 * The live region lives at #a11y-live in index.html. announce() no-ops when
 * it isn't present so tests and SSR-ish callers don't crash.
 */

let _lastMsg = "";
let _timer = null;
const DEBOUNCE_MS = 120;

/**
 * Queue a message for the next debounce tick. Duplicate consecutive messages
 * are dropped.
 *
 * @param {string} msg
 * @param {"polite" | "assertive"} [politeness="polite"]
 */
export function announce(msg, politeness = "polite") {
  if (typeof document === "undefined") return;
  if (msg === _lastMsg) return;
  _lastMsg = msg;

  clearTimeout(_timer);
  _timer = setTimeout(() => {
    const region =
      document.getElementById("a11y-live-" + politeness) ||
      document.getElementById("a11y-live");
    if (!region) return;
    // Clearing then re-setting makes screen readers re-announce the same
    // text if it's repeated later (e.g. "scan complete" twice in a session).
    region.textContent = "";
    region.textContent = msg;
  }, DEBOUNCE_MS);
}

/**
 * Focus trap for a modal-like container — captures Tab / Shift+Tab so focus
 * stays inside `container` while it's open. Returns a cleanup function that
 * removes the listener.
 *
 * @param {HTMLElement} container
 * @returns {() => void}
 */
export function trapFocus(container) {
  if (!container) return () => {};
  const FOCUSABLE = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
  ].join(",");

  const onKeyDown = (e) => {
    if (e.key !== "Tab") return;
    const targets = Array.from(container.querySelectorAll(FOCUSABLE));
    if (targets.length === 0) return;
    const first = targets[0];
    const last = targets[targets.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      last.focus();
      e.preventDefault();
    } else if (!e.shiftKey && document.activeElement === last) {
      first.focus();
      e.preventDefault();
    }
  };
  container.addEventListener("keydown", onKeyDown);
  return () => container.removeEventListener("keydown", onKeyDown);
}
