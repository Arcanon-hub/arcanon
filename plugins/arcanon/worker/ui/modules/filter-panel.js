/**
 * filter-panel.js — Wires all filter controls to state and render().
 *
 * Exports:
 *   setupFilterPanel()        — attaches event listeners to all filter controls
 *   populateFilterDropdowns() — reads state.graphData to fill boundary/language selects
 */

import { state } from "./state.js";
import { render } from "./renderer.js";

// Guard: only wire listeners once across multiple loadProject calls
let _filterPanelWired = false;

/**
 * Wire all filter controls in the collapsible #filter-panel.
 * Called from setupControls() in interactions.js after DOM is ready.
 * Idempotent — only wires listeners on first call.
 */
export function setupFilterPanel() {
  if (_filterPanelWired) return;

  const filtersBtn = document.getElementById("filters-btn");
  const filterPanel = document.getElementById("filter-panel");
  if (!filtersBtn || !filterPanel) return;

  // 1. Filters button toggle
  filtersBtn.addEventListener("click", () => {
    state.filterPanelOpen = !state.filterPanelOpen;
    filterPanel.style.display = state.filterPanelOpen ? "flex" : "none";
    filtersBtn.classList.toggle("active", state.filterPanelOpen);
  });

  // 2. Protocol checkboxes (moved from setupControls in interactions.js)
  document.querySelectorAll("[data-protocol]").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) state.activeProtocols.add(cb.dataset.protocol);
      else state.activeProtocols.delete(cb.dataset.protocol);
      render();
    });
  });

  // 3. Layer checkboxes
  document.querySelectorAll("[data-layer]").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) state.activeLayers.add(cb.dataset.layer);
      else state.activeLayers.delete(cb.dataset.layer);
      render();
    });
  });

  // 4. Mismatches only
  const mismatchCb = document.getElementById("filter-mismatches-only");
  if (mismatchCb) {
    mismatchCb.addEventListener("change", (e) => {
      state.mismatchesOnly = e.target.checked;
      render();
    });
  }

  // 5. Hide isolated nodes
  const isolatedCb = document.getElementById("filter-hide-isolated");
  if (isolatedCb) {
    isolatedCb.addEventListener("change", (e) => {
      state.hideIsolated = e.target.checked;
      render();
    });
  }

  // 6. Boundary dropdown
  const boundarySelect = document.getElementById("filter-boundary");
  if (boundarySelect) {
    boundarySelect.addEventListener("change", (e) => {
      state.boundaryFilter = e.target.value || null;
      render();
    });
  }

  // 7. Language dropdown
  const langSelect = document.getElementById("filter-language");
  if (langSelect) {
    langSelect.addEventListener("change", (e) => {
      state.languageFilter = e.target.value || null;
      render();
    });
  }

  _filterPanelWired = true;
}

/**
 * Populate the boundary and language <select> elements from live graph data.
 * Called after state.graphData.nodes is populated in loadProject().
 */
export function populateFilterDropdowns() {
  const langSelect = document.getElementById("filter-language");
  const boundarySelect = document.getElementById("filter-boundary");
  if (!langSelect || !boundarySelect) return;

  // Collect unique, non-empty language values from nodes
  const languages = [...new Set(
    state.graphData.nodes
      .map((n) => n.language)
      .filter(Boolean),
  )].sort();

  // Collect unique boundary values from nodes (node.boundary if present)
  const boundaries = [...new Set(
    state.graphData.nodes
      .map((n) => n.boundary)
      .filter(Boolean),
  )].sort();

  // Preserve current selection
  const prevLang = langSelect.value;
  langSelect.innerHTML = '<option value="">All</option>';
  languages.forEach((lang) => {
    const opt = document.createElement("option");
    opt.value = lang;
    opt.textContent = lang;
    langSelect.appendChild(opt);
  });
  if (prevLang) langSelect.value = prevLang;

  const prevBoundary = boundarySelect.value;
  boundarySelect.innerHTML = '<option value="">All</option>';
  boundaries.forEach((b) => {
    const opt = document.createElement("option");
    opt.value = b;
    opt.textContent = b;
    boundarySelect.appendChild(opt);
  });
  if (prevBoundary) boundarySelect.value = prevBoundary;
}
