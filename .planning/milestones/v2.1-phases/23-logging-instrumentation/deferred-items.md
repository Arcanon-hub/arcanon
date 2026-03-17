# Deferred Items — Phase 23 Logging Instrumentation

## Out-of-Scope Discoveries

### 1. console.error in worker/ui/graph.js (browser-side UI)

**Discovered during:** Plan 23-03 final verification sweep
**File:** `worker/ui/graph.js:192`
**Code:** `console.error(err)` inside `init().catch()` handler

**Why deferred:** `worker/ui/graph.js` is browser-side Canvas/D3 UI code — it runs in the browser, not in the Node.js worker process. The phase 23 scope covers Node.js worker process logging only. Browser console.error is appropriate in browser contexts and does not pollute the server-side structured log file.

**Suggested action:** If browser error observability is desired, this could be replaced with a UI error overlay or a fetch to a log endpoint in a future phase. Not urgent — only visible in browser DevTools.
