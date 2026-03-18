# Phase 32: UI Detail Panels - Research

**Researched:** 2026-03-17
**Domain:** Browser UI — detail panel routing and rendering in a vanilla ES module graph UI
**Confidence:** HIGH — all findings based on direct source code inspection

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PANEL-01 | `getNodeType()` in `utils.js` recognizes `infra` type and returns correct classification | `getNodeType()` confirmed at line 39–46 of utils.js — currently has no `infra` guard; falls through to `return 'service'` |
| PANEL-02 | `showDetailPanel()` dispatch routes infra nodes to an infra-specific renderer instead of falling through to service renderer | `showDetailPanel()` confirmed at line 43–49 of detail-panel.js — currently uses `isLib` boolean; no infra branch exists |
| PANEL-03 | Library detail panel shows exported types/interfaces grouped by category (functions vs types) and lists which services consume the library | `renderLibraryConnections()` exists at lines 61–96 but renders connection edges only (no `node.exposes`); classification by presence of `(` is the prescribed approach |
| PANEL-04 | Infra detail panel shows managed resources grouped by prefix (k8s:deployment, k8s:configmap, etc.) and lists which services are provisioned by this infra | `renderInfraConnections()` does not exist; `renderServiceConnections()` is confirmed at lines 98–138 as the prior fallthrough target |
</phase_requirements>

---

## Summary

Phase 32 is a pure UI phase that adds type-specific rendering for library and infra nodes in the detail panel. All upstream data work (storage fix in Phase 30, `getGraph()` exposes attachment in Phase 31) must already be complete. Phase 32 consumes `node.exposes` — an array of `{kind, method, path}` objects already present on each node by the time Phase 32 begins — and routes panel rendering through a three-way dispatch based on node type.

The scope is contained to two files: `worker/ui/modules/utils.js` (add `infra` guard to `getNodeType()` and `getNodeColor()`) and `worker/ui/modules/detail-panel.js` (update routing, extend `renderLibraryConnections()`, add `renderInfraConnections()`). A one-line change to `state.js` adds the infra color constant. The service panel (`renderServiceConnections()`) is untouched.

The critical ordering constraint identified in STATE.md is: `getNodeType()` infra guard must be committed before the panel routing change — if the guard is missing, infra nodes return `"service"` and the infra renderer branch is never reached. This maps to the two planned tasks: 32-01 (utils.js + state.js) then 32-02 (detail-panel.js).

**Primary recommendation:** Fix the type-detection gap in `utils.js` first (Task 32-01), then implement panel routing and renderers in `detail-panel.js` (Task 32-02). Do not merge 32-02 without 32-01 in place.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vanilla ES modules | Browser-native | UI module system | Already in use across all UI modules; no build step |
| better-sqlite3 | ^12.8.0 | SQLite (upstream only) | Phase 32 has no DB work; mentioned for context |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Node.js `--test` runner | Built-in (Node >=20) | Test execution | Used for all existing project tests; no Jest/Vitest |

### No New Dependencies
Phase 32 adds no new libraries. All rendering uses the existing HTML string concatenation pattern already established in `detail-panel.js`.

---

## Architecture Patterns

### Existing Module Structure (unchanged in Phase 32)
```
worker/ui/modules/
├── state.js          # MODIFIED: add infra to NODE_TYPE_COLORS
├── utils.js          # MODIFIED: getNodeType() + getNodeColor() infra guard
├── detail-panel.js   # MODIFIED: routing + renderLibraryConnections() + new renderInfraConnections()
├── interactions.js   # unchanged
├── renderer.js       # unchanged
└── project-picker.js # unchanged
```

### Pattern 1: HTML String Concatenation for Panel Rendering
**What:** All panel renderers build HTML as string concatenation and assign to `content.innerHTML`. No virtual DOM, no template engine.
**When to use:** Consistent with entire detail-panel.js. All new rendering must use this pattern.
**Example:**
```javascript
// Source: worker/ui/modules/detail-panel.js (existing pattern)
let html = '';
html += `<div class="detail-section">
  <div class="detail-label">Exports (${exports.length})</div>`;
for (const ex of exports) {
  html += `<div class="connection-item">
    <div class="conn-path">${escapeHtml(ex.path)}</div>
  </div>`;
}
html += `</div>`;
```

