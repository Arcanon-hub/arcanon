/**
 * graph.js — Entry point for AllClear service dependency graph UI.
 *
 * Orchestrates: project selection → data loading → force simulation → rendering.
 * All logic is in modules/ — this file is just the init flow.
 */

import { state } from "./modules/state.js";
import { render } from "./modules/renderer.js";
import { computeLayout } from "./modules/layout.js";
import { setupInteractions, setupControls } from "./modules/interactions.js";
import { hideDetailPanel } from "./modules/detail-panel.js";
import { showProjectPicker } from "./modules/project-picker.js";
import { initLogTerminal } from "./modules/log-terminal.js";
// Stub — will be implemented in Plan 02
import { initProjectSwitcher } from "./modules/project-switcher.js";

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
      "No map data yet. Run /allclear:map first.";
    return;
  }

  const raw = await resp.json();

  // Map API response to UI shape
  const serviceNameToId = {};
  const mismatchSet = new Set(
    (raw.mismatches || []).map((m) => m.connection_id),
  );

  state.graphData.nodes = (raw.services || []).map((s) => {
    serviceNameToId[s.name] = s.id;
    return {
      id: s.id,
      name: s.name,
      language: s.language,
      type: s.type || "service",
      repo_name: s.repo_name,
      exposes: s.exposes || [],
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
  }));

  state.graphData.mismatches = raw.mismatches || [];

  document.getElementById("node-info").textContent =
    `${state.graphData.nodes.length} services, ${state.graphData.edges.length} connections`;

  // Compute deterministic grid positions (replaces random init + force Worker)
  const cssBoundsW = Math.round(canvas.width / (window.devicePixelRatio || 1));
  const cssBoundsH = Math.round(canvas.height / (window.devicePixelRatio || 1));
  const { positions, boundaryBoxes } = computeLayout(
    state.graphData.nodes,
    raw.boundaries || [],
    cssBoundsW,
    cssBoundsH,
  );
  Object.assign(state.positions, positions);
  state.boundaryBoxes = boundaryBoxes;
  render();

  setupInteractions(canvas);
  setupControls();

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
