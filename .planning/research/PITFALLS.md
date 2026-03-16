# Pitfalls Research

**Domain:** Canvas-based developer tool UI — adding HiDPI rendering, zoom/pan controls, real-time log terminal, and project switcher to existing v2.0 D3 Canvas graph
**Researched:** 2026-03-16
**Confidence:** HIGH (MDN official docs confirmed; codebase inspected; community issues cross-referenced)

---

## Critical Pitfalls

### Pitfall 1: HiDPI Canvas — Setting Physical Dimensions Without Scaling the Context

**What goes wrong:**
The canvas element's `width` and `height` attributes control the drawing buffer resolution. CSS `width`/`height` control display size. When they are equal (the current state in `graph.js`: `canvas.width = container.clientWidth`), the canvas draws at 1:1 logical pixels. On a Retina/HiDPI display where `window.devicePixelRatio` is 2 or 3, the browser stretches those logical pixels to fill the physical pixel grid, producing blurry rendering for nodes, labels, and edges.

**Why it happens:**
The distinction between CSS pixels and physical pixels is not obvious when building on standard displays. The current `resize()` function in `graph.js` sets `canvas.width = container.clientWidth` and `canvas.height = container.clientHeight` — CSS pixel values — making the drawing buffer the same resolution as the CSS size. This is the correct size for the display surface but half (or one-third) the resolution needed for crisp rendering on HiDPI screens.

**How to avoid:**
Multiply the drawing buffer by `devicePixelRatio`, set CSS size to the logical dimensions, and scale the 2D context once at the start of every `render()` call (or once after resize):

```javascript
function resize() {
  const dpr = window.devicePixelRatio || 1;
  const cssW = container.clientWidth;
  const cssH = container.clientHeight;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  render();
}
```

Inside `render()`, apply the DPR scale before the transform translate/scale:

```javascript
const dpr = window.devicePixelRatio || 1;
ctx.clearRect(0, 0, canvas.width, canvas.height);
ctx.save();
ctx.scale(dpr, dpr);           // DPR scale first
ctx.translate(state.transform.x, state.transform.y);
ctx.scale(state.transform.scale, state.transform.scale);
// ... draw ...
ctx.restore();
```

**Warning signs:**
- Node labels appear slightly blurry or antialiased on macOS Retina displays
- Taking a screenshot of the canvas reveals fuzzy circles and text compared to surrounding DOM elements
- Text in the detail panel is crisp but canvas labels are noticeably lower quality

**Phase to address:**
HiDPI rendering phase. Must be the first change to `renderer.js` and the `resize()` function. Getting DPR scaling right before adding new drawing code avoids having to re-audit every `ctx` call later.

---

### Pitfall 2: HiDPI Canvas — Mouse Coordinates Are CSS Pixels, Canvas Buffer Is Physical Pixels

**What goes wrong:**
After applying `devicePixelRatio` scaling, the drawing buffer is 2x or 3x larger in each dimension. But `e.offsetX` and `e.offsetY` from mouse events are still delivered in CSS pixels. If `hitTest()` and `toWorld()` in `utils.js` use raw `e.offsetX`/`e.offsetY` against the now-larger canvas, hit detection is off by a factor of `devicePixelRatio` — clicks register on the wrong node or in empty space.

**Why it happens:**
The browser always reports mouse coordinates in CSS pixels, regardless of `devicePixelRatio` or canvas internal scaling. The current `hitTest()` and `toWorld()` functions use `offsetX`/`offsetY` directly, which is correct today (no DPR scaling applied), but breaks the moment DPR scaling is introduced.

**How to avoid:**
Do NOT multiply mouse coordinates by DPR. The DPR scaling is applied to the canvas context inside `render()`, but the mouse coordinates and the `state.transform` object must remain in CSS pixel space throughout. The `toWorld()` function is already correct — it divides by `state.transform.scale` and subtracts the pan offset — as long as `state.transform` is maintained in CSS pixel units and the DPR scale is applied only inside the render context stack (not to the transform state).

The key rule: `state.transform.x`, `state.transform.y`, `state.transform.scale`, and all positions in `state.positions` must stay in CSS pixel units. DPR scaling is a render-time detail only.