### Pattern 2: Three-Way Dispatch in showDetailPanel()
**What:** Replace current two-branch `isLib` boolean with explicit `nodeType` string comparison.
**When to use:** Required — third branch (infra) cannot be expressed as a boolean.
**Example:**
```javascript
// Source: worker/ui/modules/detail-panel.js (current — replace the isLib block)
if (nodeType === 'infra') {
  html += renderInfraConnections(node, outgoing, nameById);
} else if (nodeType === 'library' || nodeType === 'sdk') {
  html += renderLibraryConnections(node, outgoing, incoming, nameById);
} else {
  html += renderServiceConnections(outgoing, incoming, nameById);  // unchanged
}
```

### Pattern 3: getNodeType() Guard Order
**What:** `infra` guard must be the FIRST check in `getNodeType()`, before the name-based heuristic checks.
**When to use:** Required — a node with `type: 'infra'` and name `"k8s-infra"` would incorrectly match the name heuristic for `library` if the explicit type check comes second.
**Example:**
```javascript
// Source: worker/ui/modules/utils.js (current — insert infra guard as first line)
export function getNodeType(node) {
  if (node.type === 'infra') return 'infra';                          // ADD FIRST
  if (node.type === 'library' || node.type === 'sdk') return node.type;
  if (node.name && /sdk|lib|client|shared|common/i.test(node.name)) return 'library';
  if (node.name && /ui|frontend|web|dashboard|app/i.test(node.name)) return 'frontend';
  return 'service';
}
```

### Pattern 4: Export Classification (functions vs types)
**What:** Classify library exports by presence of `(` — strings containing `(` are functions; others are types. Pure string check, no AST.
**When to use:** In `renderLibraryConnections()` when iterating `node.exposes` with `kind === 'export'`.
**Example:**
```javascript
// Source: FEATURES.md + ARCHITECTURE.md (design spec, HIGH confidence)
const exports = (node.exposes || []).filter(e => e.kind === 'export');
const functions = exports.filter(e => e.path.includes('('));
const types    = exports.filter(e => !e.path.includes('('));
```

### Pattern 5: Infra Resource Grouping by Prefix
**What:** Group resources by prefix string before first `/`. The agent produces `"k8s:deployment/name"`, `"tf:output/name"`, `"helm:values/name"`, `"compose:service/name"` — the prefix is the substring up to and including `:` then up to `/`.
**When to use:** In `renderInfraConnections()` when iterating `node.exposes` with `kind === 'resource'`.
**Example:**
```javascript
// Source: agent-prompt-infra.md + ARCHITECTURE.md (HIGH confidence)
const resources = (node.exposes || []).filter(e => e.kind === 'resource');
const byPrefix = {};
for (const r of resources) {
  const prefix = r.path.split('/')[0];  // "k8s:deployment", "tf:output", etc.
  if (!byPrefix[prefix]) byPrefix[prefix] = [];
  byPrefix[prefix].push(r);
}
```

### Pattern 6: Source Inspection Tests (no DOM, no jsdom)
**What:** Tests in this project use static source inspection (`readFileSync` + `src.includes(...)`) or lightweight Node EventTarget mocks. They do NOT use jsdom or a headless browser.
**When to use:** All UI tests in this project follow this pattern. Tests for detail-panel.js and utils.js must use source inspection only.
**Example:**
```javascript
// Source: worker/ui/modules/interactions.test.js (existing project pattern)
import { readFileSync } from 'fs';
const src = readFileSync(join(__dirname, 'detail-panel.js'), 'utf8');
check(src.includes("renderInfraConnections"), "renderInfraConnections defined");
```

