# Project Research Summary

**Project:** AllClear v2.1 — UI Polish & Observability
**Domain:** Canvas-based developer tool graph UI — HiDPI rendering, zoom/pan controls, log terminal, project switcher
**Researched:** 2026-03-16
**Confidence:** HIGH

## Executive Summary

AllClear v2.1 adds four production-quality features to the already-shipped v2.0 D3 Canvas graph: HiDPI/Retina rendering, tuned zoom/pan controls, an embedded log terminal panel, and a persistent project switcher. Research was conducted against the live codebase (all UI modules inspected directly) and against official MDN, D3, Fastify, and npm sources. The recommended approach is a phased build ordered by dependency: canvas rendering fixes first (independent, highest value), then the log terminal server route, then the log terminal UI, and finally the project switcher which requires a `graph.js` refactor. Every feature has a well-understood implementation pattern; no novel design work is required.

The two highest-risk areas are the project switcher teardown and the SSE log stream. The project switcher requires refactoring all anonymous event handler functions in `setupInteractions()` to named functions before the feature can work correctly — skipping this causes duplicate listeners, double-firing clicks, and two simultaneous Web Workers. The SSE log endpoint requires an explicit `request.raw.on('close')` cleanup handler or the worker process will leak memory across development sessions. Both risks are well-documented and preventable; they are non-obvious the first time but each has a concrete 3-5 line fix.

The v2.1 milestone deliberately avoids over-engineering. The log terminal uses HTTP polling (not WebSockets), the graph UI uses vanilla JS + D3 (no React, no bundler), and the worker is a single Node.js process (no pm2, no daemon manager). These constraints are load-bearing: they keep the install story simple, keep the worker process inspectable, and avoid toolchain dependencies that complicate the plugin distribution model. Every recommended approach stays consistent with these constraints.

## Key Findings

### Recommended Stack

The existing v2.0 stack (better-sqlite3, Fastify 5, @modelcontextprotocol/sdk, D3 v7, Node.js 20+) requires only two new npm packages for v2.1. `@fastify/sse` (0.4.0, Fastify 5 compatible) handles the SSE log streaming endpoint. `@xterm/xterm` (6.0.0) and `@xterm/addon-fit` (0.11.0) are loaded browser-side via CDN — they are not Node.js dependencies. The HiDPI canvas fix, zoom tuning, and project switcher require zero new packages; they are pure JavaScript changes to existing modules.

