/**
 * graph.js — Entry point for Ligamen service dependency graph UI.
 *
 * Orchestrates: project selection → data loading → force simulation → rendering.
 * All logic is in modules/ — this file is just the init flow.
 */

import { state } from "./modules/state.js";
import { render } from "./modules/renderer.js";
import { computeLayout } from "./modules/layout.js";
import { setupInteractions, teardownInteractions, setupControls } from "./modules/interactions.js";
import { hideDetailPanel } from "./modules/detail-panel.js";
import { showProjectPicker } from "./modules/project-picker.js";
import { initLogTerminal } from "./modules/log-terminal.js";
// Stub — will be implemented in Plan 02
import { initProjectSwitcher } from "./modules/project-switcher.js";
import { populateFilterDropdowns } from "./modules/filter-panel.js";
import { initKeyboard } from "./modules/keyboard.js";
import { initExport } from "./modules/export.js";

// Guard: detail-close listener is wired once across multiple loadProject calls
let _detailCloseWired = false;

/**
 * Load (or reload) the graph for a given project hash.
 * Fetches /graph, maps API response to UI shape, starts force simulation,
 * and wires interaction handlers.
 *
 * @param {string} hash - The project hash to load.
 * @param {HTMLCanvasElement} [canvas] - The graph canvas element (falls back to DOM).
 */
export async function loadProject(hash, canvas) {
  // Allow canvas to be omitted (e.g. called from project-switcher) — fall back to DOM
  if (!canvas) canvas = document.getElementById('graph-canvas');
  const projectParam = `?hash=${encodeURIComponent(hash)}`;
  state.currentProject = hash;

  // Load graph data
  let resp;
  try {
    resp = await fetch(`/graph${projectParam}`);
  } catch {
    document.getElementById("node-info").textContent = "Cannot reach server.";
    return;
  }

  if (!resp.ok) {
    document.getElementById("node-info").textContent =
      "No map data yet. Run /ligamen:map first.";
    return;
  }

  const raw = await resp.json();
  // Store latest scan version for "what changed" overlay (Phase 56)
  state.latestScanVersionId = raw.latest_scan_version_id ?? null;

  // Map API response to UI shape
  const serviceNameToId = {};
  const mismatchSet = new Set(
    (raw.mismatches || []).map((m) => m.connection_id),
  );

  // Build service-name → boundary-name reverse map from boundaries config
  const nameToBoundary = {};
  for (const b of raw.boundaries || []) {
    for (const svcName of b.services || []) {
      nameToBoundary[svcName] = b.name;
    }
  }

  state.graphData.nodes = (raw.services || []).map((s) => {
    serviceNameToId[s.name] = s.id;
    return {
      id: s.id,
      name: s.name,
      language: s.language,
      type: s.type || "service",
      repo_name: s.repo_name,
      exposes: s.exposes || [],
      boundary: nameToBoundary[s.name] || null,
      scan_version_id: s.scan_version_id ?? null,
      owner: s.owner ?? null,
      auth_mechanism: s.auth_mechanism ?? null,
      db_backend: s.db_backend ?? null,
    };
  });

  state.graphData.edges = (raw.connections || []).map((c) => ({
    id: c.id,
    source_service_id: c.source_service_id ?? serviceNameToId[c.source],
    target_service_id: c.target_service_id ?? serviceNameToId[c.target],
    protocol: c.protocol || "internal",
    method: c.method,
    path: c.path,
    source_file: c.source_file,
    target_file: c.target_file,
    mismatch: c.id ? mismatchSet.has(c.id) : false,
    scan_version_id: c.scan_version_id ?? null,
    confidence: c.confidence ?? null,
    evidence: c.evidence ?? null,
  }));

  state.graphData.mismatches = raw.mismatches || [];
  populateFilterDropdowns();

  // Store raw actors for detail panel
  state.graphData.actors = raw.actors || [];

  // SREL-02: Filter actors whose name matches a known service — defense in depth
  // for stale actor data. The serviceNameToId map is already populated above.
  state.graphData.actors = state.graphData.actors.filter(
    (actor) => !(actor.name in serviceNameToId)
  );

  state.graphData.schemas_by_connection = raw.schemas_by_connection || {};

  // Create synthetic nodes for actors with IDs that won't collide with service IDs.
  // Use negative IDs: actor with DB id=1 becomes node id=-1, id=2 becomes -2, etc.
  for (const actor of state.graphData.actors) {
    const syntheticId = -actor.id;  // negative to avoid collision with service IDs
    state.graphData.nodes.push({
      id: syntheticId,
      name: actor.name,
      type: 'actor',
      _isActor: true,
      _actorData: actor,  // preserve full actor data for detail panel
      language: null,
      repo_name: null,
      exposes: [],
    });
  }

  // Create synthetic edges from source services to actor nodes
  for (const actor of state.graphData.actors) {
    const syntheticId = -actor.id;
    for (const cs of actor.connected_services || []) {
      state.graphData.edges.push({
        source_service_id: cs.service_id,
        target_service_id: syntheticId,
        protocol: cs.protocol || 'rest',
        method: null,
        path: cs.path,
        _isActorEdge: true,
      });
    }
  }

  document.getElementById("node-info").textContent =
    `${state.graphData.nodes.length} services, ${state.graphData.edges.length} connections`;

  // Compute deterministic grid positions (replaces random init + force Worker)
  const cssBoundsW = Math.round(canvas.width / (window.devicePixelRatio || 1));
  const cssBoundsH = Math.round(canvas.height / (window.devicePixelRatio || 1));
  const { positions, boundaryBoxes, layerBoxes } = computeLayout(
    state.graphData.nodes,
    raw.boundaries || [],
    cssBoundsW,
    cssBoundsH,
  );
  Object.assign(state.positions, positions);
  state.boundaryBoxes = boundaryBoxes;
  state.layerBoxes = layerBoxes;
  render();

  teardownInteractions(canvas);
  setupInteractions(canvas);
  setupControls();
  initKeyboard();
  initExport();

  // Wire changes toggle — replace node to clear old listeners across project reloads
  const changesBtn = document.getElementById("changes-btn");
  if (changesBtn) {
    const newChangesBtn = changesBtn.cloneNode(true);
    changesBtn.parentNode.replaceChild(newChangesBtn, changesBtn);
    newChangesBtn.classList.toggle("active", state.showChanges);
    newChangesBtn.addEventListener("click", () => {
      state.showChanges = !state.showChanges;
      newChangesBtn.classList.toggle("active", state.showChanges);
      render();
    });
  }

  // fitToScreen — self-contained, always wired (works after project switch too)
  const fitBtn = document.getElementById("fit-btn");
  if (fitBtn) {
    const container = document.getElementById("canvas-container");
    // Remove old listener (if any from previous loadProject call) by replacing node
    const newBtn = fitBtn.cloneNode(true);
    fitBtn.parentNode.replaceChild(newBtn, fitBtn);
    newBtn.addEventListener("click", () => {
      const positions = Object.values(state.positions);
      if (positions.length === 0) return;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const { x, y } of positions) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      const PADDING = 60;
      const cssW = container.clientWidth;
      const cssH = container.clientHeight;
      const graphW = maxX - minX || 1;
      const graphH = maxY - minY || 1;
      const scaleX = (cssW - PADDING * 2) / graphW;
      const scaleY = (cssH - PADDING * 2) / graphH;
      const scale = Math.max(0.15, Math.min(Math.min(scaleX, scaleY), 5));
      state.transform.scale = scale;
      state.transform.x = cssW / 2 - (minX + graphW / 2) * scale;
      state.transform.y = cssH / 2 - (minY + graphH / 2) * scale;
      render();
    });
  }

  // Wire detail-close only once — addEventListener is idempotent for named
  // functions, but we use a flag to be explicit and avoid redundant calls.
  if (!_detailCloseWired) {
    document.getElementById("detail-close").addEventListener("click", () => {
      hideDetailPanel();
      state.selectedNodeId = null;
      render();
    });
    _detailCloseWired = true;
  }
}

