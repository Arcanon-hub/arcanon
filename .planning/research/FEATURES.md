# Feature Research

**Domain:** Developer tool graph UI — UI polish and observability for v2.1 milestone
**Researched:** 2026-03-16
**Confidence:** HIGH (core patterns are well-established in developer tooling; D3 and Canvas APIs are stable)

> **Scope note:** This document covers v2.1 features only. v2.0 features (D3 Canvas graph, worker daemon,
> detail panel, click/hover/drag interactions) are already shipped and are dependencies, not targets.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features expected in any production-quality developer tool graph UI. Missing these makes the tool feel
like a prototype.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| HiDPI/Retina canvas rendering | On any Mac with Retina display (default since 2012) a blurry canvas immediately reads as "unfinished"; developer tools are used on high-DPI screens | LOW | Standard `devicePixelRatio` fix: multiply canvas width/height by ratio, scale context, set CSS dimensions to unscaled size; one-time setup on resize |
| Zoom/pan with mouse wheel + drag | Every graph UI (Grafana, Kibana, network maps) supports wheel-to-zoom and drag-to-pan as baseline interactions; without them users feel stuck | LOW | Already partially working; tuning `d3.zoom().wheelDelta()` multiplier controls sensitivity; `scaleExtent([min, max])` prevents runaway zoom |
| Fit-to-screen / reset view button | Any graph that can be panned off-screen needs a "reset" button; users expect one visible control to restore the initial centered view | LOW | `zoom.transform()` with `d3.zoomIdentity` + smooth transition via `selection.transition().duration(300)` |
| Zoom level indicator or controls (+/-) | VS Code, Figma, every canvas tool shows current zoom %; optional +/- buttons provide discoverability for users who don't know wheel zooms | LOW | Read `d3.zoomTransform(element).k`, format as %, update on every zoom event; +/- buttons call `zoom.scaleBy()` |
| Project switcher (no reload) | Any tool managing multiple projects needs in-place switching; forcing a page reload to change projects is a regression from typical SPA behavior | MEDIUM | `<select>` or custom dropdown; on change: fetch new project's data from worker REST API, re-render graph without page navigation; persist selection to `localStorage` |
| Log/output panel accessible without leaving UI | Developer tools all provide observability (VS Code output panel, Chrome DevTools console, Webpack output); hiding logs behind file tail creates friction | MEDIUM | Collapsible panel at bottom or side; reads from worker's structured JSON log file via REST endpoint or EventSource; shows latest N lines on open |

### Differentiators (Competitive Advantage)

