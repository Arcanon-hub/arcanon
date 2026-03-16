# Architecture Research

**Domain:** AllClear v2.1 — UI Polish & Observability integration with existing modular UI
**Researched:** 2026-03-16
**Confidence:** HIGH — based on direct codebase inspection of all UI modules, server, and worker

---

## Standard Architecture

### System Overview (v2.1 additions in context)

```
┌───────────────────────────────────────────────────────────────────────────┐
│                        Browser (localhost:37888)                           │
├───────────────────────────────────────────────────────────────────────────┤
│  Toolbar Row (existing)                                                    │
│  ┌──────────────┐ ┌──────────────┐ ┌───────────────┐ ┌────────────────┐  │
│  │   h1 title   │ │project-select│ │  search input │ │ protocol filters│  │
│  │  (existing)  │ │ (NEW: wired) │ │  (existing)   │ │   (existing)   │  │
│  └──────────────┘ └──────────────┘ └───────────────┘ └────────────────┘  │
├───────────────────────────────────────────────────────────────────────────┤
│  Main Area (flex column, existing)                                         │
│                                                                            │
│  ┌───────────────────────────────────────────────────────────────────┐    │
│  │  #canvas-container (flex: 1, existing)                            │    │
│  │                                                                   │    │
│  │  <canvas id="graph-canvas"> — HiDPI fix applied HERE             │    │
│  │  #tooltip (existing)                                              │    │
│  │  #detail-panel (existing, right overlay)                          │    │
│  └───────────────────────────────────────────────────────────────────┘    │
│                                                                            │
│  ┌───────────────────────────────────────────────────────────────────┐    │
│  │  #log-panel (NEW — collapsible, fixed height ~200px)              │    │
│  │                                                                   │    │
│  │  [header: "Worker Logs" | filter input | component select | X]   │    │
│  │  [log-lines container — scrollable, monospace]                    │    │
│  └───────────────────────────────────────────────────────────────────┘    │
├───────────────────────────────────────────────────────────────────────────┤
│                     JS Module Layer (worker/ui/modules/)                   │
│                                                                            │
│  ┌────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐   │
│  │  state.js  │ │ renderer.js  │ │interactions.js│ │  detail-panel.js │   │
│  │ (MODIFIED) │ │ (MODIFIED)   │ │  (MODIFIED)   │ │   (existing)     │   │
│  └────────────┘ └──────────────┘ └──────────────┘ └──────────────────┘   │
│                                                                            │
│  ┌─────────────────────┐ ┌──────────────────┐ ┌──────────────────────┐   │
│  │  project-picker.js  │ │  log-terminal.js │ │  project-switcher.js │   │
│  │    (existing)       │ │     (NEW)        │ │       (NEW)          │   │
│  └─────────────────────┘ └──────────────────┘ └──────────────────────┘   │
├───────────────────────────────────────────────────────────────────────────┤
│                     Server Layer (worker/server/http.js)                   │
│                                                                            │
│  existing routes: /graph, /impact, /service/:name, /scan, /projects       │
│  NEW route:       GET /api/logs?since=<ts>&component=<name>&limit=<n>     │
├───────────────────────────────────────────────────────────────────────────┤
│                     Node.js Worker (worker/index.js)                       │
│                                                                            │
│  existing: structured JSON logs → ~/.allclear/logs/worker.log              │
│  log format already set: { ts, level, msg, pid, port, ...extra }           │
└───────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | New / Modified |
|-----------|---------------|----------------|
| `state.js` | Shared state object — add `currentProject`, `logPanelOpen`, `logFilter`, `logComponentFilter` | MODIFIED |
| `renderer.js` | Canvas draw — apply devicePixelRatio scaling for HiDPI; scale font sizes by dpr | MODIFIED |
| `interactions.js` | Zoom/pan — tune wheel delta multiplier for less aggressive zoom | MODIFIED |
| `graph.js` | Init flow — wire project-switcher dropdown after init; call log-terminal.js init | MODIFIED |
| `index.html` | Layout — add `#log-panel` section below `#canvas-container`; CSS for collapsible panel | MODIFIED |
| `project-switcher.js` | NEW module — populates `#project-select`, handles change event, re-runs graph load without page reload | NEW |
| `log-terminal.js` | NEW module — polls `/api/logs`, renders lines to `#log-panel`, handles filter/component controls | NEW |
| `worker/server/http.js` | Fastify server — add `GET /api/logs` route reading from `~/.allclear/logs/worker.log` | MODIFIED |