async function init() {
  const canvas = document.getElementById("graph-canvas");
  const container = document.getElementById("canvas-container");

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const cssW = container.clientWidth;
    const cssH = container.clientHeight;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    render();
  }
  window.addEventListener("resize", resize);
  function watchDPR() {
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mq.addEventListener('change', () => { resize(); watchDPR(); }, { once: true });
  }
  watchDPR();
  resize();

  // fitToScreen is now self-contained inside loadProject() — always wired on every load.

  // Resolve project from URL or show picker
  const urlParams = new URLSearchParams(window.location.search);
  let project = urlParams.get("project");
  let hash = urlParams.get("hash");

  if (!project && !hash) {
    const picked = await showProjectPicker();
    if (!picked) return;

    if (picked.startsWith("__hash__")) {
      hash = picked.slice(8);
    } else {
      project = picked;
    }
  }

  if (project && !urlParams.get("project")) {
    const newUrl = new URL(window.location);
    newUrl.searchParams.set("project", project);
    window.history.replaceState({}, "", newUrl);
  }

  // Resolve to a hash — if a ?project= name was given, use project as hash
  // (the server resolves either form). loadProject() always sends ?hash=.
  const resolvedHash = hash || project;

  await loadProject(resolvedHash, canvas);
  initLogTerminal();
  initProjectSwitcher(resolvedHash);
}

init().catch((err) => {
  document.getElementById("node-info").textContent = `Error: ${err.message}`;
  console.error(err);
});
