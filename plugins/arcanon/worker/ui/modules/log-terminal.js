/**
 * Log terminal module — polling, ring buffer, filter, search, auto-scroll.
 *
 * Exports initLogTerminal() — called once by graph.js after init.
 * This module is DOM-only; it does not touch the canvas or render pipeline.
 */

import { state } from "./state.js";

const MAX_LOG_LINES = 500;
const POLL_INTERVAL_MS = 2000;

export function initLogTerminal() {
  const panel = document.getElementById("log-panel");
  const header = document.getElementById("log-panel-header");
  const logContainer = document.getElementById("log-lines");
  const componentFilter = document.getElementById("log-component-filter");
  const searchInput = document.getElementById("log-search");
  const clearBtn = document.getElementById("log-clear");
  const controls = header.querySelector(".log-panel__controls");

  let pollHandle = null;

  // Prevent controls clicks from toggling the panel
  controls.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  // Panel toggle
  header.addEventListener("click", () => {
    state.logPanelOpen = !state.logPanelOpen;
    if (state.logPanelOpen) {
      panel.classList.remove("log-panel--collapsed");
      panel.classList.add("log-panel--open");
      if (pollHandle === null) {
        pollHandle = setInterval(poll, POLL_INTERVAL_MS);
        poll(); // immediate first poll on open
      }
    } else {
      panel.classList.remove("log-panel--open");
      panel.classList.add("log-panel--collapsed");
      if (pollHandle !== null) {
        clearInterval(pollHandle);
        pollHandle = null;
      }
    }
  });

  // Component filter
  componentFilter.addEventListener("change", () => {
    state.logComponentFilter = componentFilter.value;
    applyFilters();
  });

  // Search input (debounced 200ms)
  let searchDebounce = null;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      state.logSearchFilter = searchInput.value;
      applyFilters();
    }, 200);
  });

  // Clear button
  clearBtn.addEventListener("click", () => {
    logContainer.innerHTML = "";
    state.logLastSince = null;
  });

  // --- Poll ---

  function poll() {
    const params = new URLSearchParams();
    if (state.logLastSince !== null) {
      params.set("since", state.logLastSince);
    }
    if (state.logComponentFilter !== "all") {
      params.set("component", state.logComponentFilter);
    }
    const qs = params.toString();
    const url = qs ? `/api/logs?${qs}` : "/api/logs";

    fetch(url)
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => {
        if (!data || !Array.isArray(data.lines)) return;
        let maxTs = state.logLastSince;
        for (const line of data.lines) {
          appendLogLine(line, logContainer);
          if (line.ts) {
            if (maxTs === null || line.ts > maxTs) {
              maxTs = line.ts;
            }
          }
        }
        if (maxTs !== state.logLastSince) {
          state.logLastSince = maxTs;
        }
      })
      .catch(() => {
        // Silently swallow network errors — log terminal must not crash the app
      });
  }

  // --- Append ---

  function appendLogLine(line, container) {
    const el = document.createElement("div");
    el.className = "log-line";

    // Time portion: last 12 chars of ISO string (e.g. "T14:23:45.123Z" → "14:23:45.123")
    const ts = line.ts ? line.ts.slice(-12) : "?";
    el.textContent = `[${ts}] [${line.component || "?"}] ${line.msg || ""}`;

    // Level class
    const lvl = (line.level || "").toUpperCase();
    if (lvl === "ERROR") {
      el.classList.add("log-line--error");
    } else if (lvl === "WARN") {
      el.classList.add("log-line--warn");
    } else {
      el.classList.add("log-line--info");
    }

    el.dataset.component = line.component || "";
    el.dataset.msg = line.msg || "";

    applyFiltersToLine(el);
    container.appendChild(el);

    // Ring buffer: never exceed MAX_LOG_LINES DOM elements
    while (container.children.length > MAX_LOG_LINES) {
      container.removeChild(container.firstChild);
    }

    maybeScrollToBottom(container);
  }

  // --- Filters ---

  function applyFiltersToLine(el) {
    const component = el.dataset.component;
    const msg = el.dataset.msg;

    const componentMismatch =
      state.logComponentFilter !== "all" &&
      component !== state.logComponentFilter;

    const searchMismatch =
      state.logSearchFilter.length > 0 &&
      !msg.toLowerCase().includes(state.logSearchFilter.toLowerCase());

    if (componentMismatch || searchMismatch) {
      el.classList.add("log-line--hidden");
    } else {
      el.classList.remove("log-line--hidden");
    }
  }

  function applyFilters() {
    for (const el of logContainer.children) {
      applyFiltersToLine(el);
    }
  }

  // --- Auto-scroll ---

  function maybeScrollToBottom(container) {
    const isAtBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 24;
    if (isAtBottom) {
      container.scrollTop = container.scrollHeight;
    }
  }
}