**Warning signs:**
- After adding DPR fix, clicking a node no longer selects it — click registers in empty space
- Hit test works at scale=1 but breaks when zoomed
- Tooltip position matches the cursor but the node highlight appears offset

**Phase to address:**
HiDPI rendering phase. Write a manual test: at 2x DPR, click on a visible node and verify it selects. Verify pan and zoom still work correctly. This is the most common integration failure when applying the DPR fix.

---

### Pitfall 3: Canvas Width/Height Assignment During Resize Resets the Drawing Context

**What goes wrong:**
Setting `canvas.width` or `canvas.height` — even to the same value — resets the entire 2D rendering context to default state: clears the canvas, resets all style properties (`fillStyle`, `strokeStyle`, `lineWidth`), and discards all saved context states (`ctx.save()` stack). The current `resize()` function in `graph.js` sets `canvas.width` and then calls `render()` which rebuilds everything correctly. But if anyone adds `ctx.save()` calls that span a resize event (e.g., during an animation loop), those saved states are silently lost.

**Why it happens:**
This is specified HTML Canvas behavior (MDN: "Setting the width or height property resets the rendering context to its default state"). Developers expect property assignment to be non-destructive. In a continuous render loop with Web Workers posting messages, a resize mid-frame can corrupt in-flight state.

**How to avoid:**
The current pattern of calling `render()` immediately after `canvas.width = ...` is correct — the full redraw re-establishes all state. The risk is in the Web Worker message handler: `state.forceWorker.onmessage` calls `render()` on every tick. If a resize fires during a tick, `render()` is called with a valid context. This is safe because `render()` always starts with `ctx.clearRect()` and `ctx.save()`. Preserve this invariant: never hold persistent state in the 2D context between frames.

**Warning signs:**
- Canvas goes black intermittently after window resize
- Styles appear different after resize (wrong colors, wrong line widths)
- `ctx.restore()` throws "IndexSizeError" in console (mismatched save/restore stack after resize)

**Phase to address:**
HiDPI rendering phase (same phase as Pitfall 1 and 2). Handled by maintaining the existing render-from-scratch pattern.

---

### Pitfall 4: Wheel Event Passive Flag Conflict — Zoom Fails Silently in Chrome

**What goes wrong:**
The current `interactions.js` correctly adds `{ passive: false }` to the wheel event listener, allowing `e.preventDefault()` to block page scroll during zoom. This works today. The risk arises when refactoring or when someone adds a second wheel listener elsewhere (e.g., inside the log terminal container) without the `{ passive: false }` flag. Chrome/Safari treat document-level wheel/touch events as passive by default. Calling `e.preventDefault()` inside a passive listener generates a warning in the console and the default scroll behavior is NOT suppressed — the page scrolls instead of zooming.

**Why it happens:**
Browsers introduced passive listeners to improve scroll performance on touch devices. Any wheel listener attached without `{ passive: false }` on a Canvas element will silently fail to prevent default scroll. The error message ("Unable to preventDefault inside passive event listener") appears in the console but does not throw — the developer may not notice until testing on a touchpad-heavy device.

**How to avoid:**
The existing canvas wheel listener is correct. When adding the log terminal panel, if the terminal container also needs scroll-independent behavior, each scroll-intercepting listener needs explicit `{ passive: false }`. Document this constraint in a comment on both listeners so it is not accidentally removed during refactoring:

```javascript
// { passive: false } is required — without it, e.preventDefault() is silently ignored
// and the browser scrolls the page instead of zooming the canvas.
canvas.addEventListener('wheel', handler, { passive: false });
```

**Warning signs:**
- Console warning: "Unable to preventDefault inside passive event listener due to target being treated as passive"
- Zoom works on some browsers/versions but not others
- Canvas scrolls vertically when user intends to zoom via trackpad

**Phase to address:**
Zoom/pan tuning phase. Add a comment to the existing wheel listener now to prevent regression. When adding the terminal panel, apply the same flag to any scroll interceptor in the terminal.

---

### Pitfall 5: Trackpad Two-Finger Scroll vs. Pinch-to-Zoom — Both Fire as `wheel` Events