### Anti-Patterns to Avoid
- **Adding `infra` to panel without fixing `getNodeType()` first:** Without the guard in `utils.js`, `showDetailPanel()` always sees `nodeType === 'service'` for infra nodes and the new branch is dead code.
- **Using `isInfra` boolean:** The current `isLib` boolean pattern cannot extend to three types. Replace with `nodeType` string comparison.
- **Parsing `node.type` directly in detail-panel.js:** `detail-panel.js` imports and delegates to `getNodeType()`. This indirection is intentional — do not bypass it with a direct `node.type` check inside the panel.
- **Fetching exposes per click:** Phase 31 attaches `exposes` to node objects at graph load time. Phase 32 reads `node.exposes` directly — no additional API calls.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Export classification | Custom parser for TypeScript signatures | `str.includes('(')` check | Function vs type distinction is purely syntactic; signatures from the agent already use `functionName(...)` vs `TypeName` format — no parsing needed |
| Prefix extraction | Regex for k8s/tf/helm prefix patterns | `str.split('/')[0]` | Agent always emits `"prefix:subtype/name"` format; the first `/` always divides prefix+subtype from name |
| Dedup of "Used by" consumers | Custom dedup algorithm | `new Set()` | Already implemented in existing `renderLibraryConnections()` at lines 81–84; keep as-is |
| XSS escaping | Custom HTML sanitizer | `escapeHtml()` helper (to be added) or textContent assignment | `ex.path` contains user-controlled strings from scan output; must be escaped before innerHTML insertion |

**Key insight:** All display logic in Phase 32 is classification and grouping of pre-structured strings. The data classification happened at storage time (Phase 30) and the data is already on the node object (Phase 31). Phase 32 is entirely a rendering concern.

---

## Common Pitfalls

### Pitfall 1: getNodeType() Infra Guard Position
**What goes wrong:** Adding the infra guard after the name-heuristic checks means a node with `type: 'infra'` and name matching `"k8s-infra-lib"` gets classified as `'library'` instead of `'infra'`.
**Why it happens:** The name heuristic `/sdk|lib|client|shared|common/i.test(node.name)` runs before the explicit type check if the guard is placed last.
**How to avoid:** Insert the `if (node.type === 'infra') return 'infra'` guard as the FIRST line of `getNodeType()`, before all name heuristics.
**Warning signs:** Infra nodes showing the library panel instead of the infra panel.

### Pitfall 2: getNodeColor() Missing Infra Guard
**What goes wrong:** `getNodeColor()` in `utils.js` also has explicit type checks for `library`/`sdk` — there is no infra path. Without a corresponding infra guard in `getNodeColor()`, infra nodes render in the default service color (`#4299e1`) even after `getNodeType()` is fixed.
**Why it happens:** The two functions (`getNodeType()` and `getNodeColor()`) have parallel logic but are independent. Fixing one without the other leaves a visual inconsistency.
**How to avoid:** Apply the same infra guard to both functions in the same commit (Task 32-01). Also add `infra: '#68d391'` to `NODE_TYPE_COLORS` in `state.js`.
**Warning signs:** Infra nodes display correct panel content but still show as blue service-colored circles.

### Pitfall 3: XSS via Unescaped Exposes Strings
**What goes wrong:** `ex.path` and `r.path` contain raw text from scan results — function signatures like `createClient(config: ClientConfig): EdgeworksClient` or resource refs like `k8s:deployment/payment-service`. These are user-controlled strings that flow into `innerHTML`.
**Why it happens:** The HTML string concatenation pattern used throughout `detail-panel.js` puts dynamic content directly into template literals with `${}`. If the content contains `<`, `>`, or `&`, the browser will interpret them as HTML.
**How to avoid:** Apply HTML escaping to any value inserted via `${}` in the template literals of the new render functions. A minimal `escapeHtml()` helper (`str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')`) is sufficient. This is documented as a known concern in STATE.md.
**Warning signs:** Any angle brackets in a function signature (e.g., `Promise<Response>`) rendering as invisible HTML tags.

### Pitfall 4: renderLibraryConnections() Signature Change Breaks Callers
**What goes wrong:** Adding `node` as a new first parameter to `renderLibraryConnections()` while the call site in `showDetailPanel()` still passes the old 3-argument signature `(outgoing, incoming, nameById)`.
**Why it happens:** JavaScript silently accepts wrong argument counts — the call won't throw, but `node` will be `undefined` inside the function, causing `node.exposes` to throw.
**How to avoid:** Update the call site in `showDetailPanel()` and the function signature in the same edit. Confirm (as ARCHITECTURE.md documents) that `renderLibraryConnections` has only one call site in `showDetailPanel()` — confirmed at line 46 of the current source.
**Warning signs:** `Cannot read properties of undefined (reading 'exposes')` error on library node click.

