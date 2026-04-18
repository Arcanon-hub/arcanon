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
const BOX_PAD_Y = 50;       // vertical padding above/below nodes
const BOX_PAD_X = 80;       // horizontal padding — must cover half of longest node label
const LABEL_HEIGHT = 28;    // space above nodes for boundary label
const NODE_LABEL_CLEARANCE = 30;  // space below nodes for name + type labels

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
  const actorNodes   = [];

  for (const node of nodes) {
    // Actor nodes go to the dedicated right column — skip regular layer logic
    if (node._isActor || node.type === 'actor') {
      actorNodes.push(node);
      continue;
    }
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

  // Max nodes per row before wrapping — prevents extreme horizontal spread
  const MAX_PER_ROW = 6;

  for (const { name, nodes: layerNodes } of layers) {
    const n = layerNodes.length;
    if (n === 0) continue;
    const { y: bandY, h: bandH } = bands[name];
    const cols = Math.min(n, MAX_PER_ROW);
    const rows = Math.ceil(n / cols);
    const cellW = usableW / cols;
    const rowH = bandH / rows;
    layerNodes.forEach((node, i) => {
      const row = Math.floor(i / cols);
      const col = i % cols;
      // Center partial last row
      const nodesInRow = (row < rows - 1) ? cols : n - row * cols;
      const rowOffset = (usableW - nodesInRow * cellW) / 2;
      positions[node.id] = {
        x: PADDING + rowOffset + cellW * col + cellW / 2,
        y: bandY + rowH * row + rowH / 2,
      };
    });
  }

  // ── 6. Position actor nodes in the reserved right column ─────────────
  if (actorNodes.length > 0) {
    // Center of the actor column: past usableW, centered in the reserved area
    const actorColumnX = PADDING + usableW + actorReserve / 2;
    const actorSpacingY = (canvasH - PADDING * 2) / Math.max(actorNodes.length, 1);

    for (let i = 0; i < actorNodes.length; i++) {
      positions[actorNodes[i].id] = {
        x: actorColumnX,
        y: PADDING + actorSpacingY * i + actorSpacingY / 2,
      };
    }
  }

  // ── 7. Compute boundary boxes ─────────────────────────────────────────
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

    // Add LABEL_HEIGHT top + NODE_LABEL_CLEARANCE bottom for node names
    const topExtra = LABEL_HEIGHT;
    const bottomExtra = NODE_LABEL_CLEARANCE;
    const boxH = Math.max(
      NODE_RADIUS * 2 + BOX_PAD_Y * 2 + topExtra + bottomExtra,
      maxY - minY + BOX_PAD_Y * 2 + topExtra + bottomExtra,
    );

    boundaryBoxes.push({
      label: boundary.label || boundary.name,
      x: minX - BOX_PAD_X,
      y: minY - BOX_PAD_Y - topExtra,
      w: maxX - minX + BOX_PAD_X * 2,
      h: boxH,
    });
  }

  // ── 8. Compute layer boxes (always shown for non-empty layers) ──────────
  // Skip the services layer box when boundaries exist — boundaries provide structure
  const LAYER_LABELS = { service: 'Services', library: 'Libraries', infra: 'Infrastructure' };
  const hasBoundaries = boundaryBoxes.length > 0;
  const layerBoxes = [];
  for (const { name, nodes: layerNodes } of layers) {
    if (layerNodes.length === 0) continue;
    if (name === 'service' && hasBoundaries) continue;  // boundaries replace the services layer box
    const ids = layerNodes.map(n => n.id);
    const xs = ids.map(id => positions[id]?.x).filter(v => v != null);
    const ys = ids.map(id => positions[id]?.y).filter(v => v != null);
    if (xs.length === 0) continue;

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const topExtra = LABEL_HEIGHT;
    const bottomExtra = NODE_LABEL_CLEARANCE;
    layerBoxes.push({
      label: LAYER_LABELS[name] || name,
      x: minX - BOX_PAD_X,
      y: minY - BOX_PAD_Y - topExtra,
      w: maxX - minX + BOX_PAD_X * 2,
      h: Math.max(NODE_RADIUS * 2 + BOX_PAD_Y * 2 + topExtra + bottomExtra, maxY - minY + BOX_PAD_Y * 2 + topExtra + bottomExtra),
    });
  }

  return { positions, boundaryBoxes, layerBoxes };
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