**What goes wrong:**
On macOS with a trackpad, two-finger scroll and pinch-to-zoom both arrive as `wheel` events. The current implementation uses `e.deltaY` with a fixed multiplier (`delta = e.deltaY < 0 ? 1.1 : 0.9`) — this treats ALL wheel input as zoom. On a trackpad, a two-finger scroll to read the page becomes an unintended zoom gesture. The user gets unexpected zoom when they want to pan vertically.

**Why it happens:**
Trackpad pinch events have `e.ctrlKey === true` (this is a browser convention, not a real Ctrl press). Regular two-finger scroll has `e.ctrlKey === false`. Developers miss this distinction and use a single `deltaY` handler for all wheel input.

**How to avoid:**
Check `e.ctrlKey` to distinguish pinch from scroll. If `ctrlKey` is true, the event is a pinch — apply zoom. If `ctrlKey` is false, the event is a two-finger scroll — apply pan:

```javascript
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.ctrlKey) {
    // Pinch-to-zoom (trackpad) or Ctrl+scroll (mouse)
    const delta = e.deltaY < 0 ? 1.1 : 0.9;
    // ... apply zoom ...
  } else {
    // Two-finger scroll (trackpad) — pan instead
    state.transform.x -= e.deltaX;
    state.transform.y -= e.deltaY;
    render();
  }
}, { passive: false });
```

**Warning signs:**
- User reports "zooms too aggressively when scrolling" on a MacBook
- Two-finger scroll on a trackpad zooms instead of panning
- Mouse wheel zoom works correctly but trackpad feels wrong

**Phase to address:**
Zoom/pan sensitivity tuning phase. This is a targeted change to `interactions.js` wheel handler.

---

### Pitfall 6: Project Switcher — No State Teardown Before Loading New Graph Data

**What goes wrong:**
The current `graph.js` `init()` is a one-shot function: load project, initialize force worker, attach interaction listeners, render. When the persistent project switcher dropdown is added (switch project without full page reload), calling `init()` again or partially re-running it without tearing down the previous state causes:

1. Two `state.forceWorker` Web Workers running simultaneously — both posting position updates, causing visual flicker and unpredictable node positions.
2. Duplicate event listeners on the canvas — every `addEventListener` from `setupInteractions()` called again adds a second listener. Clicks now fire twice. Pan fires twice.
3. `state.positions` from the previous project leaking into the new render if not cleared — ghost positions from project A appear briefly when switching to project B.
4. The `state.blastCache` from project A persisting into project B — impact queries return wrong results until cache is invalidated.

**Why it happens:**
`init()` was designed as a one-shot startup, not as a re-entrant function. Adding a project switcher is the first time the UI needs to re-initialize. None of the existing teardown steps exist because they were never needed.

**How to avoid:**
Before re-initializing for a new project, execute a full teardown:

```javascript
function teardown() {
  // 1. Terminate the force worker
  if (state.forceWorker) {
    state.forceWorker.terminate();
    state.forceWorker = null;
  }
  // 2. Remove all canvas event listeners (use named functions, not anonymous)
  canvas.removeEventListener('mousemove', onMouseMove);
  canvas.removeEventListener('mousedown', onMouseDown);
  // etc.
  // 3. Reset all state
  state.graphData = { nodes: [], edges: [], mismatches: [] };
  state.positions = {};
  state.selectedNodeId = null;
  state.blastNodeId = null;
  state.blastSet = new Set();
  state.blastCache = {};
  state.transform = { x: 0, y: 0, scale: 1 };
}
```

This requires that all event handler functions in `setupInteractions()` be named (not anonymous) so they can be removed. Currently they are anonymous arrow functions — this must change before adding the project switcher.

**Warning signs:**
- Clicking a node selects it twice (detail panel opens and immediately closes)
- Console shows two Web Workers consuming CPU after first project switch
- Positions from the previous project flash on-screen for one frame when switching
- Impact query (Shift+click) returns results from the wrong project

**Phase to address:**
Project switcher phase. Refactor `setupInteractions()` to use named functions before implementing the dropdown. Implement and test teardown before any data loading.

---

### Pitfall 7: SSE Log Stream — Server Memory Leak from Zombie Connections