### Pitfall 5: "No connections" Section Still Shows for Infra/Library Nodes with Exposes
**What goes wrong:** The current `showDetailPanel()` code at lines 51–55 appends "No connections" when `outgoing.length === 0 && incoming.length === 0`. An infra node that manages resources but has no connection edges would show "No connections" even after the "Manages" section is rendered.
**Why it happens:** The empty-connections check was written for service nodes. Library/infra nodes have a separate `exposes` array that is not checked by this guard.
**How to avoid:** Update the "No connections" guard to also check `(node.exposes || []).length === 0` for non-service node types, or move the guard inside each renderer.
**Warning signs:** Infra panel shows "Manages (3)" section followed by "No connections" label beneath it.

---

## Code Examples

Verified patterns from direct source inspection:

### Current showDetailPanel() routing (replace the isLib block)
```javascript
// Source: worker/ui/modules/detail-panel.js lines 43-49 (current — to be replaced)
const isLib = nodeType === "library" || nodeType === "sdk";
if (isLib) {
  html += renderLibraryConnections(outgoing, incoming, nameById);
} else {
  html += renderServiceConnections(outgoing, incoming, nameById);
}
```
Replace with:
```javascript
if (nodeType === 'infra') {
  html += renderInfraConnections(node, outgoing, nameById);
} else if (nodeType === 'library' || nodeType === 'sdk') {
  html += renderLibraryConnections(node, outgoing, incoming, nameById);
} else {
  html += renderServiceConnections(outgoing, incoming, nameById);
}
```

### renderLibraryConnections() with Exports section
```javascript
// Source: ARCHITECTURE.md design + detail-panel.js existing structure (HIGH)
function renderLibraryConnections(node, outgoing, incoming, nameById) {
  let html = '';

  // Exports section — from node.exposes (kind=export)
  const exposeItems = (node.exposes || []).filter(e => e.kind === 'export');
  if (exposeItems.length > 0) {
    const fns    = exposeItems.filter(e => e.path.includes('('));
    const types  = exposeItems.filter(e => !e.path.includes('('));
    html += `<div class="detail-section">
      <div class="detail-label">Exports (${exposeItems.length})</div>`;
    if (fns.length > 0) {
      html += `<div class="detail-label" style="font-size:0.75em;margin-top:4px">Functions (${fns.length})</div>`;
      for (const ex of fns) {
        html += `<div class="connection-item">
          <div class="conn-path">${escapeHtml(ex.path)}</div>
        </div>`;
      }
    }
    if (types.length > 0) {
      html += `<div class="detail-label" style="font-size:0.75em;margin-top:4px">Types (${types.length})</div>`;
      for (const ex of types) {
        html += `<div class="connection-item">
          <div class="conn-path">${escapeHtml(ex.path)}</div>
        </div>`;
      }
    }
    html += `</div>`;
  }

  // Used by — incoming edges deduplicated by service name (keep existing Set logic)
  if (incoming.length > 0) {
    const users = new Set();
    html += `<div class="detail-section">
      <div class="detail-label">Used by</div>`;
    for (const e of incoming) {
      const source = nameById[e.source_service_id] || '?';
      if (!users.has(source)) {
        users.add(source);
        html += `<div class="connection-item">
          <div><span class="conn-target">${escapeHtml(source)}</span></div>
          ${e.source_file ? `<div class="conn-file">${escapeHtml(e.source_file)}</div>` : ''}
        </div>`;
      }
    }
    html += `</div>`;
  }

  return html;
}
```

