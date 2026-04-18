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

/**
 * Returns all node IDs within `depth` hops of nodeId, including nodeId itself.
 * Uses BFS over bidirectional edges. Safe on cyclic graphs.
 *
 * @param {number} nodeId - The anchor node ID.
 * @param {number} depth  - Number of hops to expand (1, 2, or 3).
 * @returns {Set<number>} Set of node IDs in the N-hop neighborhood.
 */
export function getNeighborIdsNHop(nodeId, depth) {
  const visited = new Set([nodeId]);
  let frontier = new Set([nodeId]);
  for (let hop = 0; hop < depth; hop++) {
    const next = new Set();
    for (const e of state.graphData.edges) {
      if (frontier.has(e.source_service_id) && !visited.has(e.target_service_id)) {
        next.add(e.target_service_id);
      }
      if (frontier.has(e.target_service_id) && !visited.has(e.source_service_id)) {
        next.add(e.source_service_id);
      }
    }
    for (const id of next) visited.add(id);
    frontier = next;
  }
  return visited;
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

/**
 * Groups an array of edges by source→target pair and returns bundle objects.
 * Bundles with count === 1 are still returned (single code path in renderer).
 *
 * @param {Array} edges - Filtered edge objects from graphData.edges
 * @returns {Array} Array of bundle objects with count, protocol, hasMismatch, edges
 */
export function computeEdgeBundles(edges) {
  // Protocol priority: lower index = higher priority (used as tiebreaker)
  const SEVERITY = ["rest", "grpc", "events", "internal", "sdk", "import"];

  const groups = new Map();
  for (const edge of edges) {
    const key = `${edge.source_service_id}->${edge.target_service_id}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        source_service_id: edge.source_service_id,
        target_service_id: edge.target_service_id,
        edges: [],
      });
    }
    groups.get(key).edges.push(edge);
  }

  const bundles = [];
  for (const group of groups.values()) {
    const hasMismatch = group.edges.some((e) => e.mismatch === true);

    // Determine dominant protocol: most frequent; break ties by SEVERITY order
    const protocolCounts = new Map();
    for (const e of group.edges) {
      protocolCounts.set(e.protocol, (protocolCounts.get(e.protocol) || 0) + 1);
    }
    let dominantProtocol = null;
    let dominantCount = -1;
    let dominantPriority = Infinity;
    for (const [proto, cnt] of protocolCounts) {
      const priority = SEVERITY.indexOf(proto);
      const effectivePriority = priority === -1 ? Infinity : priority;
      if (
        cnt > dominantCount ||
        (cnt === dominantCount && effectivePriority < dominantPriority)
      ) {
        dominantCount = cnt;
        dominantPriority = effectivePriority;
        dominantProtocol = proto;
      }
    }

    bundles.push({
      key: group.key,
      source_service_id: group.source_service_id,
      target_service_id: group.target_service_id,
      count: group.edges.length,
      edges: group.edges,
      protocol: dominantProtocol,
      hasMismatch,
    });
  }
  return bundles;
}

export function edgeHitTest(px, py) {
  const { x: wx, y: wy } = toWorld(px, py);

  // Build filtered bundles (same filter logic as renderer.js)
  const filteredEdges = state.graphData.edges.filter(edge => {
    if (!state.activeProtocols.has(edge.protocol)) return false;
    if (state.mismatchesOnly && !edge.mismatch) return false;
    return true;
  });
  const bundles = computeEdgeBundles(filteredEdges);

  // Only hit-test bundles with count > 1 (single edges are not clickable)
  const multiBundles = bundles.filter(b => b.count > 1);

  const HIT_RADIUS = 10; // logical pixels — how close to the line counts as a hit

  for (const bundle of multiBundles) {
    const srcPos = state.positions[bundle.source_service_id];
    const tgtPos = state.positions[bundle.target_service_id];
    if (!srcPos || !tgtPos) continue;

    // Distance from point (wx, wy) to line segment (srcPos → tgtPos)
    const dx = tgtPos.x - srcPos.x;
    const dy = tgtPos.y - srcPos.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) continue;

    // Project point onto segment, clamp t to [0,1]
    const t = Math.max(0, Math.min(1, ((wx - srcPos.x) * dx + (wy - srcPos.y) * dy) / lenSq));
    const closestX = srcPos.x + t * dx;
    const closestY = srcPos.y + t * dy;
    const dist = Math.hypot(wx - closestX, wy - closestY);

    if (dist < HIT_RADIUS) return bundle;
  }
  return null;
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