Features that elevate the UI from functional to developer-grade. Not strictly required but clearly
differentiate a serious tool.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Log terminal with component filter | Most embedded log views show all output; filtering by component (scanner, mcp, api) lets users focus on the subsystem they care about — same pattern as VS Code Output Channel selector | MEDIUM | Worker logs include `component` field in structured JSON; filter as a `<select>` or button group that re-queries or hides rows client-side; avoids needing separate log channels |
| Log terminal with live-tail toggle | VS Code terminal auto-scrolls to newest output; Grafana Loki live tail; ability to "pause" scroll while inspecting a specific log line is standard | LOW | Toggle boolean; when enabled, `scrollIntoView()` on each new log entry; when disabled, freeze scroll position; debounce renders to avoid jank on log bursts |
| Log search (text filter) | Grep-style search in the log panel reduces time to find an error vs scrolling; used in lnav, Tailviewer, VS Code output filtering | LOW | Client-side substring or regex filter on already-loaded log lines; input debounced ~200ms; highlight matching text in results |
| Canvas font size bump (larger throughout) | HiDPI fix alone makes the canvas sharp but node labels often remain too small at default zoom; explicit font size increase improves readability at all zoom levels | LOW | `ctx.font` on node labels, edge labels, tooltip text — increase base size from typical 10-11px to 13-14px; test at 1x and 2x DPI |
| Smooth zoom transitions on +/- button clicks | Wheel zoom is instant; button-driven zoom that uses `transition().duration(250)` feels polished vs a jump — this is what Figma and browser zoom do | LOW | Pass `{duration: 250}` option to `zoom.scaleBy()` transition; wheel zoom stays instantaneous (transitions on wheel feel laggy) |
| Persistent project selection across reloads | `localStorage` persistence so the last-viewed project is pre-selected on next open; removes the step of re-selecting every session | LOW | Write selected project ID to `localStorage` on change; read on page load; validate against available projects before applying |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Full xterm.js terminal emulator | "Real terminal" with ANSI colors, cursor — used in VS Code, Hyper | AllClear's log panel shows structured JSON log output from a file, not an interactive shell. xterm.js is designed for PTY-backed interactive terminals; adding it here brings a ~300 KB dependency and PTY plumbing for zero additional value over a styled `<div>` with colored JSON rows | Styled log rows with JSON field highlighting; color-code log levels (ERROR=red, WARN=yellow, INFO=white); no xterm dependency needed |
| WebSocket streaming for real-time logs | "Live updates feel more real-time" | WebSocket adds server-side connection management and reconnect logic to the worker. The log file already exists on disk; polling it every 1-2 seconds via a simple HTTP endpoint is indistinguishable to the user for this use case | HTTP polling with `EventSource` (SSE) as the ceiling; polling every 1-2s is imperceptible latency for a log viewer |
| Multi-project side-by-side comparison | Show two project graphs at once | Doubles DOM/Canvas complexity, breaks the existing layout, and the use case (comparing two dependency graphs side by side) is rare. Users can switch between graphs in seconds | Single-project switcher with fast switching; visual comparison not supported in v2.1 |
| Infinite zoom (no scale limits) | "I want to zoom in as much as I want" | Without `scaleExtent` limits, users zoom into individual pixels and lose orientation; zooming out too far makes all nodes invisible. Scale limits are a UX feature, not a restriction | Set `scaleExtent([0.1, 5])` — 10% to 500% zoom; covers all realistic use cases without getting lost |
| Custom log level color themes / theming | "I want dark/light mode, custom colors" | Theming adds significant CSS scope for marginal benefit in a single-user localhost tool; colors can always be adjusted later | Use sensible defaults (dark background, red errors, yellow warnings, white info); single consistent theme for v2.1 |

---

## Feature Dependencies

```
[HiDPI canvas fix]
    (standalone — no dependencies on other v2.1 features)
    └──enhances──> [Larger fonts throughout] (both address visual quality; do together)

[D3 zoom behavior (existing v2.0)]
    └──required by──> [Zoom sensitivity tuning]
    └──required by──> [Fit-to-screen / reset button]
    └──required by──> [Zoom level indicator]
    └──required by──> [Smooth zoom transitions on button clicks]

[Worker REST API (existing v2.0)]
    └──required by──> [Project switcher] (needs endpoint listing available projects)
    └──required by──> [Log terminal panel] (needs endpoint serving log lines)

[Worker structured JSON log file (existing v2.0)]
    └──required by──> [Log terminal panel]
    └──required by──> [Component filter] (depends on `component` field in log entries)

[Log terminal panel]
    └──required by──> [Live-tail toggle] (toggle is a behavior of the panel)
    └──required by──> [Log search] (search operates on panel content)
    └──required by──> [Component filter] (filter operates on panel content)

[Project switcher]
    └──enhances──> [Persistent project selection] (persist the switcher's value)
```

### Dependency Notes

- **HiDPI fix is fully independent**: Can be implemented and shipped first; touches only canvas setup code.
- **Zoom tuning depends on existing d3.zoom**: No new infrastructure needed — only parameter adjustments to existing behavior.
- **Log panel depends on a log-serving API endpoint**: The worker daemon writes structured JSON logs to file already; a simple REST endpoint to read the last N lines (or an SSE endpoint for streaming) is the only new backend work.
- **Project switcher depends on a project-listing API endpoint**: Worker needs to expose `GET /projects` listing available project IDs; graph data endpoint already exists per project.
- **All log panel sub-features (filter, search, live-tail) depend on the base panel existing first**: Implement the base panel before adding sub-features.

---

## MVP Definition (v2.1)

### Launch With (v2.1 core)

Minimum for the milestone to deliver its stated goal: "production-quality with crisp rendering, usable
zoom/pan, persistent project switching, and an embedded log terminal."

- [ ] HiDPI canvas fix + larger fonts — crisp rendering on all developer machines
- [ ] Zoom/pan sensitivity tuning + `scaleExtent` limits — usable wheel zoom without runaway behavior
- [ ] Fit-to-screen reset button — escape hatch when graph is panned off-screen
- [ ] Project switcher dropdown — switch repos without page reload; persist selection to `localStorage`
- [ ] Log terminal panel (collapsible) — view worker output without leaving the UI; shows last N lines on open