---

## Recommended Project Structure (v2.1 additions)

```
worker/
├── index.js                        # unchanged — log format already correct
├── server/
│   └── http.js                     # MODIFIED: add GET /api/logs route
└── ui/
    ├── index.html                   # MODIFIED: add #log-panel HTML + CSS
    ├── graph.js                     # MODIFIED: init project-switcher + log-terminal
    ├── force-worker.js              # unchanged
    └── modules/
        ├── state.js                 # MODIFIED: add log/project state fields
        ├── renderer.js              # MODIFIED: HiDPI dpr scaling
        ├── interactions.js          # MODIFIED: zoom delta tuning
        ├── detail-panel.js          # unchanged
        ├── project-picker.js        # unchanged (still used for initial pick)
        ├── utils.js                 # unchanged
        ├── log-terminal.js          # NEW
        └── project-switcher.js     # NEW
```

### Structure Rationale

- **log-terminal.js as separate module:** Follows the existing one-concern-per-file pattern. Log polling, rendering, and filter state are unrelated to graph rendering — they must not couple to `renderer.js`.
- **project-switcher.js as separate module:** Project switching triggers a full graph reload (re-fetch + re-init force simulation). This logic is non-trivial and would bloat `graph.js` if inlined. The module owns the dropdown event handler and calls back into `graph.js`'s load function.
- **HiDPI fix in renderer.js:** The canvas size and dpr scaling live entirely in the render path. The fix is isolated to `renderer.js` and the resize handler in `graph.js` — no other modules are affected.
- **Zoom tuning in interactions.js:** The wheel handler delta multiplier is a single constant change. Contained entirely in `interactions.js`.
- **/api/logs in http.js:** Fastify already handles all routes. Adding a log-streaming route here follows the established pattern. No new server file needed.

---

## Architectural Patterns

### Pattern 1: HiDPI Canvas Scaling (devicePixelRatio)

**What:** Canvas elements render at CSS pixel size by default, which appears blurry on Retina/HiDPI displays. The fix sets `canvas.width` and `canvas.height` to CSS size multiplied by `window.devicePixelRatio`, then calls `ctx.scale(dpr, dpr)` before drawing. CSS `width`/`height` stay at the original size.

**When to use:** Always for canvas-based rendering on modern displays. devicePixelRatio is 2 on Retina, 1.5–3 on HiDPI, 1 on standard displays. The fix is backwards-compatible (dpr=1 is a no-op).

**Where it hooks in:** The `resize()` function in `graph.js` and every call to `render()` in `renderer.js`. The resize function sets physical canvas dimensions; `renderer.js` applies the scale transform.

**Example:**
```javascript
// In graph.js resize():
const dpr = window.devicePixelRatio || 1;
canvas.width = container.clientWidth * dpr;
canvas.height = container.clientHeight * dpr;
canvas.style.width = container.clientWidth + 'px';
canvas.style.height = container.clientHeight + 'px';
render();

// In renderer.js render():
const dpr = window.devicePixelRatio || 1;
const W = canvas.width;   // physical pixels
const H = canvas.height;  // physical pixels
ctx.clearRect(0, 0, W, H);
ctx.save();
ctx.scale(dpr, dpr);      // scale to CSS pixels before drawing
// ... existing transform + draw code uses CSS-pixel coordinates unchanged ...
ctx.restore();
```

**Trade-off:** The force-worker sends positions in CSS pixel space. Canvas physical dimensions change with dpr, but `toWorld()` in `utils.js` uses `state.transform` which operates in CSS pixel space. The dpr scale must be applied AFTER `ctx.save()` and BEFORE `ctx.translate/scale` for transform. The existing transform code in `renderer.js` does not need to change — only the outer dpr scale wraps it.

**Font size impact:** Current code uses `Math.round(11 / state.transform.scale)px` for labels. With dpr scaling, this still works correctly because the coordinate system after `ctx.scale(dpr, dpr)` is in CSS pixels. No font size changes needed beyond any design decision to increase baseline sizes for legibility.

