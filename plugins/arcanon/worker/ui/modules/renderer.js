/**
 * Canvas rendering — draws edges (with arrows), nodes, labels, and mismatch indicators.
 */

/**
 * Returns the layer key for a given node — used by the layer filter.
 * Layer → node type mapping:
 *   "services"  → "service" | "frontend" | unknown (safe default)
 *   "libraries" → "library" | "sdk"
 *   "infra"     → "infra"
 *   "external"  → "actor"
 */
function nodeLayer(node) {
  const t = (node.type || "service").toLowerCase();
  if (t === "library" || t === "sdk") return "libraries";
  if (t === "infra") return "infra";
  if (t === "actor") return "external";
  return "services"; // "service", "frontend", or unknown default
}

import {
  state,
  NODE_RADIUS,
  LABEL_MAX_CHARS,
  COLORS,
  PROTOCOL_COLORS,
  PROTOCOL_LINE_DASH,
  BUNDLE_SEVERITY,
} from "./state.js";
import {
  truncate,
  getNeighborIds,
  getNeighborIdsNHop,
  getNodeColor,
  getNodeType,
  computeEdgeBundles,
} from "./utils.js";

export function render() {
  const canvas = document.getElementById("graph-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.width;
  const H = canvas.height;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#0f1117";
  ctx.fillRect(0, 0, W, H);

  if (state.graphData.nodes.length === 0) return;

  const visibleIds = new Set(
    state.graphData.nodes
      .filter((n) => {
        // 1. Search filter (existing)
        if (!n.name.toLowerCase().includes(state.searchFilter)) return false;
        // 2. Layer filter
        if (!state.activeLayers.has(nodeLayer(n))) return false;
        // 3. Language filter
        if (state.languageFilter && n.language !== state.languageFilter) return false;
        // 4. Boundary filter
        if (state.boundaryFilter && n.boundary !== state.boundaryFilter) return false;
        return true;
      })
      .map((n) => n.id),
  );

  // 5. Hide isolated nodes — remove from visibleIds nodes with zero visible edges
  if (state.hideIsolated) {
    const connectedIds = new Set();
    for (const edge of state.graphData.edges) {
      // Only count edges that pass protocol + mismatch filters and both endpoints visible
      if (!state.activeProtocols.has(edge.protocol)) continue;
      if (state.mismatchesOnly && !edge.mismatch) continue;
      if (visibleIds.has(edge.source_service_id) && visibleIds.has(edge.target_service_id)) {
        connectedIds.add(edge.source_service_id);
        connectedIds.add(edge.target_service_id);
      }
    }
    for (const id of [...visibleIds]) {
      if (!connectedIds.has(id)) visibleIds.delete(id);
    }
  }

  // 6. Subgraph isolation — restrict visibleIds to N-hop neighborhood
  if (state.isolatedNodeId !== null) {
    const isolationSet = getNeighborIdsNHop(state.isolatedNodeId, state.isolationDepth);
    for (const id of [...visibleIds]) {
      if (!isolationSet.has(id)) visibleIds.delete(id);
    }
  }

  const neighborIds = state.selectedNodeId
    ? getNeighborIds(state.selectedNodeId)
    : new Set();

  const hasSelection = state.selectedNodeId !== null;
  const hasBlast = state.blastNodeId !== null && state.blastSet.size > 0;

  ctx.save();
  ctx.scale(dpr, dpr);   // DPR scale — render-time only, not a logical transform
  ctx.translate(state.transform.x, state.transform.y);
  ctx.scale(state.transform.scale, state.transform.scale);

  // Draw layer boxes (outermost containers — Services, Libraries, Infrastructure)
  for (const box of (state.layerBoxes || [])) {
    ctx.save();
    // Subtle fill
    ctx.globalAlpha = 0.04;
    ctx.fillStyle = '#a0aec0';
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.w, box.h, 10);
    ctx.fill();

    // Thin solid border
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = '#a0aec0';
    ctx.lineWidth = 1 / state.transform.scale;
    ctx.stroke();

    // Layer label at top-left
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = '#a0aec0';
    ctx.font = `bold ${Math.round(13 / state.transform.scale)}px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(box.label, box.x + 10, box.y + 5);
    ctx.restore();
  }

  // Draw boundary boxes (behind edges and nodes)
  for (const box of state.boundaryBoxes) {
    ctx.save();
    // Semi-transparent fill
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = '#63b3ed';
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.w, box.h, 8);
    ctx.fill();

    // Dashed border
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = '#63b3ed';
    ctx.lineWidth = 1 / state.transform.scale;
    ctx.setLineDash([6 / state.transform.scale, 4 / state.transform.scale]);
    ctx.stroke();
    ctx.setLineDash([]);  // CRITICAL: reset dash pattern

    // Label at top-left inside the box (above nodes due to LABEL_HEIGHT offset)
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#63b3ed';
    ctx.font = `bold ${Math.round(12 / state.transform.scale)}px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(box.label, box.x + 10, box.y + 6);
    ctx.restore();
  }

  // Filter edges that pass active protocol and mismatch filters, then bundle
  const filteredEdges = state.graphData.edges.filter((edge) => {
    if (!state.activeProtocols.has(edge.protocol)) return false;
    if (state.mismatchesOnly && !edge.mismatch) return false;
    if (!visibleIds.has(edge.source_service_id) && !visibleIds.has(edge.target_service_id)) return false;
    return true;
  });
  const bundles = computeEdgeBundles(filteredEdges);

  // Draw edges (bundle-aware: one line per source→target pair)
  for (const bundle of bundles) {
    const src = bundle.source_service_id;
    const tgt = bundle.target_service_id;

    const srcPos = state.positions[src];
    const tgtPos = state.positions[tgt];
    if (!srcPos || !tgtPos) continue;

    // Determine selection / blast relationship for this bundle
    const isSelectedEdge =
      hasSelection &&
      (src === state.selectedNodeId || tgt === state.selectedNodeId) &&
      (neighborIds.has(src) ||
        neighborIds.has(tgt) ||
        src === state.selectedNodeId ||
        tgt === state.selectedNodeId);
    const isBlastEdge =
      hasBlast && state.blastSet.has(src) && state.blastSet.has(tgt);

    // Determine color
    let color;
    if (isSelectedEdge) color = COLORS.edge.selected;
    else if (isBlastEdge) color = COLORS.edge.blast;
    else if (hasSelection || hasBlast) color = COLORS.edge.dimmed;
    else if (bundle.hasMismatch) color = "#fc8181";
    else color = PROTOCOL_COLORS[bundle.protocol] || COLORS.edge.default;

    // Determine lineWidth: single edges use 1px, bundles scale with count
    let lineWidth;
    if (bundle.count === 1) {
      lineWidth = isSelectedEdge || isBlastEdge ? 2 : 1;
    } else {
      // count=2 → 3px, count=3 → 4px, count=5+ → 6px
      lineWidth = 2 + Math.min(bundle.count - 1, 4);
      if (isSelectedEdge || isBlastEdge) lineWidth += 1;
    }

    // Line dash: per-protocol for single edges; solid for bundles (thickness communicates)
    let scaledDash;
    if (bundle.count === 1) {
      const dashPattern = PROTOCOL_LINE_DASH[bundle.protocol] || [];
      scaledDash = dashPattern.map((v) => v / state.transform.scale);
    } else {
      scaledDash = [];
    }

    // What-changed overlay: brighten bundle if ANY member edge is from the latest scan
    const isNewBundle =
      state.showChanges &&
      state.latestScanVersionId !== null &&
      bundle.edges.some((e) => e.scan_version_id === state.latestScanVersionId);

    // Override color and width only when there's no selection/blast active
    if (isNewBundle && !hasSelection && !hasBlast) {
      color = COLORS.edge.new;
      lineWidth = bundle.count === 1 ? 2 : lineWidth;
    }

    ctx.beginPath();
    ctx.setLineDash(scaledDash);
    ctx.moveTo(srcPos.x, srcPos.y);
    ctx.lineTo(tgtPos.x, tgtPos.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth / state.transform.scale;
    ctx.globalAlpha =
      (hasSelection || hasBlast) && !isSelectedEdge && !isBlastEdge
        ? 0.2
        : 0.85;
    ctx.stroke();
    ctx.setLineDash([]);

    // Arrowhead
    const arrowSize = 8 / state.transform.scale;
    const dx = tgtPos.x - srcPos.x;
    const dy = tgtPos.y - srcPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 0) {
      const ux = dx / dist;
      const uy = dy / dist;
      const ax = tgtPos.x - ux * NODE_RADIUS;
      const ay = tgtPos.y - uy * NODE_RADIUS;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(
        ax - ux * arrowSize + uy * arrowSize * 0.4,
        ay - uy * arrowSize - ux * arrowSize * 0.4,
      );
      ctx.lineTo(
        ax - ux * arrowSize - uy * arrowSize * 0.4,
        ay - uy * arrowSize + ux * arrowSize * 0.4,
      );
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Mismatch cross — draw at midpoint if any edge in bundle has mismatch
    if (bundle.hasMismatch) {
      const mx = (srcPos.x + tgtPos.x) / 2;
      const my = (srcPos.y + tgtPos.y) / 2;
      const crossSize = 6 / state.transform.scale;
      ctx.strokeStyle = "#fc8181";
      ctx.lineWidth = 2 / state.transform.scale;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(mx - crossSize, my - crossSize);
      ctx.lineTo(mx + crossSize, my + crossSize);
      ctx.moveTo(mx + crossSize, my - crossSize);
      ctx.lineTo(mx - crossSize, my + crossSize);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Count badge — draw for bundled edges (count > 1)
    if (bundle.count > 1) {
      const mx = (srcPos.x + tgtPos.x) / 2;
      const my = (srcPos.y + tgtPos.y) / 2;

      // Offset badge perpendicular to edge direction to avoid overlap with mismatch cross
      const badgeRadius = 10 / state.transform.scale;
      let bx = mx;
      let by = my;
      if (dist > 0) {
        // Perpendicular unit vector (rotate dx/dy by 90 degrees)
        const px = -dy / dist;
        const py = dx / dist;
        const offset = 12 / state.transform.scale;
        bx = mx + px * offset;
        by = my + py * offset;
      }

      // Badge background circle
      ctx.beginPath();
      ctx.arc(bx, by, badgeRadius, 0, Math.PI * 2);
      ctx.fillStyle = "#1a202c";
      ctx.globalAlpha = 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;

      // Badge text
      ctx.fillStyle = "#e2e8f0";
      ctx.font = `bold ${Math.round(11 / state.transform.scale)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(bundle.count), bx, by);
    }
  }

  // Draw nodes
  for (const node of state.graphData.nodes) {
    const pos = state.positions[node.id];
    if (!pos) continue;

    const isVisible = visibleIds.has(node.id);
    const isSelected = node.id === state.selectedNodeId;
    const isNeighbor = neighborIds.has(node.id);
    const isBlastNode = hasBlast && state.blastSet.has(node.id);

    let nodeColor;
    if (isSelected) nodeColor = COLORS.node.selected;
    else if (isBlastNode) nodeColor = COLORS.node.blast;
    else if (hasSelection && isNeighbor) nodeColor = COLORS.node.selected;
    else if ((hasSelection || hasBlast) && isVisible)
      nodeColor = COLORS.node.dimmed;
    else if (!isVisible) nodeColor = COLORS.node.dimmed;
    else nodeColor = getNodeColor(node);

    const alpha = !isVisible
      ? 0.15
      : (hasSelection || hasBlast) && !isSelected && !isNeighbor && !isBlastNode
        ? 0.3
        : 1;

    ctx.globalAlpha = alpha;

    const nodeType = getNodeType(node);
    ctx.beginPath();
    if (nodeType === "actor") {
      // Hexagon for external actors — pointy-top orientation
      const r = NODE_RADIUS * 1.1;  // slightly larger for visibility
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 2;  // pointy-top (rotated 90deg from flat-top)
        const hx = pos.x + r * Math.cos(angle);
        const hy = pos.y + r * Math.sin(angle);
        if (i === 0) ctx.moveTo(hx, hy);
        else ctx.lineTo(hx, hy);
      }
      ctx.closePath();
      ctx.fillStyle = nodeColor;
      ctx.fill();
    } else if (nodeType === "library" || nodeType === "sdk") {
      // Outline diamond for libraries/SDKs (stroke only, no nodeColor fill)
      const r = NODE_RADIUS * 1.2;
      ctx.moveTo(pos.x, pos.y - r);
      ctx.lineTo(pos.x + r, pos.y);
      ctx.lineTo(pos.x, pos.y + r);
      ctx.lineTo(pos.x - r, pos.y);
      ctx.closePath();
      // Dark background fill to prevent edge bleed-through
      ctx.fillStyle = '#0f1117';
      ctx.fill();
      // Outline stroke only — NOT filled with nodeColor
      ctx.strokeStyle = nodeColor;
      ctx.lineWidth = 1.5 / state.transform.scale;
      ctx.stroke();
    } else if (nodeType === "infra") {
      // Filled diamond for infrastructure
      const r = NODE_RADIUS * 1.1;
      ctx.moveTo(pos.x, pos.y - r);
      ctx.lineTo(pos.x + r, pos.y);
      ctx.lineTo(pos.x, pos.y + r);
      ctx.lineTo(pos.x - r, pos.y);
      ctx.closePath();
      ctx.fillStyle = nodeColor;
      ctx.fill();
    } else {
      // Circle for services (default)
      ctx.arc(pos.x, pos.y, NODE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = nodeColor;
      ctx.fill();
    }

    if (isSelected || isBlastNode) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2 / state.transform.scale;
      ctx.stroke();
    }

    // What-changed overlay: draw glow ring around nodes from the latest scan
    const isNewNode =
      state.showChanges &&
      state.latestScanVersionId !== null &&
      node.scan_version_id === state.latestScanVersionId;

    if (isNewNode && isVisible) {
      ctx.save();
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = COLORS.node.new;
      ctx.lineWidth = 2.5 / state.transform.scale;
      ctx.shadowColor = COLORS.node.new;
      ctx.shadowBlur = 8 / state.transform.scale;
      // Redraw just the outline path for the glow ring (same shape, larger radius offset)
      const glowR = NODE_RADIUS + 4;
      ctx.beginPath();
      if (nodeType === "actor") {
        const r = NODE_RADIUS * 1.1 + 4;
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 3) * i - Math.PI / 2;
          const hx = pos.x + r * Math.cos(angle);
          const hy = pos.y + r * Math.sin(angle);
          if (i === 0) ctx.moveTo(hx, hy);
          else ctx.lineTo(hx, hy);
        }
        ctx.closePath();
      } else if (nodeType === "library" || nodeType === "sdk" || nodeType === "infra") {
        const r = NODE_RADIUS * 1.2 + 4;
        ctx.moveTo(pos.x, pos.y - r);
        ctx.lineTo(pos.x + r, pos.y);
        ctx.lineTo(pos.x, pos.y + r);
        ctx.lineTo(pos.x - r, pos.y);
        ctx.closePath();
      } else {
        ctx.arc(pos.x, pos.y, glowR, 0, Math.PI * 2);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Name label
    const label = truncate(node.name, LABEL_MAX_CHARS);
    const labelColor =
      !isVisible ||
      ((hasSelection || hasBlast) && !isSelected && !isNeighbor && !isBlastNode)
        ? COLORS.label.dimmed
        : COLORS.label.default;
    ctx.fillStyle = labelColor;
    ctx.font = `${Math.round(13 / state.transform.scale)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(label, pos.x, pos.y + NODE_RADIUS + 3);

    // Type subtitle (nodeType already computed above for shape selection)
    if (nodeType !== "service") {
      ctx.fillStyle = getNodeColor(node);
      ctx.font = `${Math.round(11 / state.transform.scale)}px system-ui, sans-serif`;
      ctx.fillText(nodeType, pos.x, pos.y + NODE_RADIUS + 16);
    }

    ctx.globalAlpha = 1;
  }

  ctx.restore();
}