**What goes wrong:**
The log terminal streams worker logs to the browser via Server-Sent Events (SSE). When the browser tab is closed or refreshed, the SSE connection closes. If the Fastify HTTP server's `request.raw.on('close', ...)` handler is not registered, the server-side `res` object remains in the active connections list indefinitely. Over hours of development use (multiple tab closes, log panel opens/closes), zombie SSE connections accumulate, and the Node.js worker process leaks memory progressively.

**Why it happens:**
SSE endpoints keep the HTTP response open — they never call `res.end()` until the stream terminates. When the client disconnects unexpectedly (tab close, network drop), the server is notified via the `request.raw.on('close')` event, not via an explicit close call. Developers who implement SSE for the first time often miss this event and never clean up the connection from their active clients set.

**How to avoid:**
Every SSE endpoint handler in the Fastify server must register a cleanup callback on the raw request close event:

```javascript
const clients = new Set();

fastify.get('/logs/stream', (request, reply) => {
  reply.raw.setHeader('Content-Type', 'text/event-stream');
  reply.raw.setHeader('Cache-Control', 'no-cache');
  reply.raw.setHeader('Connection', 'keep-alive');
  reply.raw.flushHeaders();

  const send = (data) => reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  clients.add(send);

  // Critical: clean up on client disconnect
  request.raw.on('close', () => {
    clients.delete(send);
  });
});
```

**Warning signs:**
- Worker process memory increases monotonically across development sessions
- `clients` Set grows without bound (add a `console.error` log for Set size on each connection)
- Worker crashes with out-of-memory error after several hours of use

**Phase to address:**
Log terminal phase. The close event handler must be present in the first SSE endpoint implementation — not added after observing the leak.

---

### Pitfall 8: SSE Log Stream — Unbounded Log Buffer Causing DOM Memory Growth

**What goes wrong:**
If the log terminal appends every SSE event as a new DOM element (e.g., `div` per log line) without any upper bound, and the worker emits logs at high frequency during a scan (hundreds of log lines per second), the log panel DOM grows without limit. After a long scan session, the browser tab consumes hundreds of MB of memory, the log panel becomes unresponsive, and scrolling is janky.

**Why it happens:**
Naive log terminal implementations: `const line = document.createElement('div'); line.textContent = data.message; logContainer.appendChild(line)`. There is no cap on `logContainer.children.length`.

**How to avoid:**
Maintain a ring buffer: cap the DOM at N lines (e.g., 500). When the buffer is full, remove the oldest line before appending the new one:

```javascript
const MAX_LOG_LINES = 500;

function appendLog(message) {
  const line = document.createElement('div');
  line.className = 'log-line';
  line.textContent = message;
  logContainer.appendChild(line);

  while (logContainer.children.length > MAX_LOG_LINES) {
    logContainer.removeChild(logContainer.firstChild);
  }

  // Auto-scroll only if user is already at the bottom
  if (isAtBottom(logContainer)) {
    logContainer.scrollTop = logContainer.scrollHeight;
  }
}
```

**Warning signs:**
- After a full repo scan, the browser tab memory in DevTools shows > 100 MB
- Scrolling the log panel becomes sluggish after 1000+ log lines
- `logContainer.children.length` in console grows without stopping

**Phase to address:**
Log terminal phase. Implement the ring buffer in the first version of the log terminal — not as an optimization added later.

---

### Pitfall 9: SSE Auto-Reconnect Flooding the Server on Worker Restart

**What goes wrong:**
`EventSource` automatically reconnects when the connection drops. When the worker restarts (e.g., after a version mismatch, or during development with nodemon), all browser tabs with the log terminal open immediately attempt to reconnect. If several browser tabs are open simultaneously, they all reconnect at the same instant and flood the just-starting worker with SSE connections before it has finished initializing.

**Why it happens:**
The default SSE reconnect delay is 3 seconds, but all clients retry at the same time (they all got disconnected simultaneously). There is no jitter. With 3 open tabs, the worker receives 3 simultaneous SSE connections 3 seconds after startup — typically before the database connection pool is initialized.

**How to avoid:**
Add a `retry:` field to the SSE stream with per-client jitter:

```javascript
// Send initial retry with jitter (2000-5000ms)
const jitter = 2000 + Math.random() * 3000;
reply.raw.write(`retry: ${Math.round(jitter)}\n\n`);
```

Also, ensure the SSE endpoint is registered after all critical initialization (DB, scan state) completes in the worker startup sequence. The health check endpoint (`/health`) should gate SSE connections if the worker is not yet ready.

**Warning signs:**
- Worker logs show a burst of SSE connections immediately after restart
- Worker crashes on restart due to DB initialization race (SSE handler fires before DB is open)
- Multiple browser tabs all reconnect at t+3s exactly (no jitter visible in logs)

**Phase to address:**
Log terminal phase. Add the retry jitter to the first SSE implementation. Cross-reference worker startup ordering.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skip DPR scaling, use `canvas.width = container.clientWidth` | Simpler resize logic | Blurry rendering on all Retina/HiDPI displays; labels unreadable at scale | Never — DPR fix is 5 lines |
| Anonymous arrow functions in `setupInteractions()` | Slightly less code | Cannot remove listeners; project switch causes duplicate handlers; must rewrite before adding switcher | Never — name all handlers from the start |
| Hard-code `devicePixelRatio = 2` | Works for most Macs today | Wrong on 3x displays, wrong on 1x screens (wastes GPU memory), will break on new hardware | Never — always use `window.devicePixelRatio || 1` |
| Append unlimited log lines to DOM | Simplest implementation | Tab memory bloat after long scans; log panel janks at 1000+ lines | Never — ring buffer is trivial |
| Skip SSE `request.raw.on('close')` cleanup | Saves 3 lines | Worker memory leaks monotonically across dev sessions; eventually crashes | Never — close handler is mandatory for SSE correctness |
| Full page reload for project switch | Zero teardown code needed | Loses zoom/pan position; loses selection state; visible flash | Acceptable for MVP; replace with soft switch in follow-up |
| Merge DPR scale into `state.transform` | Fewer ctx.scale() calls | Confuses CSS-pixel coordinates with physical-pixel coordinates; breaks hit testing | Never — DPR scale is a render-time detail, not a logical transform |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Canvas 2D + HiDPI | Applying DPR scale to `e.offsetX`/`e.offsetY` (mouse coordinates) | Mouse coordinates are always CSS pixels — only the context drawing scale is DPR-adjusted, never the input coordinates |
| Canvas resize + force worker | Sending old `canvas.width`/`canvas.height` to force worker after resize | After DPR fix, `canvas.width` is `cssW * dpr`; send CSS dimensions (divide by DPR) to the force worker for layout bounds |
| SSE + Fastify | Using `reply.send()` instead of writing to `reply.raw` | `reply.send()` ends the HTTP response; SSE requires writing to `reply.raw` with the connection held open |
| Wheel event + log terminal | Adding a scroll listener to the terminal container without `{ passive: false }` | Both the canvas zoom handler and any terminal scroll interception need `{ passive: false }` to call `e.preventDefault()` |
| Project switcher + Web Worker | Calling `worker.terminate()` and then immediately starting a new worker | `terminate()` is asynchronous internally; new worker postMessage may fire before old worker has exited if positions overlap in the state object — always null-check `state.forceWorker` |
| ES modules + no bundler | Using bare specifier imports (`import { x } from 'lodash'`) | Without import maps or a bundler, bare specifiers throw in browser. All imports must use relative paths (`./modules/state.js`) or CDN URLs with full path |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| DPR × scale multiplied without CSS size fix | Canvas renders at 4x resolution (2x DPR × 2x CSS upscale) — wasted GPU work | Set `canvas.style.width = cssW + 'px'` as well as `canvas.width = cssW * dpr` | Immediately on any HiDPI display where CSS size is not constrained |
| DOM log terminal without ring buffer | Browser tab memory > 100 MB after scan; log scroll jank | Cap DOM at 500 lines; remove oldest on append | After 500+ log events (one medium scan) |
| Continuous `render()` from force worker while SSE also triggers renders | Main thread renders at 60 fps from Web Worker ticks AND additionally re-renders on every log event | Separate render loop (rAF-gated) from log appends; log terminal is DOM-only, does not trigger canvas redraw | Immediately when log events arrive at > 10 hz during scan |
| Project switch without worker termination | Two Web Workers posting positions → 120 `render()` calls/second → visible flicker | Terminate old worker before starting new one | On first project switch if teardown is skipped |
| SSE zombie connections | Worker memory grows 1-5 MB per abandoned connection | Register `request.raw.on('close', cleanup)` on every SSE endpoint | After 10+ tab-open/close cycles in a development session |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| SSE log endpoint with no filtering | Internal file paths, env vars, secrets appearing in worker logs stream to browser | Filter log messages server-side; redact lines matching `/(key|secret|token|password)/i` before streaming to SSE |
| SSE endpoint accessible without project isolation | Log events from project A visible to a browser tab viewing project B | Scope SSE streams by project identifier; reject connections that don't specify a valid project parameter |
| `reply.raw.write()` with unsanitized log text | Log injection: a crafted log message containing `\n\ndata:` could inject fake SSE events | Sanitize log text: strip newlines and SSE control characters before writing |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Auto-scroll overrides user scroll position in log terminal | Developer scrolls up to read an old log line; terminal snaps back to bottom on next event | Only auto-scroll when the user's scroll position is already at the bottom (within 20px) |
| Project switch resets zoom/pan to origin | After switching projects, the graph always starts at scale=1, pan=(0,0) — annoying if the user had a useful view | Persist last zoom/pan per project in `sessionStorage`; restore on project load |
| Log terminal open by default takes vertical space from graph | On small screens (13" laptop), the graph area is cut in half | Log terminal starts collapsed; user must explicitly open it; remember state in `sessionStorage` |
| Project switcher dropdown shows hash strings instead of names | `__hash__abc123` is not a useful project name for a dropdown | Show folder name from `projectRoot` path; fall back to first 8 chars of hash only if path is missing |
| Zoom sensitivity same for mouse wheel and trackpad | Mouse wheel (large deltaY increments) and trackpad two-finger scroll (tiny deltaY increments) need different multipliers | Detect input type via `e.deltaMode` and presence of `ctrlKey`; apply different sensitivity scaling |

---

## "Looks Done But Isn't" Checklist

- [ ] **HiDPI rendering:** Verify canvas nodes are pixel-crisp on a Retina display — capture a screenshot and inspect at 1:1 pixel zoom; labels should have no antialiasing blur
- [ ] **HiDPI hit testing:** After applying DPR fix, click exactly on a node on a 2x display and verify it selects (not the empty space beside it)
- [ ] **Wheel event on scroll overlay:** Open the log terminal panel positioned over the canvas; scroll inside the terminal; verify the canvas does NOT zoom simultaneously
- [ ] **Project switch teardown:** Switch projects 3 times rapidly; verify `ps` shows exactly one Web Worker process, and no duplicate event listeners fire (instrument with a counter)
- [ ] **SSE cleanup:** Open the log terminal, close the browser tab, reopen — verify the server's active connections count returns to 0 (add a `/debug/connections` endpoint to check)
- [ ] **Log ring buffer:** Trigger a full scan and let it run; verify `logContainer.children.length` never exceeds the cap (500) in DevTools
- [ ] **SSE reconnect jitter:** Restart the worker while 3 browser tabs are open; verify reconnect times are spread out (not all at exactly t+3s)
- [ ] **Trackpad vs mouse wheel:** Test on a trackpad — two-finger scroll should pan, not zoom; pinch should zoom, not pan
- [ ] **Canvas resize with DPR:** Resize the browser window; verify graph is not blurry at the new size (DPR scaling must reapply in the resize handler)
- [ ] **Force worker dimensions after resize:** After a window resize, verify the force simulation layout respects the new canvas CSS dimensions (not the physical pixel dimensions)

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Blurry canvas after HiDPI fix (incorrect implementation) | LOW | Verify `canvas.style.width`/`height` CSS properties are set to CSS pixel values; verify DPR scale is applied inside `ctx.save()`/`ctx.restore()` block, not to `state.transform` |
| Duplicate event listeners after project switch | MEDIUM | Audit `setupInteractions()` to replace all anonymous arrow functions with named functions; add `AbortController` as alternative to named-function removal |
| SSE memory leak already in production | MEDIUM | Add `request.raw.on('close', cleanup)` to all existing SSE endpoints; restart worker to reset current connections |
| Log DOM bloat causing tab slowdown | LOW | Add ring buffer cap; call `logContainer.innerHTML = ''` to clear existing DOM immediately |
| Wrong zoom behavior on trackpad | LOW | Add `e.ctrlKey` check to wheel handler; 2-line change to `interactions.js` |
| Force worker receiving physical pixel canvas dimensions | LOW | Audit all places `canvas.width` and `canvas.height` are passed to force worker; divide by `devicePixelRatio` before passing |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| HiDPI blurry rendering | HiDPI canvas rendering phase | Screenshot at 2x DPR shows crisp nodes and labels |
| Mouse coordinate mismatch after DPR fix | HiDPI canvas rendering phase | Click test on 2x display selects node under cursor |
| Canvas resize clears context state | HiDPI canvas rendering phase (same) | Resize window 5 times; no visual corruption, no console errors |
| Passive wheel event conflict | Zoom/pan tuning phase | No console warning about passive listeners; zoom works in Chrome, Firefox, Safari |
| Trackpad vs mouse wheel sensitivity | Zoom/pan tuning phase | Trackpad two-finger scroll pans; pinch zooms; mouse wheel zooms |
| Project switch state teardown | Project switcher phase | 3 rapid project switches show 1 worker, 0 duplicate handlers |
| SSE zombie connection leak | Log terminal phase | Server connection count returns to 0 after all browser tabs closed |
| DOM log buffer unbounded growth | Log terminal phase | After full scan, log DOM node count stays <= 500 |
| SSE reconnect flood after worker restart | Log terminal phase | 3 tabs reconnect with spread-out retry timing visible in logs |

---

## Sources

- [MDN: HTMLCanvasElement.width — context reset on assignment](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/width) — Documents the context reset behavior on width/height assignment
- [MDN: Window.devicePixelRatio](https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio) — DPR definition, ResizeObserver `devicePixelContentBoxSize` usage
- [web.dev: High DPI Canvas](https://web.dev/articles/canvas-hidipi) — Official Google guidance on DPR scaling pattern
- [kirupa.com: Canvas High-DPI Retina rendering](https://www.kirupa.com/canvas/canvas_high_dpi_retina.htm) — Practical three-step pattern (buffer size, context scale, CSS size)
- [MDN: Element.wheel event](https://developer.mozilla.org/en-US/docs/Web/API/Element/wheel_event) — deltaMode, passive listener behavior
- [tigerabrodi.blog: Trackpad pinch-to-zoom vs scroll in Canvas](https://tigerabrodi.blog/how-to-handle-trackpad-pinch-to-zoom-vs-two-finger-scroll-in-javascript-canvas-apps) — ctrlKey convention for trackpad pinch detection
- [Excalibur.js Issue #1195: wheel passive event listener](https://github.com/excaliburjs/Excalibur/issues/1195) — Real-world example of passive wheel event breaking canvas zoom
- [expressjs/express Issue #2248: EventSource memory leak](https://github.com/expressjs/express/issues/2248) — Server-side SSE connection accumulation without close handler
- [MDN: EventSource.close()](https://developer.mozilla.org/en-US/docs/Web/API/EventSource/close) — Client-side cleanup requirement
- [nestjs/nest Issue #11601: SSE memory leak](https://github.com/nestjs/nest/issues/11601) — Server-side SSE cleanup patterns
- [ben-botto/Medium: Zooming at Mouse Coordinates with Affine Transforms](https://medium.com/@benjamin.botto/zooming-at-the-mouse-coordinates-with-affine-transformations-86e7312fd50b) — Correct zoom-to-cursor formula (matches current implementation)
- Codebase inspection: `worker/ui/modules/renderer.js`, `interactions.js`, `state.js`, `utils.js`, `graph.js`, `project-picker.js` — Confirmed specific anti-patterns (anonymous handlers, no DPR scaling, no teardown)

---

*Pitfalls research for: AllClear v2.1 — UI Polish & Observability (HiDPI canvas, zoom/pan, log terminal, project switcher)*
*Researched: 2026-03-16*
