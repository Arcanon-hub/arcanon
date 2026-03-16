/**
 * Canvas rendering — draws edges (with arrows), nodes, labels, and mismatch indicators.
 */

import {
  state,
  NODE_RADIUS,
  LABEL_MAX_CHARS,
  COLORS,
  PROTOCOL_COLORS,
} from "./state.js";
import {
  truncate,
  getNeighborIds,
  getNodeColor,
  getNodeType,
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
      .filter((n) => n.name.toLowerCase().includes(state.searchFilter))
      .map((n) => n.id),
  );

  const neighborIds = state.selectedNodeId
    ? getNeighborIds(state.selectedNodeId)
    : new Set();

  const hasSelection = state.selectedNodeId !== null;
  const hasBlast = state.blastNodeId !== null && state.blastSet.size > 0;

  ctx.save();
  ctx.scale(dpr, dpr);   // DPR scale — render-time only, not a logical transform
  ctx.translate(state.transform.x, state.transform.y);
  ctx.scale(state.transform.scale, state.transform.scale);

  // Draw edges
  for (const edge of state.graphData.edges) {
    const src = edge.source_service_id;
    const tgt = edge.target_service_id;

    if (!state.activeProtocols.has(edge.protocol)) continue;
    if (!visibleIds.has(src) && !visibleIds.has(tgt)) continue;

    const srcPos = state.positions[src];
    const tgtPos = state.positions[tgt];
    if (!srcPos || !tgtPos) continue;

    let color;
    const isSelectedEdge =
      hasSelection &&
      (src === state.selectedNodeId || tgt === state.selectedNodeId) &&
      (neighborIds.has(src) ||
        neighborIds.has(tgt) ||
        src === state.selectedNodeId ||
        tgt === state.selectedNodeId);
    const isBlastEdge =
      hasBlast && state.blastSet.has(src) && state.blastSet.has(tgt);

    if (isSelectedEdge) color = COLORS.edge.selected;
    else if (isBlastEdge) color = COLORS.edge.blast;
    else if (hasSelection || hasBlast) color = COLORS.edge.dimmed;
    else color = PROTOCOL_COLORS[edge.protocol] || COLORS.edge.default;

    const lineWidth = isSelectedEdge || isBlastEdge ? 2 : 1;
    const isSdkEdge = edge.protocol === "sdk" || edge.protocol === "import";

    ctx.beginPath();
    if (isSdkEdge) {
      ctx.setLineDash([4 / state.transform.scale, 4 / state.transform.scale]);
    } else {
      ctx.setLineDash([]);
    }
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

    // Mismatch cross
    if (edge.mismatch) {
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
    if (nodeType === "library" || nodeType === "sdk") {
      // Hexagon for libraries/SDKs
      const r = NODE_RADIUS;
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6;
        const hx = pos.x + r * Math.cos(angle);
        const hy = pos.y + r * Math.sin(angle);
        if (i === 0) ctx.moveTo(hx, hy);
        else ctx.lineTo(hx, hy);
      }
      ctx.closePath();
    } else if (nodeType === "infra") {
      // Diamond for infrastructure
      const r = NODE_RADIUS * 1.1;
      ctx.moveTo(pos.x, pos.y - r);
      ctx.lineTo(pos.x + r, pos.y);
      ctx.lineTo(pos.x, pos.y + r);
      ctx.lineTo(pos.x - r, pos.y);
      ctx.closePath();
    } else {
      // Circle for services (default)
      ctx.arc(pos.x, pos.y, NODE_RADIUS, 0, Math.PI * 2);
    }
    ctx.fillStyle = nodeColor;
    ctx.fill();

    if (isSelected || isBlastNode) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2 / state.transform.scale;
      ctx.stroke();
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
