/**
 * Detail panel — shows node info on click (services show calls, libraries show exports, infra shows resources).
 */

import { state } from "./state.js";
import { getNodeType, getNodeColor } from "./utils.js";

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function showDetailPanel(node) {
  const panel = document.getElementById("detail-panel");
  const content = document.getElementById("detail-content");

  // Actor detail panel — different data shape from services
  if (node._isActor) {
    content.innerHTML = renderActorDetail(node);
    panel.style.display = "block";
    return;
  }

  const outgoing = state.graphData.edges.filter(
    (e) => e.source_service_id === node.id,
  );
  const incoming = state.graphData.edges.filter(
    (e) => e.target_service_id === node.id,
  );

  const nameById = {};
  state.graphData.nodes.forEach((n) => (nameById[n.id] = n.name));

  const nodeType = getNodeType(node);
  const typeColor = getNodeColor(node);
  let html = `<h3>${node.name}</h3>`;

  html += `<div class="detail-section">
    <div class="detail-label">Type</div>
    <div class="detail-value" style="color:${typeColor}">${nodeType}</div>
  </div>`;

  html += `<div class="detail-section">
    <div class="detail-label">Language</div>
    <div class="detail-value">${node.language || "unknown"}</div>
  </div>`;

  if (node.repo_name) {
    html += `<div class="detail-section">
      <div class="detail-label">Repository</div>
      <div class="detail-value">${node.repo_name}</div>
    </div>`;
  }

  if (nodeType === 'infra') {
    html += renderInfraConnections(node, outgoing, nameById);
  } else if (nodeType === 'library' || nodeType === 'sdk') {
    html += renderLibraryConnections(node, outgoing, incoming, nameById);
  } else {
    html += renderServiceConnections(outgoing, incoming, nameById);
  }

  if (outgoing.length === 0 && incoming.length === 0 && (node.exposes || []).length === 0) {
    html += `<div class="detail-section">
      <div class="detail-value" style="color: #718096">No connections</div>
    </div>`;
  }

  content.innerHTML = html;
  panel.style.display = "block";
}

function renderLibraryConnections(node, outgoing, incoming, nameById) {
  let html = "";

  const exports = (node.exposes || []).filter(
    (ex) => ex.kind === 'export'
  );

  if (exports.length > 0) {
    const functions = exports.filter((ex) => ex.path && ex.path.includes('('));
    const types = exports.filter((ex) => !ex.path || !ex.path.includes('('));

    html += `<div class="detail-section">
      <div class="detail-label">Exports (${exports.length})</div>`;

    if (functions.length > 0) {
      html += `<div class="detail-label" style="font-size:0.85em;margin-top:4px">Functions (${functions.length})</div>`;
      for (const ex of functions) {
        html += `<div class="connection-item">
          <div class="conn-path">${escapeHtml(ex.path)}</div>
        </div>`;
      }
    }

    if (types.length > 0) {
      html += `<div class="detail-label" style="font-size:0.85em;margin-top:4px">Types (${types.length})</div>`;
      for (const ex of types) {
        html += `<div class="connection-item">
          <div class="conn-path">${escapeHtml(ex.path)}</div>
        </div>`;
      }
    }

    html += `</div>`;
  }

  if (incoming.length > 0) {
    html += `<div class="detail-section">
      <div class="detail-label">Used by (${incoming.length} services)</div>`;
    const users = new Set();
    for (const e of incoming) {
      const source = nameById[e.source_service_id] || "?";
      if (!users.has(source)) {
        users.add(source);
        html += `<div class="connection-item">
          <div><span class="conn-target">${escapeHtml(source)}</span></div>
          ${e.source_file ? `<div class="conn-file">${escapeHtml(e.source_file)}</div>` : ""}
        </div>`;
      }
    }
    html += `</div>`;
  }

  return html;
}

