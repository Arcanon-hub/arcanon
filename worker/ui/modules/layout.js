/**
 * layout.js — Deterministic grid layout engine.
 *
 * Partitions nodes into three layers (service/frontend at top,
 * library/sdk in the middle, infra at the bottom) and positions
 * them with even horizontal spacing within each layer.
 *
 * The right-most 18% of the canvas is reserved for external actors
 * (Phase 35).  Use the exported ACTOR_COLUMN_RESERVE_RATIO constant
 * to place actors in the matching region.
 */

import { getNodeType } from "./utils.js";
import { NODE_RADIUS } from "./state.js";

export const ACTOR_COLUMN_RESERVE_RATIO = 0.18;

const PADDING = 40;
const BOX_PAD = 28;

/**
 * Compute deterministic grid positions for all nodes.
 *
 * @param {Array}  nodes      - Graph nodes with .id, .name, .type
 * @param {Array}  boundaries - [{name, label, services:[...names]}] from config
 * @param {number} canvasW    - CSS pixel width
 * @param {number} canvasH    - CSS pixel height
 * @returns {{ positions: Object, boundaryBoxes: Array }}
 */
export function computeLayout(nodes, boundaries, canvasW, canvasH) {
  if (!nodes || nodes.length === 0) {
    return { positions: {}, boundaryBoxes: [] };
  }

  // ── 1. Partition into layers ──────────────────────────────────────────
  const serviceNodes = [];
  const libraryNodes = [];
  const infraNodes   = [];

  for (const node of nodes) {
    const t = getNodeType(node);
    if (t === 'infra') {
      infraNodes.push(node);
    } else if (t === 'library' || t === 'sdk') {
      libraryNodes.push(node);
    } else {
      // service or frontend → service layer
      serviceNodes.push(node);
    }
  }

  // ── 2. Sort service layer: boundary members first, then un-boundaried ──
  //   Within each boundary: alphabetical by name.
  //   Un-boundaried services: alphabetical by name.
  const boundaryList = Array.isArray(boundaries) ? boundaries : [];
  const sortedServices = _sortServicesForBoundaries(serviceNodes, boundaryList);

  // Sort library and infra layers alphabetically for determinism
  libraryNodes.sort((a, b) => a.name.localeCompare(b.name));
  infraNodes.sort((a, b) => a.name.localeCompare(b.name));

  // ── 3. Assign vertical bands ──────────────────────────────────────────
  //   services 50%, libraries 25%, infra 25% of usable height
  const usableH = canvasH - PADDING * 2;
  const bands = {
    service: { y: PADDING,                           h: usableH * 0.50 },
    library: { y: PADDING + usableH * 0.50,          h: usableH * 0.25 },
    infra:   { y: PADDING + usableH * 0.75,          h: usableH * 0.25 },
  };

  // ── 4. Reserve right side for Phase-35 actor column ───────────────────
  const actorReserve = Math.round(canvasW * ACTOR_COLUMN_RESERVE_RATIO);
  const usableW = canvasW - PADDING * 2 - actorReserve;

  // ── 5. Position each layer ────────────────────────────────────────────
  const positions = {};
  const layers = [
    { name: 'service', nodes: sortedServices },
    { name: 'library', nodes: libraryNodes },
    { name: 'infra',   nodes: infraNodes },
  ];

  for (const { name, nodes: layerNodes } of layers) {
    const n = layerNodes.length;
    if (n === 0) continue;
    const { y: bandY, h: bandH } = bands[name];
    const cellW = usableW / n;
    layerNodes.forEach((node, i) => {
      positions[node.id] = {
        x: PADDING + cellW * i + cellW / 2,
        y: bandY + bandH / 2,
      };
    });
  }

  // ── 6. Compute boundary boxes ─────────────────────────────────────────
  const boundaryBoxes = [];
  for (const boundary of boundaryList) {
    const memberIds = nodes
      .filter(n => Array.isArray(boundary.services) && boundary.services.includes(n.name))
      .map(n => n.id);
    if (memberIds.length === 0) continue;

    const xs = memberIds.map(id => positions[id]?.x).filter(v => v != null);
    const ys = memberIds.map(id => positions[id]?.y).filter(v => v != null);
    if (xs.length === 0) continue;

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    // Enforce minimum height for single-row boundaries (Research Pitfall 4)
    const boxH = Math.max(NODE_RADIUS * 2 + BOX_PAD * 2, maxY - minY + BOX_PAD * 2);

    boundaryBoxes.push({
      label: boundary.label || boundary.name,
      x: minX - BOX_PAD,
      y: minY - BOX_PAD,
      w: maxX - minX + BOX_PAD * 2,
      h: boxH,
    });
  }

  return { positions, boundaryBoxes };
}

// ── Internal helpers ────────────────────────────────────────────────────────

/**
 * Sort service nodes so boundary members appear contiguously before
 * un-boundaried services.  Within each boundary services are alphabetical;
 * boundaries are processed in declaration order; un-boundaried services are
 * alphabetical at the end.
 */
function _sortServicesForBoundaries(serviceNodes, boundaries) {
  if (boundaries.length === 0) {
    // No boundaries — simple alphabetical sort for determinism
    return [...serviceNodes].sort((a, b) => a.name.localeCompare(b.name));
  }

  const assigned = new Set();
  const ordered = [];

  for (const boundary of boundaries) {
    const members = serviceNodes
      .filter(n => Array.isArray(boundary.services) && boundary.services.includes(n.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const m of members) {
      if (!assigned.has(m.id)) {
        ordered.push(m);
        assigned.add(m.id);
      }
    }
  }

  // Un-boundaried services alphabetically at the end
  const unboundaried = serviceNodes
    .filter(n => !assigned.has(n.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  return [...ordered, ...unboundaried];
}
