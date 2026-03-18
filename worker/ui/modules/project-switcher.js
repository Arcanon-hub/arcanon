/**
 * project-switcher.js — persistent project dropdown in toolbar.
 *
 * Populates #project-select from GET /projects.
 * On change: tears down current graph, loads new project via loadProject().
 */

import { state } from './state.js';
import { teardownInteractions } from './interactions.js';
import { loadProject } from '../graph.js';

/**
 * Init the project switcher after first project load.
 * @param {string} currentHash - hash of the currently loaded project
 */
export async function initProjectSwitcher(currentHash) {
  const select = document.getElementById('project-select');
  if (!select) return;

  let projects;
  try {
    const resp = await fetch('/projects');
    if (!resp.ok) return;
    projects = await resp.json();
  } catch {
    return;
  }

  // Sort by serviceCount desc (most active projects first)
  projects.sort((a, b) => b.serviceCount - a.serviceCount);

  // Populate options — show folder name, use hash as value
  select.innerHTML = '';
  for (const p of projects) {
    const opt = document.createElement('option');
    opt.value = p.hash;
    // Display: last path segment of projectRoot, fallback to first 8 chars of hash
    opt.textContent = p.projectRoot
      ? p.projectRoot.split('/').filter(Boolean).pop()
      : p.hash.slice(0, 8);
    if (p.hash === currentHash) opt.selected = true;
    select.appendChild(opt);
  }

  // Make visible (was display:none)
  select.style.display = '';

  // Wire change handler
  select.addEventListener('change', onProjectChange);
}

async function onProjectChange(e) {
  const newHash = e.target.value;
  if (newHash === state.currentProject) return;

  const canvas = document.getElementById('graph-canvas');

  // 1. Remove all canvas event listeners
  if (canvas) teardownInteractions(canvas);

  // 2. Reset graph state (keep transform — user may want same zoom level)
  state.graphData = { nodes: [], edges: [], mismatches: [] };
  state.positions = {};
  state.boundaryBoxes = [];
  state.selectedNodeId = null;
  state.blastNodeId = null;
  state.blastSet = new Set();
  state.blastCache = {};

  // 3. Update URL without page reload
  const url = new URL(window.location);
  url.searchParams.set('hash', newHash);
  url.searchParams.delete('project');
  window.history.replaceState({}, '', url);

  // 4. Load new project (re-attaches interactions internally via setupInteractions)
  await loadProject(newHash);
}