### Pattern 2: Persistent Project Switcher (No Page Reload)

**What:** The `#project-select` dropdown already exists in `index.html` but is currently hidden (`style="display: none"`). The project-switcher module populates it from `/projects` and wires an `onchange` handler that triggers a full graph reload — clearing state, stopping the force worker, then re-running the load sequence — without a page navigation.

**When to use:** After initial project load is complete (not during initial picker flow). The existing `showProjectPicker()` modal is still used for the very first load when no URL param is set.

**Data flow:**
```
project-switcher.js init:
    fetch /projects
    → populate #project-select options
    → set selected option to current project (from URL params or state)
    → show #project-select (remove display:none)
    |
#project-select onchange:
    → new project selected
    → state teardown: stop forceWorker, clear graphData, positions, selections
    → update URL param (?hash=... or ?project=...)
    → call loadProject(picked) — same logic as bottom half of graph.js init()
    → re-init force simulation with new data
    → log-terminal re-polls with new project context (no action needed — /api/logs is global)
```

**Trade-off:** Extracting the "load graph data + start simulation" logic from `graph.js init()` into a reusable `loadProject()` function is required. This refactor touches `graph.js` but is low-risk — it's a pure extraction with no logic change.

### Pattern 3: Collapsible Log Terminal (Polling)

**What:** A fixed-height panel below `#canvas-container` that polls `GET /api/logs` every 2 seconds for new log lines. Uses a `since` timestamp query param to fetch only new lines. Renders lines as monospace text with level-based color coding. Supports component filter (dropdown) and text search (input).

**When to use:** For real-time worker observability without WebSocket complexity. Polling every 2s is sufficient for a developer tool. The panel is collapsible to avoid occupying screen real estate when not needed.

**Layout integration:** The body uses `flex-direction: column`. `#canvas-container` has `flex: 1` (takes all remaining space). Adding `#log-panel` as the next sibling with a fixed height (e.g., `200px`) and `flex-shrink: 0` works naturally — the canvas shrinks to accommodate. When log panel is collapsed, it has `height: 0; overflow: hidden`, and canvas-container expands back to fill.

**Example module structure:**
```javascript
// modules/log-terminal.js
let lastTs = null;
let pollTimer = null;

export function initLogTerminal() {
  // Wire filter controls
  document.getElementById('log-search').addEventListener('input', renderLines);
  document.getElementById('log-component').addEventListener('change', renderLines);
  document.getElementById('log-toggle').addEventListener('click', togglePanel);
  startPolling();
}

async function poll() {
  const params = new URLSearchParams();
  if (lastTs) params.set('since', lastTs);
  params.set('limit', '100');
  const component = document.getElementById('log-component').value;
  if (component) params.set('component', component);
  const resp = await fetch(`/api/logs?${params}`);
  if (!resp.ok) return;
  const { lines } = await resp.json();
  if (lines.length > 0) {
    lastTs = lines[lines.length - 1].ts;
    appendLines(lines);
  }
}
```

### Pattern 4: /api/logs Route (Tail + Filter)

**What:** A Fastify GET route that reads the structured JSON log file (`~/.allclear/logs/worker.log`), parses lines, applies `since` / `component` / `limit` filters, and returns `{ lines: [...] }`. Reads the file on each request (no streaming, no watch) — sufficient for 2s polling.

**When to use:** Simple log tail. The log file is append-only and small (worker logs are low-volume — startup, scan events, errors). File read on each poll is acceptable at this scale.

**Route signature:**
```
GET /api/logs
  ?since=<ISO timestamp>    — return only lines with ts > since
  ?component=<string>       — filter by extra.component field (if present)
  ?limit=<number>           — max lines to return (default 200, hard cap 500)

Response: { lines: [{ ts, level, msg, pid, port, component?, ...extra }] }
```

**Server-side implementation sketch:**
```javascript
fastify.get('/api/logs', async (request, reply) => {
  const logFile = path.join(dataDir, 'logs', 'worker.log');
  let raw;
  try {
    raw = fs.readFileSync(logFile, 'utf8');
  } catch {
    return reply.send({ lines: [] });
  }
  const { since, component, limit = '200' } = request.query;
  const cap = Math.min(parseInt(limit, 10) || 200, 500);
  let lines = raw.trim().split('\n').filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
  if (since) lines = lines.filter(l => l.ts > since);
  if (component) lines = lines.filter(l => l.component === component);
  return reply.send({ lines: lines.slice(-cap) });
});
```