**Core technologies:**
- `@fastify/sse` 0.4.0: SSE endpoint for log streaming — official Fastify plugin, Fastify v5 peer dep verified, async generator API
- `@xterm/xterm` 6.0.0 (CDN only): Terminal emulator for log display — battle-tested (powers VS Code's terminal), full ANSI support, Canvas renderer built-in; use scoped `@xterm/xterm`, not legacy unscoped `xterm` (5.3.0, abandoned)
- `@xterm/addon-fit` 0.11.0 (CDN only): Resize xterm to fill its container — required companion, same release cycle as xterm
- `window.devicePixelRatio` + `ctx.scale(dpr, dpr)`: HiDPI canvas fix — zero dependencies, MDN-documented three-step pattern, backwards-compatible at dpr=1
- `e.ctrlKey` wheel event check: Trackpad pinch vs two-finger scroll detection — browser convention, widely supported in Chrome/Safari/Firefox

**Critical version notes:**
- Node.js 20+ required (established in v2.0; driven by better-sqlite3 12.x and Fastify 5.x)
- `@fastify/sse` 0.4.0 requires Fastify v5 — will not work with Fastify v4
- The scoped `@xterm/xterm` package is the current package; the unscoped `xterm` package stopped updates at 5.3.0

### Expected Features

Research confirms all four v2.1 features are standard patterns in developer tooling, with reference implementations in VS Code, Grafana, Chrome DevTools, and Figma. Missing HiDPI rendering is an immediate visual regression on any Mac (Retina display default since 2012); it reads as "unfinished" to any developer audience.

**Must have (v2.1 table stakes):**
- HiDPI/Retina canvas rendering — blurry canvas on any Mac reads as unfinished; standard 5-line fix
- Zoom/pan with mouse wheel and drag — every graph tool (Grafana, Kibana, network maps) supports this as a baseline
- Fit-to-screen / reset view button — escape hatch required for any pan-able canvas
- Project switcher without page reload — forcing a full reload to change projects is a regression from SPA behavior
- Log terminal panel (collapsible) — developer tools always surface observability; hiding logs behind `tail -f` creates friction

**Should have (competitive):**
- Live-tail toggle — VS Code and Grafana Loki pattern; prevents auto-scroll from disrupting log inspection
- Component filter in log panel — narrows to scanner/mcp/api subsystem, same as VS Code Output Channel selector
- Log search (text filter) — grep-style; add when users ask "how do I find the error that just happened?"
- Persistent project selection via `localStorage` — eliminates re-selection friction every session
- Zoom level indicator (%) — discoverability; low effort once zoom is tuned

**Defer to v2.2+:**
- Smooth animated zoom transitions on +/- buttons — polish only, not blocking
- Log export (copy/download) — add if users need to share logs
- Multi-project side-by-side comparison — rare use case, doubles DOM/Canvas complexity
- Full xterm PTY integration — overkill for structured JSON log viewing; 300KB+ dependency for zero additional value over a styled div

### Architecture Approach

The v2.1 additions follow the existing one-concern-per-module pattern already established in the codebase. Two new modules are created (`log-terminal.js`, `project-switcher.js`), five existing modules are modified (`state.js`, `renderer.js`, `interactions.js`, `graph.js`, `index.html`), and one server route is added to `http.js`. No changes to the worker process architecture are required — HTTP and MCP stdio continue to coexist in a single Node.js process. The phased build order is determined by module dependencies, not by arbitrary grouping.

**Major components:**
1. `renderer.js` (MODIFIED) — wrap draw sequence in `ctx.scale(dpr, dpr)` after `ctx.save()`; font size adjustments for legibility at normal zoom
2. `interactions.js` (MODIFIED) — wheel delta tuning; `e.ctrlKey` check for trackpad pinch vs two-finger scroll
3. `graph.js` (MODIFIED) — extract `loadProject(hash)` from `init()`; call `initProjectSwitcher()` and `initLogTerminal()` after first load; wire fit-to-screen button
4. `project-switcher.js` (NEW) — populate `#project-select` from `/projects`, handle `onchange`, full teardown then re-init via `loadProject()`
5. `log-terminal.js` (NEW) — 2s polling of `GET /api/logs`, ring-buffer DOM cap at 500 lines, component filter, live-tail toggle
6. `worker/server/http.js` (MODIFIED) — add `GET /api/logs` route reading from `~/.allclear/logs/worker.log`; accept `dataDir` via options object
7. `state.js` (MODIFIED) — add `currentProject`, `logPanelOpen`, `logFilter`, `logComponentFilter` fields

**Key architectural rule:** `state.transform`, `state.positions`, and all mouse coordinates must remain in CSS pixel space throughout. `devicePixelRatio` scaling is applied once at render-time (`ctx.scale(dpr, dpr)`) and nowhere else. Applying DPR to coordinates breaks hit testing, drag, and pan.

### Critical Pitfalls

1. **HiDPI mouse coordinate mismatch** — After `ctx.scale(dpr, dpr)`, `e.offsetX`/`e.offsetY` remain CSS pixels. Never multiply mouse coordinates by DPR. The DPR scale wraps only the canvas context draw stack, not `state.transform` or any input coordinate. Violation breaks click-to-select by a factor of `devicePixelRatio`.

2. **Project switcher without full teardown** — `init()` was designed as a one-shot startup. Re-running without teardown creates: (a) two simultaneous `forceWorker` Web Workers — visual flicker and double CPU; (b) duplicate canvas event listeners — clicks fire twice; (c) state from project A leaking into project B. Teardown requires named handler functions (currently anonymous in `setupInteractions()`), `forceWorker.terminate()`, and full state reset. Refactor anonymous handlers before implementing the switcher.

3. **SSE zombie connection leak** — SSE endpoints keep HTTP responses open indefinitely. Without `request.raw.on('close', cleanup)`, browser tab closes accumulate zombie connections. Worker memory grows 1-5 MB per abandoned connection and eventually crashes. The close handler is mandatory; it must be in the first implementation, not added later.

4. **Trackpad two-finger scroll fires as wheel event** — On macOS, both two-finger scroll and pinch-to-zoom arrive as `wheel` events. Current code treats all wheel input as zoom. Check `e.ctrlKey`: `true` = pinch (zoom); `false` = two-finger scroll (pan via `state.transform.x -= e.deltaX`).

5. **DOM log buffer unbounded growth** — Naive `logContainer.appendChild(line)` with no cap causes 100+ MB tab memory after a scan session and janky scrolling at 1000+ lines. Cap at 500 lines with a ring buffer: remove `logContainer.firstChild` when `children.length > MAX`.

## Implications for Roadmap

The dependency graph established in architecture research produces a clear, four-phase build order.

### Phase 1: Canvas Rendering Fixes

**Rationale:** Independent of all other v2.1 work; touches only `renderer.js`, `graph.js`, and `interactions.js`; no server changes; no new modules. Affects every user immediately on any Retina Mac. Getting the renderer correct before adding new modules avoids re-auditing every `ctx` call later. Phase 2 (log API) can be developed in parallel.

**Delivers:** Crisp rendering on all HiDPI displays; usable zoom/pan with trackpad pinch vs scroll detection; natural wheel sensitivity; fit-to-screen button.

**Addresses:** HiDPI fix + font size bump, zoom sensitivity tuning, `scaleExtent` bounds, trackpad pinch vs scroll, fit-to-screen reset.

**Avoids:** Blurry canvas pitfall, mouse coordinate mismatch pitfall, passive wheel event conflict pitfall, trackpad scroll-as-zoom pitfall.

**Research flag:** Standard. MDN and web.dev documentation is definitive. No additional research needed.

### Phase 2: Log Terminal API (parallel with Phase 1)

**Rationale:** Server-side only; zero UI work; touches different files from Phase 1. The log terminal UI (Phase 3) is blocked on this endpoint; building it in parallel with Phase 1 saves wall-clock time.

**Delivers:** `GET /api/logs?since=&component=&limit=` route on Fastify server; reads `~/.allclear/logs/worker.log`; returns `{ lines: [] }` with filtered JSON. Pass `dataDir` into `createHttpServer()` via options object — do not hardcode in `http.js`.

**Addresses:** Log terminal data API, server-side log filtering.

**Avoids:** Hardcoding `dataDir` in `http.js` (breaks `--data-dir` CLI override used in tests).

**Research flag:** Standard. Fastify GET route pattern with query params is well-established in the existing `http.js`. No additional research needed.

### Phase 3: Log Terminal UI

**Rationale:** Depends on Phase 2 (the `/api/logs` endpoint must exist). New module `log-terminal.js` is fully isolated from graph rendering — it can be scaffolded without touching graph code.

**Delivers:** Collapsible log panel below `#canvas-container`; 2s polling with `since` timestamp; ring-buffer DOM cap at 500 lines; component filter dropdown; auto-scroll with bottom-detection; `@fastify/sse` for SSE streaming (ceiling option; polling is sufficient for MVP).

**Addresses:** Log terminal base panel, live-tail toggle, component filter, log search, SSE close-handler cleanup.

**Avoids:** SSE zombie connection leak (close handler mandatory from first implementation), unbounded DOM buffer (ring buffer at 500 from first implementation), SSE reconnect flood (jitter on `retry:` field), SSE log injection (strip newlines from log text before writing to SSE).

**Research flag:** SSE close-handler zombie leak (Pitfall 7 in PITFALLS.md) needs explicit attention during implementation. It is non-obvious and the source of the most common production SSE bugs.

### Phase 4: Project Switcher

**Rationale:** Requires the `loadProject(hash)` extraction from `graph.js`, which is safest after Phase 1 (renderer is stable). The named-handler refactor of `setupInteractions()` must gate this phase — it is a prerequisite with its own risk surface.

**Delivers:** Persistent `#project-select` dropdown populated from `/projects`; in-place project switching without page reload; `localStorage` persistence of selected project; full state teardown (named handlers, `forceWorker.terminate()`, state reset) before reload.

**Addresses:** Project switcher, persistent project selection.

**Avoids:** No-teardown pitfall — duplicate Web Workers, duplicate listeners, state leakage from project A to B. Named-function refactor of `setupInteractions()` is the prerequisite gate.

**Research flag:** The teardown/tearup sequence (Pitfall 6 in PITFALLS.md) is the primary implementation concern. The teardown function code example in PITFALLS.md should be reviewed before writing `project-switcher.js`.

### Phase Ordering Rationale

- Phase 1 before Phase 4: Renderer stability before `graph.js` refactor. Both touch `graph.js` but for different reasons; combining them risks introducing coordinate bugs that are harder to diagnose with two concurrent changes.
- Phase 2 parallel with Phase 1: Server and canvas code are completely decoupled — `http.js` and `renderer.js` share no code. Running in parallel saves wall-clock time with no coordination cost.
- Phase 3 after Phase 2: The UI polls the endpoint; the endpoint must exist for integration testing. Module scaffolding can start before Phase 2 completes, but end-to-end validation requires Phase 2 done.
- Phase 4 last: The named-handler refactor creates risk for Phase 1 interactions if rushed. Phase 4 is the only phase that modifies existing canvas event handler wiring; doing it last contains the blast radius.

### Research Flags

Needs attention during implementation:
- **Phase 3 (Log Terminal):** SSE zombie connection leak (PITFALLS.md Pitfall 7) — explicit close handler required in first implementation.
- **Phase 4 (Project Switcher):** Full teardown before re-init (PITFALLS.md Pitfall 6) — named-handler refactor is a prerequisite gate; do not skip.

Standard patterns (no additional research needed):
- **Phase 1 (Canvas Fixes):** MDN `devicePixelRatio` pattern is definitive; three-step HiDPI fix has broad codebase precedent.
- **Phase 2 (Log API):** Fastify GET route with query params follows the existing `http.js` pattern exactly.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All packages verified against npm registry and GitHub releases on 2026-03-16; version compatibility confirmed for Node.js 20+, Fastify 5, xterm 6 |
| Features | HIGH | Reference implementations exist in VS Code, Grafana, Chrome DevTools for every feature; all patterns are stable and well-documented |
| Architecture | HIGH | Based on direct codebase inspection of all UI modules and server; no inference required; existing module boundaries are well-defined |
| Pitfalls | HIGH | MDN official docs confirmed; specific issue trackers (expressjs, nestjs, excaliburjs) cross-referenced for SSE and canvas pitfalls |

**Overall confidence:** HIGH

### Gaps to Address

- **Zoom sensitivity final tuning:** The D3 wheel delta formula (SENSITIVITY = 0.001) is a documented starting point, not a validated constant. Budget one round of manual trackpad testing after implementation. The `scaleExtent([0.15, 5])` bounds are a reasonable starting point but may need adjustment for large graphs.
- **xterm.js vs styled div decision:** FEATURES.md flags xterm.js as a potential anti-feature (overkill for structured JSON log output); STACK.md includes it as the recommended package for ANSI rendering. The implementation team should decide during Phase 3 based on the actual log format encountered in the worker. Either approach is architecturally valid; only the `log-terminal.js` module changes.
- **Log file rotation scope:** The `/api/logs` route reads the entire log file on each poll; for a long-running worker, this grows without bound. Log rotation (cap at 1MB, rotate to `worker.log.1`) is out of scope for v2.1. Mitigate in v2.1 by reading only the last 500 lines server-side. Flag for v2.2.
- **Force worker canvas dimensions after resize:** After the DPR fix, `canvas.width` is `cssW * dpr`. The force simulation layout respects CSS dimensions, not physical pixel dimensions. Any `canvas.width` / `canvas.height` passed to the force worker must be divided by `devicePixelRatio` first. Verify this integration point during Phase 1 testing.

## Sources

### Primary (HIGH confidence)

- `https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio` — DPR definition, matchMedia pattern for DPR change detection
- `https://web.dev/articles/canvas-hidipi` — Three-step HiDPI canvas pattern: multiply dimensions, CSS scale back, scale context
- `https://github.com/fastify/fastify/releases` — Fastify 5.8.2 current, Node.js v20+ required
- `npm info @fastify/sse` — version 0.4.0, peerDependencies `fastify ^5.x`, verified 2026-03-16
- `npm info @xterm/xterm` — version 6.0.0, published Jan 2026, verified 2026-03-16
- `npm info @xterm/addon-fit` — version 0.11.0, requires xterm v4+, verified 2026-03-16
- `https://d3js.org/d3-zoom` — wheel delta formula, `zoom.wheelDelta()` customization, `scaleExtent`
- Direct codebase inspection: `worker/ui/graph.js`, `worker/ui/modules/*.js`, `worker/ui/index.html`, `worker/server/http.js`, `worker/index.js` — confirmed anonymous handler pattern, no DPR scaling, no teardown, `#project-select` hidden

### Secondary (MEDIUM confidence)

- `https://tigerabrodi.blog/how-to-handle-trackpad-pinch-to-zoom-vs-two-finger-scroll-in-javascript-canvas-apps` — `e.ctrlKey` convention for trackpad pinch detection
- `https://github.com/excaliburjs/Excalibur/issues/1195` — Passive wheel event breaking canvas zoom (real-world example)
- `https://github.com/expressjs/express/issues/2248` — SSE connection accumulation without close handler
- `https://github.com/nestjs/nest/issues/11601` — SSE cleanup patterns in Node.js servers
- `https://d3js.org/d3-zoom` — sensitivity tuning is documented but trackpad delta behavior varies by driver (MEDIUM for sensitivity constants specifically)

### Tertiary (for reference)

- `https://medium.com/@benjamin.botto/zooming-at-the-mouse-coordinates-with-affine-transformations-86e7312fd50b` — Zoom-to-cursor formula (matches current implementation)
- `https://newreleases.io/project/github/xtermjs/xterm.js/release/6.0.0` — xterm.js 6.0.0 breaking changes (Canvas renderer addon removed, now built-in)

---
*Research completed: 2026-03-16*
*Ready for roadmap: yes*
