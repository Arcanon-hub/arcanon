/**
 * Utility functions for the graph UI.
 */

import { state, NODE_RADIUS, NODE_TYPE_COLORS } from "./state.js";

export function truncate(str, max) {
  return str.length > max ? str.slice(0, max) + "…" : str;
}

export function toWorld(px, py) {
  return {
    x: (px - state.transform.x) / state.transform.scale,
    y: (py - state.transform.y) / state.transform.scale,
  };
}

export function hitTest(px, py) {
  const { x: wx, y: wy } = toWorld(px, py);
  for (const node of state.graphData.nodes) {
    const pos = state.positions[node.id];
    if (!pos) continue;
    if (Math.hypot(wx - pos.x, wy - pos.y) < NODE_RADIUS) {
      return node;
    }
  }
  return null;
}

export function getNeighborIds(nodeId) {
  const ids = new Set();
  for (const e of state.graphData.edges) {
    if (e.source_service_id === nodeId) ids.add(e.target_service_id);
    if (e.target_service_id === nodeId) ids.add(e.source_service_id);
  }
  return ids;
}

export function getConnectionCount(nodeId) {
  let count = 0;
  for (const e of state.graphData.edges) {
    if (e.source_service_id === nodeId || e.target_service_id === nodeId) count++;
  }
  return count;
}

export function getNodeType(node) {
  if (node._isActor) return 'actor';
  if (node.type === 'infra') return 'infra';
  if (node.type === "library" || node.type === "sdk") return node.type;
  if (node.name && /sdk|lib|client|shared|common/i.test(node.name))
    return "library";
  if (node.name && /ui|frontend|web|dashboard|app/i.test(node.name))
    return "frontend";
  return "service";
}

export function getNodeColor(node) {
  if (node._isActor) return NODE_TYPE_COLORS.actor;
  if (node.type === 'infra') return NODE_TYPE_COLORS.infra;
  if (node.type === "library" || node.type === "sdk")
    return NODE_TYPE_COLORS.library;
  if (node.name && /sdk|lib|client|shared|common/i.test(node.name))
    return NODE_TYPE_COLORS.library;
  if (node.name && /ui|frontend|web|dashboard|app/i.test(node.name))
    return NODE_TYPE_COLORS.frontend;
  return NODE_TYPE_COLORS.service;
}

export async function fetchImpact(nodeName, nodeId) {
  if (state.blastCache[nodeName] !== undefined) {
    return state.blastCache[nodeName];
  }
  try {
    const urlProject = new URLSearchParams(window.location.search).get(
      "project",
    );
    const pParam = urlProject
      ? `&project=${encodeURIComponent(urlProject)}`
      : "";
    const hashParam = new URLSearchParams(window.location.search).get("hash");
    const hParam =
      !urlProject && hashParam ? `&hash=${encodeURIComponent(hashParam)}` : "";
    const resp = await fetch(
      `/impact?change=${encodeURIComponent(nodeName)}${pParam}${hParam}`,
    );
    if (!resp.ok) {
      state.blastCache[nodeName] = new Set();
      return state.blastCache[nodeName];
    }
    const data = await resp.json();
    const affected = new Set((data.affected || []).map((a) => a.id));
    affected.add(nodeId);
    state.blastCache[nodeName] = affected;
    return affected;
  } catch {
    state.blastCache[nodeName] = new Set();
    return state.blastCache[nodeName];
  }
}