### Add After Validation (v2.1.x)

Features to add once the base panel is confirmed working.

- [ ] Live-tail toggle in log panel — triggered when users complain that auto-scroll disrupts inspection
- [ ] Component filter in log panel — add when log volume is high enough that filtering is needed
- [ ] Log search — add when users ask "how do I find the error that just happened?"
- [ ] Zoom level indicator (% display) — add for discoverability; low effort once zoom is tuned

### Future Consideration (v2.2+)

- [ ] Smooth animated zoom transitions on +/- buttons — polish, not blocking
- [ ] Log export (copy to clipboard, download .log) — add if users need to share logs

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| HiDPI/Retina canvas fix | HIGH | LOW | P1 — visual regression on every Mac |
| Larger fonts throughout | HIGH | LOW | P1 — pair with HiDPI fix |
| Zoom sensitivity tuning | HIGH | LOW | P1 — usability baseline |
| Fit-to-screen reset button | HIGH | LOW | P1 — escape hatch |
| Project switcher (no reload) | HIGH | MEDIUM | P1 — stated milestone goal |
| Log terminal panel (base) | HIGH | MEDIUM | P1 — stated milestone goal |
| Live-tail toggle | MEDIUM | LOW | P2 — behavior enhancement |
| Component filter | MEDIUM | LOW | P2 — depends on log volume |
| Log search | MEDIUM | LOW | P2 — convenience feature |
| Zoom level indicator | LOW | LOW | P2 — discoverability |
| Smooth button zoom transitions | LOW | LOW | P3 — polish only |
| Persistent project selection | MEDIUM | LOW | P1 — pairs with project switcher |

**Priority key:**
- P1: Required to meet the v2.1 milestone goal
- P2: Should add in same milestone pass if time allows
- P3: Nice to have, v2.2+

---

## Competitor Feature Analysis

Reference implementations in the developer tool space for each feature area.

| Feature | VS Code | Grafana | Chrome DevTools | AllClear v2.1 approach |
|---------|---------|---------|-----------------|------------------------|
| Embedded log/output panel | Output panel, collapsible, per-channel filter | Log browser panel with live tail | Console tab with level filter | Collapsible bottom panel, component filter, live-tail toggle |
| Project switcher | Workspace / folder switcher in title bar | Dashboard picker in top nav | N/A | `<select>` in header bar; `localStorage` persistence |
| HiDPI canvas | N/A (DOM-based) | Canvas panels use devicePixelRatio | DevTools canvas uses devicePixelRatio | Standard `devicePixelRatio` multiply + CSS scale |
| Zoom controls | Ctrl+= / Ctrl+- with % indicator | Scroll to zoom + magnifying glass button | N/A (DOM zoom) | Wheel zoom + +/- buttons + fit-to-screen; `scaleExtent([0.1, 5])` |

---

## Sources

- [D3 d3-zoom documentation — d3js.org](https://d3js.org/d3-zoom) — HIGH confidence (official docs)
- [d3-zoom GitHub repository](https://github.com/d3/d3-zoom) — HIGH confidence (source + README)
- [MDN — Window.devicePixelRatio](https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio) — HIGH confidence (official Web API docs)
- [Kirupa — Canvas HiDPI/Retina](https://www.kirupa.com/canvas/canvas_high_dpi_retina.htm) — MEDIUM confidence (tutorial, well-known source)
- [VS Code Panel UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/panel) — HIGH confidence (official VS Code extension docs)
- [VS Code Terminal Basics](https://code.visualstudio.com/docs/terminal/basics) — HIGH confidence (official docs)
- [D3 Zoom and Pan — d3indepth.com](https://www.d3indepth.com/zoom-and-pan/) — MEDIUM confidence (tutorial)
- [Logdy — Web-based real-time log viewer](https://logdy.dev/) — MEDIUM confidence (product, pattern reference)
- [xterm.js — xtermjs.org](https://xtermjs.org/) — HIGH confidence (official docs; used to confirm xterm is overkill for this use case)

---
*Feature research for: AllClear v2.1 — UI Polish & Observability*
*Researched: 2026-03-16*