**Challenge:** `http.js` currently has no reference to `dataDir` — it only knows the path to the UI files. `dataDir` is known to `worker/index.js` which starts both the HTTP server and the logger. The `dataDir` value must be passed into `createHttpServer()` via the `options` object.

---

## Data Flow

### HiDPI Canvas Fix Flow

```
window.devicePixelRatio (browser API)
    |
    v
graph.js resize() — called on init + window resize
    |
    v
Sets canvas.width/height = container size * dpr
Sets canvas.style.width/height = container CSS size
    |
    v
renderer.js render() — called by force ticks + interactions
    |
    v
ctx.save() → ctx.scale(dpr, dpr) → existing translate/scale transform → draw → ctx.restore()
    |
    v
All coordinates in state.transform and state.positions are CSS-pixel values (unchanged)
All hit-testing in utils.js uses offsetX/offsetY (CSS pixels, unchanged)
```

### Project Switcher Flow

```
graph.js init() completes for first project
    |
    v
graph.js calls project-switcher.js initProjectSwitcher(currentHash)
    |
    v
project-switcher.js: fetch /projects → populate #project-select → show dropdown
    |
    v
User selects different project from dropdown
    |
    v
project-switcher.js onChange:
  state.forceWorker.postMessage({ type: 'stop' })
  state.forceWorker.terminate()
  state.graphData = { nodes: [], edges: [], mismatches: [] }
  state.positions = {}
  state.selectedNodeId = null
  state.blastNodeId = null
  state.blastSet = new Set()
  state.blastCache = {}
    |
    v
update URL params (history.replaceState)
    |
    v
call graph.js loadProject(hash) — extracted from init()
    |
    v
fetch /graph?hash=... → map response → init positions → start new forceWorker → setupInteractions
```

### Log Terminal Polling Flow

```
Browser tab open (log panel visible or collapsed — polling runs regardless)
    |
    v
log-terminal.js: setInterval poll every 2000ms
    |
    v
fetch GET /api/logs?since=<lastTs>&component=<filter>&limit=100
    |
    v
http.js /api/logs route:
  read ~/.allclear/logs/worker.log (readFileSync)
  parse JSON lines
  filter by since + component
  return { lines: [...] }
    |
    v
log-terminal.js: append new lines to #log-lines div
  auto-scroll if user is at bottom
  apply text search filter (client-side, CSS display toggle)
    |
    v
lastTs = last line's ts value (for next poll's since param)
```

### State Management

```
state.js (single shared object — existing pattern, unchanged)
    |
    v (read/write by all modules)
renderer.js    — reads graphData, positions, transform, selections
interactions.js — writes transform, selectedNodeId, blastNodeId, isDragging, isPanning
project-switcher.js — writes currentProject (new field); resets graphData, positions
log-terminal.js — reads/writes logPanelOpen, logFilter, logComponentFilter (new fields)
graph.js — writes everything during init; calls loadProject() on project switch
```

---

## Integration Points

### New Components

