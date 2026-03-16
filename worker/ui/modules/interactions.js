/**
 * Mouse interactions — click, drag, pan, zoom, hover tooltip.
 */

import { state, NODE_RADIUS } from "./state.js";
import { hitTest, toWorld, fetchImpact, getNodeType } from "./utils.js";
import { render } from "./renderer.js";
import { showDetailPanel, hideDetailPanel } from "./detail-panel.js";

export function setupInteractions(canvas) {
  const tooltip = document.getElementById("tooltip");

  // Mousemove — hover tooltip + drag + pan
  canvas.addEventListener("mousemove", (e) => {
    const px = e.offsetX;
    const py = e.offsetY;

    if (state.isDragging && state.dragNodeId !== null) {
      const { x: wx, y: wy } = toWorld(px, py);
      state.forceWorker.postMessage({
        type: "drag",
        nodeId: state.dragNodeId,
        x: wx,
        y: wy,
      });
      state.dragStarted = true;
      render();
      return;
    }

    if (state.isPanning) {
      state.transform.x = state.panStartTransformX + (px - state.panStartX);
      state.transform.y = state.panStartTransformY + (py - state.panStartY);
      state.dragStarted = true;
      render();
      return;
    }

    const node = hitTest(px, py);
    if (node) {
      canvas.style.cursor = "pointer";
      tooltip.style.display = "block";
      tooltip.style.left = px + 12 + "px";
      tooltip.style.top = py - 8 + "px";
      const tt = getNodeType(node);
      tooltip.textContent =
        node.name + ` [${tt}]` + (node.language ? ` (${node.language})` : "");
    } else {
      canvas.style.cursor = state.isDragging ? "grabbing" : "grab";
      tooltip.style.display = "none";
    }
  });

  // Mousedown — start drag or pan
  canvas.addEventListener("mousedown", (e) => {
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
  });

  // Mouseup — release drag or pan
  canvas.addEventListener("mouseup", (e) => {
    if (state.isDragging && state.dragNodeId !== null && state.dragStarted) {
      const { x: wx, y: wy } = toWorld(e.offsetX, e.offsetY);
      if (state.forceWorker) {
        state.forceWorker.postMessage({
          type: "drag",
          nodeId: state.dragNodeId,
          x: wx,
          y: wy,
        });
      }
    }
    state.isDragging = false;
    state.dragNodeId = null;
    state.isPanning = false;
  });

  // Click — select node or clear selection
  canvas.addEventListener("click", (e) => {
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
      state.selectedNodeId = null;
      state.blastNodeId = null;
      state.blastSet = new Set();
      hideDetailPanel();
    }

    render();
  });

  // trackpad pinch sends e.ctrlKey=true (browser convention, not a real Ctrl press)
  // trackpad two-finger scroll sends e.ctrlKey=false
  // plain mouse wheel: zoom via Ctrl+scroll, pan via plain scroll
  canvas.addEventListener(
    "wheel",
    (e) => {
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

      render();
    },
    { passive: false },
  );

  // Mouse leave
  canvas.addEventListener("mouseleave", () => {
    tooltip.style.display = "none";
    if (state.isDragging) {
      state.isDragging = false;
      state.dragNodeId = null;
    }
    state.isPanning = false;
  });
}

export function setupControls() {
  document.getElementById("search").addEventListener("input", (e) => {
    state.searchFilter = e.target.value.toLowerCase();
    render();
  });

  document.querySelectorAll("[data-protocol]").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) state.activeProtocols.add(cb.dataset.protocol);
      else state.activeProtocols.delete(cb.dataset.protocol);
      render();
    });
  });
}