### renderInfraConnections() — new function
```javascript
// Source: ARCHITECTURE.md design spec (HIGH)
function renderInfraConnections(node, outgoing, nameById) {
  let html = '';

  // Manages section — from node.exposes (kind=resource), grouped by prefix
  const resources = (node.exposes || []).filter(e => e.kind === 'resource');
  if (resources.length > 0) {
    const byPrefix = {};
    for (const r of resources) {
      const prefix = r.path.split('/')[0];
      if (!byPrefix[prefix]) byPrefix[prefix] = [];
      byPrefix[prefix].push(r);
    }
    html += `<div class="detail-section">
      <div class="detail-label">Manages (${resources.length})</div>`;
    for (const [prefix, items] of Object.entries(byPrefix)) {
      html += `<div class="detail-label" style="font-size:0.75em;margin-top:4px">${escapeHtml(prefix)} (${items.length})</div>`;
      for (const r of items) {
        html += `<div class="connection-item">
          <div class="conn-path">${escapeHtml(r.path)}</div>
        </div>`;
      }
    }
    html += `</div>`;
  }

  // Wires section — outgoing connection edges to services
  if (outgoing.length > 0) {
    html += `<div class="detail-section">
      <div class="detail-label">Wires (${outgoing.length})</div>`;
    for (const e of outgoing) {
      const target = nameById[e.target_service_id] || '?';
      html += `<div class="connection-item">
        <div><span class="conn-method">${escapeHtml(e.method || e.protocol || '')}</span>
             <span class="conn-path">${escapeHtml(e.path || '')}</span></div>
        <div class="conn-direction">→ <span class="conn-target">${escapeHtml(target)}</span></div>
        ${e.source_file ? `<div class="conn-file">${escapeHtml(e.source_file)}</div>` : ''}
      </div>`;
    }
    html += `</div>`;
  }

  return html;
}
```