function renderInfraConnections(node, outgoing, nameById) {
  let html = "";

  const resources = (node.exposes || []).filter(
    (r) => r.kind === 'resource'
  );

  if (resources.length > 0) {
    // Group by prefix: r.path.split('/')[0]
    const groups = {};
    for (const r of resources) {
      const prefix = r.path ? r.path.split('/')[0] : 'unknown';
      if (!groups[prefix]) groups[prefix] = [];
      groups[prefix].push(r);
    }

    html += `<div class="detail-section">
      <div class="detail-label">Manages (${resources.length})</div>`;

    for (const [prefix, items] of Object.entries(groups)) {
      html += `<div class="detail-label" style="font-size:0.85em;margin-top:4px">${escapeHtml(prefix)} (${items.length})</div>`;
      for (const r of items) {
        html += `<div class="connection-item">
          <div class="conn-path">${escapeHtml(r.path)}</div>
        </div>`;
      }
    }

    html += `</div>`;
  }

  if (outgoing.length > 0) {
    html += `<div class="detail-section">
      <div class="detail-label">Wires (${outgoing.length})</div>`;
    for (const e of outgoing) {
      const target = nameById[e.target_service_id] || "?";
      html += `<div class="connection-item">
        <div><span class="conn-method">${escapeHtml(e.method || e.protocol || '')}</span> <span class="conn-path">${escapeHtml(e.path || '')}</span></div>
        <div class="conn-direction">→ <span class="conn-target">${escapeHtml(target)}</span></div>
        ${e.source_file ? `<div class="conn-file">${escapeHtml(e.source_file)}</div>` : ""}
      </div>`;
    }
    html += `</div>`;
  }

  return html;
}

function renderServiceConnections(outgoing, incoming, nameById) {
  let html = "";

  if (outgoing.length > 0) {
    html += `<div class="detail-section">
      <div class="detail-label">Calls (${outgoing.length})</div>`;
    for (const e of outgoing) {
      const target = nameById[e.target_service_id] || "?";
      const mismatchFlag = e.mismatch
        ? ' <span style="color:#fc8181;font-weight:bold" title="Endpoint not verified in target">✗</span>'
        : "";
      html += `<div class="connection-item" ${e.mismatch ? 'style="border-left:2px solid #fc8181"' : ""}>
        <div><span class="conn-method">${e.method || e.protocol}</span> <span class="conn-path">${e.path || ""}</span>${mismatchFlag}</div>
        <div class="conn-direction">→ <span class="conn-target">${target}</span></div>
        ${e.source_file ? `<div class="conn-file">${e.source_file}</div>` : ""}
        ${e.mismatch ? '<div class="conn-file" style="color:#fc8181">⚠ Endpoint handler not found in target</div>' : ""}
      </div>`;
    }
    html += `</div>`;
  }

  if (incoming.length > 0) {
    html += `<div class="detail-section">
      <div class="detail-label">Called by (${incoming.length})</div>`;
    for (const e of incoming) {
      const source = nameById[e.source_service_id] || "?";
      const mismatchFlag = e.mismatch
        ? ' <span style="color:#fc8181;font-weight:bold" title="Endpoint not verified">✗</span>'
        : "";
      html += `<div class="connection-item" ${e.mismatch ? 'style="border-left:2px solid #fc8181"' : ""}>
        <div><span class="conn-method">${e.method || e.protocol}</span> <span class="conn-path">${e.path || ""}</span>${mismatchFlag}</div>
        <div class="conn-direction">← <span class="conn-target">${source}</span></div>
        ${e.target_file ? `<div class="conn-file">${e.target_file}</div>` : ""}
        ${e.mismatch ? '<div class="conn-file" style="color:#fc8181">⚠ Endpoint handler not found in target</div>' : ""}
      </div>`;
    }
    html += `</div>`;
  }

  return html;
}

function renderActorDetail(node) {
  const actor = node._actorData;
  const typeColor = getNodeColor(node);

  let html = `<h3>${escapeHtml(actor.name)}</h3>`;

  html += `<div class="detail-section">
    <div class="detail-label">Type</div>
    <div class="detail-value" style="color:${typeColor}">External ${escapeHtml(actor.kind)}</div>
  </div>`;

  html += `<div class="detail-section">
    <div class="detail-label">Direction</div>
    <div class="detail-value">${escapeHtml(actor.direction)}</div>
  </div>`;

  const services = actor.connected_services || [];
  if (services.length > 0) {
    html += `<div class="detail-section">
      <div class="detail-label">Connected Services (${services.length})</div>`;
    for (const cs of services) {
      html += `<div class="connection-item">
        <div><span class="conn-method">${escapeHtml(cs.protocol || '')}</span> <span class="conn-path">${escapeHtml(cs.path || '')}</span></div>
        <div class="conn-direction">&larr; <span class="conn-target">${escapeHtml(cs.service_name)}</span></div>
      </div>`;
    }
    html += `</div>`;
  } else {
    html += `<div class="detail-section">
      <div class="detail-value" style="color: #718096">No connected services</div>
    </div>`;
  }

  return html;
}

export function hideDetailPanel() {
  document.getElementById("detail-panel").style.display = "none";
}