| Component | File | Integrates With | Contract |
|-----------|------|-----------------|---------|
| `log-terminal.js` | `worker/ui/modules/log-terminal.js` | `index.html` (#log-panel DOM), `http.js` (/api/logs) | `initLogTerminal()` — called from graph.js after DOM ready |
| `project-switcher.js` | `worker/ui/modules/project-switcher.js` | `index.html` (#project-select DOM), `state.js`, `graph.js` loadProject() | `initProjectSwitcher(currentHash)` — called from graph.js after first load completes |
| `/api/logs` route | `worker/server/http.js` | `worker/index.js` (dataDir), log file at `~/.allclear/logs/worker.log` | GET with since/component/limit params; returns `{ lines: [] }` |

### Modified Existing Components

| Component | What Changes | Why |
|-----------|-------------|-----|
| `state.js` | Add fields: `currentProject`, `logPanelOpen`, `logFilter`, `logComponentFilter` | Log terminal and project switcher need shared state |
| `renderer.js` | Wrap draw sequence in dpr scale: `ctx.scale(dpr, dpr)` after save; remove `dpr` from canvas size logic (that stays in graph.js) | HiDPI fix — crisp rendering on Retina |
| `interactions.js` | Tune wheel zoom: change `1.1 / 0.9` delta to softer values (e.g., `1.05 / 0.95`); optionally cap deltaY for trackpad | Zoom sensitivity — trackpads fire many small deltas |
| `graph.js` | Extract bottom half of `init()` into `loadProject(hash)` function; call `initProjectSwitcher()` and `initLogTerminal()` after first load | Required for project switching without reload |
| `index.html` | Add `#log-panel` section below `#canvas-container`; add CSS for collapsible panel; ensure `#project-select` wiring is ready | New layout elements |
| `worker/server/http.js` | Add `GET /api/logs` route; accept `dataDir` in options object | Log terminal API endpoint |
| `worker/index.js` | Pass `dataDir` to `createHttpServer()` via options | Allows http.js to know where to read log file |

### Unchanged Components

| Component | Reason Unchanged |
|-----------|-----------------|
| `project-picker.js` | Still used for initial empty-URL flow — full-screen modal picker |
| `detail-panel.js` | Node detail overlay — no changes needed |
| `utils.js` | Hit testing and coordinate math — HiDPI fix does not affect CSS-pixel coordinate system |
| `force-worker.js` | D3 simulation — runs in separate thread, position values are CSS pixels, unchanged |
| `worker/index.js` | Only change: pass `dataDir` to `createHttpServer(options)` — one-line addition |

---

## Build Order (v2.1 Phases)

Dependencies determine phase order. The HiDPI fix and zoom tuning are independent of all new modules. The log terminal depends on the `/api/logs` server route. The project switcher depends on the `loadProject()` refactor in `graph.js`.

```
Phase 1 — Canvas Rendering Fixes (no new modules, no server changes):
  renderer.js      HiDPI dpr scaling in render loop
  graph.js         dpr-aware resize() function
  interactions.js  zoom wheel delta tuning
  (Verify: renders crisp on Retina, zoom feels natural)

Phase 2 — Log Terminal API (server side only):
  worker/index.js  pass dataDir to createHttpServer options
  worker/server/http.js  add GET /api/logs route
  (Verify: curl /api/logs returns JSON lines from worker.log)

Phase 3 — Log Terminal UI (depends on Phase 2):
  index.html       add #log-panel HTML structure + CSS
  state.js         add logPanelOpen, logFilter, logComponentFilter fields
  log-terminal.js  new module: polling, rendering, filter controls
  graph.js         call initLogTerminal() in init()
  (Verify: panel shows, logs appear, filter works, collapse works)

Phase 4 — Project Switcher (depends on Phase 1 completion, graph.js refactor):
  graph.js         extract loadProject(hash) from init()
  state.js         add currentProject field
  project-switcher.js  new module: populate dropdown, handle change, call loadProject
  graph.js         call initProjectSwitcher(hash) after first load
  (Verify: dropdown shows all projects, switching reloads graph without page reload)
```

**Critical path:** Phase 1 is independent and highest-value (affects all users immediately). Phase 2 must precede Phase 3. Phase 4 requires the `loadProject()` refactor — do Phase 1 first so the renderer is stable before refactoring graph.js.

**Parallelization:** Phase 2 (server route) can be built in parallel with Phase 1 (canvas fixes) since they touch completely different files.

---

## Anti-Patterns

### Anti-Pattern 1: Applying dpr Scale to Coordinate Math

**What people do:** Multiply `state.transform.x/y` or hit-test coordinates by `devicePixelRatio` when adding HiDPI support.

**Why it's wrong:** `state.transform`, `state.positions`, `e.offsetX/offsetY`, and the force simulation all operate in CSS pixel space. `devicePixelRatio` is purely a canvas buffer size concern — it affects how many physical pixels the canvas draws into, not the logical coordinate system. Multiplying coordinates by dpr breaks hit testing, drag, and pan.

**Do this instead:** Apply `ctx.scale(dpr, dpr)` once after `ctx.save()` at the start of render. The existing `ctx.translate(transform.x, transform.y)` and `ctx.scale(transform.scale, transform.scale)` continue to work exactly as before. Only `canvas.width = container.clientWidth * dpr` changes; all coordinate math is untouched.

### Anti-Pattern 2: Reloading the Page for Project Switching

**What people do:** Set `window.location.href = '/?hash=' + newHash` on project select change.

**Why it's wrong:** Causes a full page reload, losing scroll position, collapsing the log panel, and causing a flash of unstyled content. Also means the force simulation has to re-stabilize every time. With the modular ES module architecture in place, a clean state reset and re-init is straightforward.

**Do this instead:** Stop and terminate the existing forceWorker, clear graphData/positions/selections in state, call the extracted `loadProject(hash)` function. The page DOM (toolbar, panels, controls) stays intact.

### Anti-Pattern 3: Embedding Log Polling in an Existing Module

**What people do:** Add log polling to `graph.js` or `interactions.js` rather than creating a dedicated module.

**Why it's wrong:** The existing modules have single, well-defined concerns (graph rendering, user interactions). Log polling introduces timer management, DOM manipulation for a new panel, and HTTP fetching that have nothing to do with those concerns. Mixing them makes both concerns harder to test and modify independently.

**Do this instead:** `log-terminal.js` as a standalone module. `graph.js` calls `initLogTerminal()` once, then owns nothing else about the log panel.

### Anti-Pattern 4: WebSocket for Log Streaming

**What people do:** Implement a WebSocket in the Fastify server for real-time log push, because "polling is inefficient."

**Why it's wrong:** This is a developer tool used by one person at a time. Polling every 2 seconds is imperceptible. WebSocket adds significant complexity: Fastify WebSocket plugin, connection lifecycle management, reconnect logic on the client. The log file is append-only and tiny. The polling approach is simpler, more debuggable, and more than sufficient.

**Do this instead:** `GET /api/logs?since=<ts>` polled every 2 seconds. The `since` timestamp ensures only new lines are fetched after the first load.

### Anti-Pattern 5: Hardcoding dataDir in http.js

**What people do:** Read `os.homedir() + '/.allclear/logs/worker.log'` directly inside the `/api/logs` route handler in `http.js`.

**Why it's wrong:** `http.js` is created by `worker/index.js` which already resolves `dataDir` from CLI args and environment. Hardcoding in `http.js` breaks the `--data-dir` CLI override (used in tests and non-standard installations), and duplicates the dataDir resolution logic.

**Do this instead:** Pass `dataDir` in the `options` object to `createHttpServer(queryEngine, options)`. The route handler closes over `options.dataDir`. The existing `options` object already carries `port` and `resolveQueryEngine` — adding `dataDir` follows the established pattern.

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Normal use (1 project, small graph) | All four features work with zero scaling concern |
| Large log files (long-running worker, verbose logging) | `/api/logs` reads entire file on each poll — add tail behavior: read last N KB of file instead of full file. At normal log volume (INFO level), files stay small. |
| Many projects in switcher | `/projects` returns all projects; dropdown renders all. No pagination needed for typical use (< 50 projects). |

### Scaling Priorities

1. **First bottleneck:** Log file size for long-running workers. Mitigation: implement log rotation in `worker/index.js` (cap file at 1MB, rotate to `worker.log.1`) — but this is out of scope for v2.1. For now, read only the last 500 lines in the `/api/logs` route.
2. **Second bottleneck:** Force simulation re-run on project switch. The simulation runs up to 300 ticks and is off-thread (Web Worker). For large graphs (100+ services), there is a visible settling period after switch. No mitigation needed in v2.1 — this is inherent to the force layout approach.

---

## Sources

- Direct codebase inspection: `worker/ui/graph.js`, `worker/ui/modules/*.js`, `worker/ui/index.html`, `worker/ui/force-worker.js`
- Direct codebase inspection: `worker/server/http.js`, `worker/index.js`
- MDN Canvas API — devicePixelRatio and HiDPI: https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas#scaling_for_high_resolution_displays
- Fastify static file plugin (@fastify/static): https://github.com/fastify/fastify-static
- AllClear v2.0 architecture: `.planning/research/ARCHITECTURE.md` (v2.0 version)
- AllClear PROJECT.md: `.planning/PROJECT.md`

---
*Architecture research for: AllClear v2.1 UI Polish & Observability*
*Researched: 2026-03-16*