### Source inspection test pattern (for detail-panel.test.js)
```javascript
// Source: worker/ui/modules/interactions.test.js (existing project pattern, HIGH)
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'detail-panel.js'), 'utf8');

check(src.includes("renderInfraConnections"), "renderInfraConnections defined");
check(src.includes("nodeType === 'infra'") || src.includes('nodeType === "infra"'),
      "infra routing branch present");
check(src.includes("kind === 'export'") || src.includes('kind === "export"'),
      "exports filtered by kind");
check(src.includes("kind === 'resource'") || src.includes('kind === "resource"'),
      "resources filtered by kind");
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `isLib` boolean for two-branch routing | Three-way `nodeType` string dispatch | Phase 32 | Enables infra panel routing |
| `renderLibraryConnections(outgoing, incoming, nameById)` — edges only | `renderLibraryConnections(node, outgoing, incoming, nameById)` — node.exposes + edges | Phase 32 | Library panel shows actual export surface, not just connection edges |
| No infra panel (falls through to service renderer) | `renderInfraConnections(node, outgoing, nameById)` | Phase 32 | Infra nodes show managed resources and wired services |
| `NODE_TYPE_COLORS` has no infra entry | Add `infra: '#68d391'` | Phase 32 | Infra nodes color correctly in panel type display |

**Deprecated/outdated:**
- `isLib` boolean pattern in `showDetailPanel()`: replaced by three-way nodeType dispatch

---

## Open Questions

1. **"No connections" guard for infra/library nodes**
   - What we know: Current guard at lines 51–55 checks `outgoing.length === 0 && incoming.length === 0` and appends "No connections". An infra node with `exposes` but no edges would show "No connections" after the "Manages" section.
   - What's unclear: Whether a real infra repo would ever have `exposes` but zero connection edges (it could happen if the graph has no services yet wired to it).
   - Recommendation: Update the guard to check `(node.exposes || []).length > 0` in addition to the edge length check, or suppress the guard for non-service nodes.

2. **escapeHtml() helper location**
   - What we know: No `escapeHtml()` function exists in the current `detail-panel.js` source. The existing renders do not escape `e.method`, `e.path`, or `source_file` values. Library/infra exposes paths are higher-risk (function signatures may contain `<`, `>` characters).
   - What's unclear: Whether to add the helper inside `detail-panel.js` or as a utility in `utils.js`.
   - Recommendation: Define it as a module-private function at the top of `detail-panel.js` to avoid changing the `utils.js` export surface. Apply it to all new `${}` insertions in Phase 32.

---

## Validation Architecture

`workflow.nyquist_validation` is `true` in `.planning/config.json` — this section is required.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in `--test` runner (Node 20+) |
| Config file | none — invoked directly via `node --test <file>` |
| Quick run command | `node --test worker/ui/modules/detail-panel.test.js` |
| Full suite command | `node --test worker/ui/modules/detail-panel.test.js && node --test worker/ui/modules/utils.test.js` |

The project uses source-inspection tests with `readFileSync` + `src.includes()` checks. This is the established pattern from `interactions.test.js` and requires no DOM environment.

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PANEL-01 | `getNodeType()` returns `'infra'` for nodes with `type: 'infra'`; does not return `'service'` | unit (source inspection) | `node --test worker/ui/modules/utils.test.js` | ❌ Wave 0 |
| PANEL-01 | `getNodeColor()` returns `NODE_TYPE_COLORS.infra` for infra nodes | unit (source inspection) | `node --test worker/ui/modules/utils.test.js` | ❌ Wave 0 |
| PANEL-02 | `showDetailPanel()` has `nodeType === 'infra'` routing branch | unit (source inspection) | `node --test worker/ui/modules/detail-panel.test.js` | ❌ Wave 0 |
| PANEL-03 | `renderLibraryConnections` filters `kind === 'export'` and groups by `(` presence | unit (source inspection) | `node --test worker/ui/modules/detail-panel.test.js` | ❌ Wave 0 |
| PANEL-04 | `renderInfraConnections` defined; filters `kind === 'resource'`; groups by prefix via `split('/')` | unit (source inspection) | `node --test worker/ui/modules/detail-panel.test.js` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `node --test worker/ui/modules/detail-panel.test.js`
- **Per wave merge:** `node --test worker/ui/modules/detail-panel.test.js && node --test worker/ui/modules/utils.test.js`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `worker/ui/modules/detail-panel.test.js` — covers PANEL-02, PANEL-03, PANEL-04 via source inspection
- [ ] `worker/ui/modules/utils.test.js` — covers PANEL-01 via source inspection (getNodeType + getNodeColor infra guard)

*(No framework install needed — Node 20 built-in test runner already used in the project.)*

---

## Sources

### Primary (HIGH confidence)
- `worker/ui/modules/detail-panel.js` — complete source read; confirmed `isLib` boolean routing (lines 43–49), `renderLibraryConnections` signature (line 61), `renderServiceConnections` (lines 98–138)
- `worker/ui/modules/utils.js` — complete source read; confirmed `getNodeType()` has no infra guard (lines 39–46), `getNodeColor()` has no infra guard (lines 48–56)
- `worker/ui/modules/state.js` — complete source read; confirmed `NODE_TYPE_COLORS` missing `infra` entry (lines 62–67)
- `worker/ui/modules/interactions.test.js` — complete source read; confirmed source-inspection test pattern used across project
- `.planning/research/ARCHITECTURE.md` — direct source inspection findings for all v2.3 components; code examples for all Phase 32 changes
- `.planning/research/FEATURES.md` — feature landscape, export classification approach, prefix grouping approach
- `.planning/REQUIREMENTS.md` — requirement definitions for PANEL-01 through PANEL-04
- `.planning/STATE.md` — decisions including ordering constraint (utils.js guard before detail-panel.js changes)

### Secondary (MEDIUM confidence)
- None — all relevant findings backed by direct source inspection.

### Tertiary (LOW confidence)
- None.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — UI uses vanilla ES modules with no framework; confirmed by source inspection of all module files
- Architecture: HIGH — all affected files read directly; call sites confirmed, argument counts verified
- Pitfalls: HIGH — XSS concern explicitly documented in STATE.md; argument-count pitfall confirmed by reading call site at line 46; guard ordering confirmed by reading `getNodeType()` heuristic chain
- Test patterns: HIGH — `interactions.test.js` read in full; source-inspection pattern confirmed working against Node 20 `--test` runner

**Research date:** 2026-03-17
**Valid until:** 2026-04-17 (stable UI; only changes if Phase 31 deviates from the `node.exposes` shape described in ARCHITECTURE.md)
