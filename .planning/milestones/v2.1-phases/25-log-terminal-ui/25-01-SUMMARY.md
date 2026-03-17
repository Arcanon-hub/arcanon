---
phase: 25-log-terminal-ui
plan: "01"
subsystem: worker-ui
tags: [log-terminal, polling, ring-buffer, dom, ui]
dependency_graph:
  requires: []
  provides: [log-terminal-module, log-panel-html, state-log-fields]
  affects: [worker/ui/index.html, worker/ui/modules/state.js, worker/ui/modules/log-terminal.js]
tech_stack:
  added: []
  patterns: [polling-with-watermark, dom-ring-buffer, debounced-input, closure-setinterval]
key_files:
  created:
    - worker/ui/modules/log-terminal.js
  modified:
    - worker/ui/index.html
    - worker/ui/modules/state.js
decisions:
  - "appendLogLine receives logContainer as a parameter (closure-style) keeping poll() and append() free of extra DOM lookups"
  - "Controls click stopPropagation prevents header toggle when interacting with dropdown/search/clear"
  - "Network fetch errors silently swallowed in catch() — log terminal must not crash the app"
metrics:
  duration_minutes: 15
  completed_date: "2026-03-16"
  tasks_completed: 3
  files_changed: 3
---

# Phase 25 Plan 01: Log Terminal UI — HTML, State, Module Summary

**One-liner:** Collapsible log panel with 2s polling, 500-line DOM ring buffer, component filter, keyword search, and smart auto-scroll.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Add log panel markup and CSS to index.html | 3586b4d | worker/ui/index.html |
| 2 | Extend state.js with log panel fields | b8d2783 | worker/ui/modules/state.js |
| 3 | Create log-terminal.js module | 13ca0a5 | worker/ui/modules/log-terminal.js |

## What Was Built

**index.html** — Added `#log-panel` div (collapsed at 32px) as a flex sibling to `#canvas-container`, sitting at the bottom of the page. Includes: header bar with title + controls (component dropdown, search input, clear button) + chevron indicator. Body div `#log-lines` holds the scrollable log entries. Full CSS for collapsed/expanded states, log line colors (error=red, warn=orange, info=gray), and filter visibility.

**state.js** — Added four new fields to the shared state object:
- `logPanelOpen: false` — panel open/closed toggle state
- `logComponentFilter: "all"` — active component filter selection
- `logSearchFilter: ""` — active keyword search string
- `logLastSince: null` — ISO timestamp watermark for incremental polling

**log-terminal.js** — Exports `initLogTerminal()`. Key behaviors:
- **Toggle:** Header click opens/closes panel; starts/stops `setInterval` poll on open/close
- **Polling:** Fetches `/api/logs?limit=200` every 2s; appends `&since=` watermark and `&component=` filter as needed; updates `logLastSince` to max ts seen each poll cycle
- **Ring buffer:** `while (container.children.length > 500) removeChild(firstChild)` — DOM never grows unbounded
- **Filters:** `applyFiltersToLine()` adds/removes `log-line--hidden` based on component and search; `applyFilters()` re-applies to all existing lines on filter change
- **Auto-scroll:** Scrolls to bottom if user is within 24px of bottom; stops auto-scrolling when user scrolls up
- **Debounce:** Search input change debounced 200ms before applying
- **Error safety:** All fetch errors silently caught; no `console.log`/`console.error` in module

## Deviations from Plan

None — plan executed exactly as written.

## Verification

All structural checks passed:
- `#log-panel` element in index.html with class `log-panel log-panel--collapsed`
- `#log-panel-header`, `#log-lines`, `#log-component-filter`, `#log-search` all present
- CSS rules for `.log-panel`, `.log-panel--open`, `.log-line`, `.log-line--error` present
- state.js has all four new fields with correct initial values
- log-terminal.js structure check: MAX_LOG_LINES, POLL_INTERVAL_MS, since= param, removeChild eviction, logLastSince update, applyFiltersToLine, maybeScrollToBottom — all present

## Next Step

Plan 02 will wire `initLogTerminal()` into `graph.js` to activate the module in the live UI.

## Self-Check: PASSED

Files exist:
- worker/ui/modules/log-terminal.js: FOUND
- worker/ui/index.html: FOUND (log-panel markup present)
- worker/ui/modules/state.js: FOUND (logPanelOpen field present)

Commits exist:
- 3586b4d: FOUND
- b8d2783: FOUND
- 13ca0a5: FOUND
