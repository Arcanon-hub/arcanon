/**
 * Mouse interactions — click, drag, pan, zoom, hover tooltip.
 */

import { state, NODE_RADIUS } from "./state.js";
import { hitTest, toWorld, fetchImpact, getNodeType, getConnectionCount, edgeHitTest } from "./utils.js";
import { render } from "./renderer.js";
import { showDetailPanel, hideDetailPanel, showBundlePanel } from "./detail-panel.js";
import { setupFilterPanel } from "./filter-panel.js";

// Module-scoped refs set by setupInteractions — needed so named handlers
// can access canvas and tooltip, and so removeEventListener can match refs.
let _canvas = null;
let _tooltip = null;
let _rafId = null;

function scheduleRender() {
  if (_rafId) return;
  _rafId = requestAnimationFrame(() => {
    _rafId = null;
    render();
  });
}

// ── Named event handlers (module scope) ───────────────────────────────────
// Must be declared at module scope so the same function reference is used in
// both addEventListener and removeEventListener.

function onMouseMove(e) {
  const px = e.offsetX;
  const py = e.offsetY;

  if (state.isDragging && state.dragNodeId !== null) {
    const { x: wx, y: wy } = toWorld(px, py);
    state.positions[state.dragNodeId] = { x: wx, y: wy };
    state.dragStarted = true;
    scheduleRender();
    return;
  }

  if (state.isPanning) {
    state.transform.x = state.panStartTransformX + (px - state.panStartX);
    state.transform.y = state.panStartTransformY + (py - state.panStartY);
    state.dragStarted = true;
    scheduleRender();
    return;
  }

  const node = hitTest(px, py);
  if (node) {
    _canvas.style.cursor = "pointer";
    _tooltip.style.display = "block";
    _tooltip.style.left = px + 12 + "px";
    _tooltip.style.top = py - 8 + "px";
    const tt = getNodeType(node);
    const count = getConnectionCount(node.id);
    _tooltip.textContent = `${node.name} [${tt}]${node.language ? ` (${node.language})` : ''} \u2022 ${count} connection${count !== 1 ? 's' : ''}`;
  } else {
    _canvas.style.cursor = state.isDragging ? "grabbing" : "grab";
    _tooltip.style.display = "none";
  }
}

function onMouseDown(e) {
  state.dragStarted = false;
  const node = hitTest(e.offsetX, e.offsetY);
  if (node) {
    state.isDragging = true;
    state.dragNodeId = node.id;
  } else {
    state.isPanning = true;
    state.panStartX = e.offsetX;
    state.panStartY = e.offsetY;
    state.panStartTransformX = state.transform.x;
    state.panStartTransformY = state.transform.y;
  }
}

function onMouseUp(e) {
  if (state.isDragging && state.dragNodeId !== null && state.dragStarted) {
    const { x: wx, y: wy } = toWorld(e.offsetX, e.offsetY);
    state.positions[state.dragNodeId] = { x: wx, y: wy };
  }
  state.isDragging = false;
  state.dragNodeId = null;
  state.isPanning = false;
}

function onClick(e) {
  if (state.dragStarted) {
    state.dragStarted = false;
    return;
  }

  const node = hitTest(e.offsetX, e.offsetY);

  if (node) {
    if (e.shiftKey) {
      if (state.blastNodeId === node.id) {
        state.blastNodeId = null;
        state.blastSet = new Set();
      } else {
        state.blastNodeId = node.id;
        state.selectedNodeId = null;
        fetchImpact(node.name, node.id).then((ids) => {
          state.blastSet = ids;
          render();
        });
      }
    } else {
      if (state.selectedNodeId === node.id) {
        state.selectedNodeId = null;
        hideDetailPanel();
      } else {
        state.selectedNodeId = node.id;
        state.blastNodeId = null;
        state.blastSet = new Set();
        showDetailPanel(node);
      }
    }
  } else {
    const bundle = edgeHitTest(e.offsetX, e.offsetY);
    if (bundle) {
      // Bundle click — show bundle detail, deselect any node
      state.selectedNodeId = null;
      state.blastNodeId = null;
      state.blastSet = new Set();
      showBundlePanel(bundle);
    } else {
      state.selectedNodeId = null;
      state.blastNodeId = null;
      state.blastSet = new Set();
      hideDetailPanel();
    }
  }

  render();
}

function onWheel(e) {
  e.preventDefault();

  if (e.ctrlKey) {
    // Pinch-to-zoom (trackpad) or Ctrl+scroll (mouse) — ZOOM
    // D3-style continuous delta: normalize across deltaMode, apply sensitivity factor
    const SENSITIVITY = 0.004; // higher = faster zoom; D3 default is 0.002
    const rawDelta = -e.deltaY * (e.deltaMode === 1 ? 0.05 : e.deltaMode ? 1 : SENSITIVITY);
    const factor = Math.pow(2, rawDelta); // exponential feels natural vs linear
    const newScale = Math.min(5, Math.max(0.15, state.transform.scale * factor));
    const ratio = newScale / state.transform.scale;
    state.transform.x = e.offsetX - ratio * (e.offsetX - state.transform.x);
    state.transform.y = e.offsetY - ratio * (e.offsetY - state.transform.y);
    state.transform.scale = newScale;
  } else {
    // Two-finger scroll (trackpad) or plain mouse wheel — PAN
    state.transform.x -= e.deltaX;
    state.transform.y -= e.deltaY;
  }

  scheduleRender();
}

function onMouseLeave() {
  _tooltip.style.display = "none";
  if (state.isDragging) {
    state.isDragging = false;
    state.dragNodeId = null;
  }
  state.isPanning = false;
}

// ── Public API ─────────────────────────────────────────────────────────────

export function setupInteractions(canvas) {
  _canvas = canvas;
  _tooltip = document.getElementById("tooltip");

  canvas.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("mousedown", onMouseDown);
  canvas.addEventListener("mouseup", onMouseUp);
  canvas.addEventListener("click", onClick);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("mouseleave", onMouseLeave);
}

export function teardownInteractions(canvas) {
  canvas.removeEventListener("mousemove", onMouseMove);
  canvas.removeEventListener("mousedown", onMouseDown);
  canvas.removeEventListener("mouseup", onMouseUp);
  canvas.removeEventListener("click", onClick);
  canvas.removeEventListener("wheel", onWheel);
  canvas.removeEventListener("mouseleave", onMouseLeave);
}

export function setupControls() {
  document.getElementById("search").addEventListener("input", (e) => {
    state.searchFilter = e.target.value.toLowerCase();
    render();
  });
  setupFilterPanel();
}
