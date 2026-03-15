/**
 * graph.js — D3 Canvas force-directed graph renderer with full interactions.
 *
 * Architecture:
 * - D3 force simulation runs in force-worker.js (Web Worker) — never blocks main thread
 * - All rendering uses Canvas 2D context — never SVG
 * - Hit detection uses Math.hypot for point-in-circle (Canvas has no DOM elements)
 * - Pan/zoom via transform state applied with ctx.setTransform()
 */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let graphData = { nodes: [], edges: [] };
let positions = {}; // nodeId -> { x, y }
let selectedNodeId = null; // clicked node (highlight direct neighbors)
let blastNodeId = null; // shift-clicked node (transitive blast radius)
let blastSet = new Set(); // IDs returned by /impact for blastNodeId
let blastCache = {}; // nodeName -> Set of affected IDs (cache /impact calls)
let activeProtocols = new Set(["rest", "grpc", "events", "internal"]);
let searchFilter = "";
let forceWorker = null;
let isDragging = false;
let dragNodeId = null;
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let panStartTransformX = 0;
let panStartTransformY = 0;
let dragStarted = false; // distinguish click from drag
let transform = { x: 0, y: 0, scale: 1 };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NODE_RADIUS = 18;
const LABEL_MAX_CHARS = 12;

// Node colors by service type and language
const NODE_TYPE_COLORS = {
  library: "#9f7aea", // purple for libraries/SDKs
  sdk: "#9f7aea",
  frontend: "#f6ad55", // orange for frontend
  service: "#4299e1", // blue for services (default)
};

function getNodeColor(node) {
  // Check type field from scan data
  if (node.type === "library" || node.type === "sdk")
    return NODE_TYPE_COLORS.library;
  // Detect frontend by language or name
  if (
    node.language === "typescript" ||
    node.language === "javascript" ||
    (node.name && /ui|frontend|web|dashboard|app/i.test(node.name))
  )
    return NODE_TYPE_COLORS.frontend;
  return NODE_TYPE_COLORS.service;
}

const COLORS = {
  node: {
    default: "#4299e1",
    selected: "#f6ad55",
    blast: "#fc8181",
    dimmed: "#2d3748",
  },
  edge: {
    default: "#4a5568",
    selected: "#f6ad55",
    blast: "#fc8181",
    dimmed: "#1a202c",
  },
  label: {
    default: "#e2e8f0",
    dimmed: "#4a5568",
  },
};

// Protocol edge colors for unselected state
const PROTOCOL_COLORS = {
  rest: "#4299e1",
  grpc: "#68d391",
  events: "#9f7aea",
  internal: "#4a5568",
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function truncate(str, max) {
  return str.length > max ? str.slice(0, max) + "…" : str;
}

/**
 * Convert canvas pixel coordinates to world coordinates (accounting for transform).
 */
function toWorld(px, py) {
  return {
    x: (px - transform.x) / transform.scale,
    y: (py - transform.y) / transform.scale,
  };
}

/**
 * Find node at canvas pixel (px, py). Returns node or null.
 */
function hitTest(px, py) {
  const { x: wx, y: wy } = toWorld(px, py);
  for (const node of graphData.nodes) {
    const pos = positions[node.id];
    if (!pos) continue;
    if (Math.hypot(wx - pos.x, wy - pos.y) < NODE_RADIUS) {
      return node;
    }
  }
  return null;
}

/**
 * Get IDs of direct neighbors of a node (by edge).
 */
function getNeighborIds(nodeId) {
  const ids = new Set();
  for (const e of graphData.edges) {
    if (e.source_service_id === nodeId) ids.add(e.target_service_id);
    if (e.target_service_id === nodeId) ids.add(e.source_service_id);
  }
  return ids;
}

/**
 * Fetch /impact for a node name (with cache).
 */
async function fetchImpact(nodeName, nodeId) {
  if (blastCache[nodeName] !== undefined) {
    return blastCache[nodeName];
  }
  try {
    const urlProject = new URLSearchParams(window.location.search).get(
      "project",
    );
    const pParam = urlProject
      ? `&project=${encodeURIComponent(urlProject)}`
      : "";
    const resp = await fetch(
      `/impact?change=${encodeURIComponent(nodeName)}${pParam}`,
    );
    if (!resp.ok) {
      blastCache[nodeName] = new Set();
      return blastCache[nodeName];
    }
    const data = await resp.json();
    const affected = new Set((data.affected || []).map((a) => a.id));
    affected.add(nodeId); // include the source node itself
    blastCache[nodeName] = affected;
    return affected;
  } catch {
    blastCache[nodeName] = new Set();
    return blastCache[nodeName];
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render() {
  const canvas = document.getElementById("graph-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  // Clear
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#0f1117";
  ctx.fillRect(0, 0, W, H);

  if (graphData.nodes.length === 0) return;

  // -----------------------------------------------------------------------
  // Draw repo boundary boxes (behind everything else)
  // -----------------------------------------------------------------------
  const repoGroups = {};
  for (const node of graphData.nodes) {
    const repo = node.repo_name || "unknown";
    if (!repoGroups[repo]) repoGroups[repo] = [];
    repoGroups[repo].push(node);
  }

  const REPO_COLORS = [
    "rgba(66, 153, 225, 0.08)",
    "rgba(104, 211, 145, 0.08)",
    "rgba(159, 122, 234, 0.08)",
    "rgba(246, 173, 85, 0.08)",
    "rgba(252, 129, 129, 0.08)",
    "rgba(56, 178, 172, 0.08)",
  ];
  const REPO_BORDER_COLORS = [
    "rgba(66, 153, 225, 0.25)",
    "rgba(104, 211, 145, 0.25)",
    "rgba(159, 122, 234, 0.25)",
    "rgba(246, 173, 85, 0.25)",
    "rgba(252, 129, 129, 0.25)",
    "rgba(56, 178, 172, 0.25)",
  ];
  const REPO_LABEL_COLORS = [
    "rgba(66, 153, 225, 0.5)",
    "rgba(104, 211, 145, 0.5)",
    "rgba(159, 122, 234, 0.5)",
    "rgba(246, 173, 85, 0.5)",
    "rgba(252, 129, 129, 0.5)",
    "rgba(56, 178, 172, 0.5)",
  ];

  // Compute visible set based on search filter
  const visibleIds = new Set(
    graphData.nodes
      .filter((n) => n.name.toLowerCase().includes(searchFilter))
      .map((n) => n.id),
  );

  // Compute neighbor set for selected node
  const neighborIds = selectedNodeId
    ? getNeighborIds(selectedNodeId)
    : new Set();

  const hasSelection = selectedNodeId !== null;
  const hasBlast = blastNodeId !== null && blastSet.size > 0;

  // Apply pan/zoom transform
  ctx.save();
  ctx.translate(transform.x, transform.y);
  ctx.scale(transform.scale, transform.scale);

  // -----------------------------------------------------------------------
  // Draw edges
  // -----------------------------------------------------------------------
  for (const edge of graphData.edges) {
    const src = edge.source_service_id;
    const tgt = edge.target_service_id;

    // Protocol filter
    if (!activeProtocols.has(edge.protocol)) continue;

    // Search filter — skip edges where neither endpoint is visible
    if (!visibleIds.has(src) && !visibleIds.has(tgt)) continue;

    const srcPos = positions[src];
    const tgtPos = positions[tgt];
    if (!srcPos || !tgtPos) continue;

    // Determine edge color
    let color;
    const isSelectedEdge =
      hasSelection &&
      (src === selectedNodeId || tgt === selectedNodeId) &&
      (neighborIds.has(src) ||
        neighborIds.has(tgt) ||
        src === selectedNodeId ||
        tgt === selectedNodeId);
    const isBlastEdge = hasBlast && blastSet.has(src) && blastSet.has(tgt);

    if (isSelectedEdge) {
      color = COLORS.edge.selected;
    } else if (isBlastEdge) {
      color = COLORS.edge.blast;
    } else if (hasSelection || hasBlast) {
      color = COLORS.edge.dimmed;
    } else {
      // Default: color by protocol
      color = PROTOCOL_COLORS[edge.protocol] || COLORS.edge.default;
    }

    // Determine line width
    const lineWidth = isSelectedEdge || isBlastEdge ? 2 : 1;

    ctx.beginPath();
    ctx.moveTo(srcPos.x, srcPos.y);
    ctx.lineTo(tgtPos.x, tgtPos.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth / transform.scale;
    ctx.globalAlpha =
      (hasSelection || hasBlast) && !isSelectedEdge && !isBlastEdge
        ? 0.2
        : 0.85;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // -----------------------------------------------------------------------
  // Draw nodes
  // -----------------------------------------------------------------------
  for (const node of graphData.nodes) {
    const pos = positions[node.id];
    if (!pos) continue;

    const isVisible = visibleIds.has(node.id);
    const isSelected = node.id === selectedNodeId;
    const isNeighbor = neighborIds.has(node.id);
    const isBlastNode = hasBlast && blastSet.has(node.id);

    // Node circle color — varies by service type
    let nodeColor;
    if (isSelected) {
      nodeColor = COLORS.node.selected;
    } else if (isBlastNode) {
      nodeColor = COLORS.node.blast;
    } else if (hasSelection && isNeighbor) {
      nodeColor = COLORS.node.selected;
    } else if ((hasSelection || hasBlast) && isVisible) {
      nodeColor = COLORS.node.dimmed;
    } else if (!isVisible) {
      nodeColor = COLORS.node.dimmed;
    } else {
      nodeColor = getNodeColor(node);
    }

    const alpha = !isVisible
      ? 0.15
      : (hasSelection || hasBlast) && !isSelected && !isNeighbor && !isBlastNode
        ? 0.3
        : 1;

    ctx.globalAlpha = alpha;

    // Draw circle
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, NODE_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = nodeColor;
    ctx.fill();

    // Draw ring for selected/blast
    if (isSelected || isBlastNode) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2 / transform.scale;
      ctx.stroke();
    }

    // Draw label below circle
    const label = truncate(node.name, LABEL_MAX_CHARS);
    const labelColor =
      !isVisible ||
      ((hasSelection || hasBlast) && !isSelected && !isNeighbor && !isBlastNode)
        ? COLORS.label.dimmed
        : COLORS.label.default;
    ctx.fillStyle = labelColor;
    ctx.font = `${Math.round(11 / transform.scale)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(label, pos.x, pos.y + NODE_RADIUS + 3);

    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Worker message handler
// ---------------------------------------------------------------------------

function handleWorkerMessage({ data }) {
  if (data.type === "tick") {
    data.nodes.forEach(({ id, x, y }) => {
      positions[id] = { x, y };
    });
    render();
  }
  // 'end' message — simulation finished, nothing to do (positions already set)
}

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------

function setupInteractions(canvas) {
  const tooltip = document.getElementById("tooltip");
  let mouseDownX = 0;
  let mouseDownY = 0;

  // Mousemove — hover tooltip + drag
  canvas.addEventListener("mousemove", (e) => {
    const px = e.offsetX;
    const py = e.offsetY;

    if (isDragging && dragNodeId !== null) {
      const { x: wx, y: wy } = toWorld(px, py);
      forceWorker.postMessage({
        type: "drag",
        nodeId: dragNodeId,
        x: wx,
        y: wy,
      });
      dragStarted = true;
      render();
      return;
    }

    if (isPanning) {
      transform.x = panStartTransformX + (px - panStartX);
      transform.y = panStartTransformY + (py - panStartY);
      dragStarted = true;
      render();
      return;
    }

    const node = hitTest(px, py);
    if (node) {
      canvas.style.cursor = "pointer";
      tooltip.style.display = "block";
      tooltip.style.left = px + 12 + "px";
      tooltip.style.top = py - 8 + "px";
      tooltip.textContent =
        node.name + (node.language ? ` (${node.language})` : "");
    } else {
      canvas.style.cursor = isDragging ? "grabbing" : "grab";
      tooltip.style.display = "none";
    }
  });

  // Mousedown — start drag or pan
  canvas.addEventListener("mousedown", (e) => {
    mouseDownX = e.offsetX;
    mouseDownY = e.offsetY;
    dragStarted = false;

    const node = hitTest(e.offsetX, e.offsetY);
    if (node) {
      isDragging = true;
      dragNodeId = node.id;
    } else {
      // No node hit — start panning
      isPanning = true;
      panStartX = e.offsetX;
      panStartY = e.offsetY;
      panStartTransformX = transform.x;
      panStartTransformY = transform.y;
    }
  });

  // Mouseup — release drag or pan
  canvas.addEventListener("mouseup", (e) => {
    if (isDragging && dragNodeId !== null && dragStarted) {
      const { x: wx, y: wy } = toWorld(e.offsetX, e.offsetY);
      if (forceWorker) {
        forceWorker.postMessage({
          type: "drag",
          nodeId: dragNodeId,
          x: wx,
          y: wy,
        });
      }
    }
    isDragging = false;
    dragNodeId = null;
    isPanning = false;
  });

  // Click — select node or clear selection
  canvas.addEventListener("click", (e) => {
    if (dragStarted) {
      dragStarted = false;
      return; // was a drag, not a click
    }

    const node = hitTest(e.offsetX, e.offsetY);

    if (node) {
      if (e.shiftKey) {
        // Shift+click: blast radius
        if (blastNodeId === node.id) {
          // Toggle off
          blastNodeId = null;
          blastSet = new Set();
        } else {
          blastNodeId = node.id;
          selectedNodeId = null;
          const nodeName = node.name;
          const nodeId = node.id;
          fetchImpact(nodeName, nodeId).then((ids) => {
            blastSet = ids;
            render();
          });
        }
      } else {
        // Regular click: toggle selection + show detail panel
        if (selectedNodeId === node.id) {
          selectedNodeId = null;
          hideDetailPanel();
        } else {
          selectedNodeId = node.id;
          blastNodeId = null;
          blastSet = new Set();
          showDetailPanel(node);
        }
      }
    } else {
      // Click on empty canvas: clear selection
      selectedNodeId = null;
      blastNodeId = null;
      blastSet = new Set();
      hideDetailPanel();
    }

    render();
  });

  // Wheel — zoom centered on cursor
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 1.1 : 0.9;
      const newScale = Math.min(5, Math.max(0.2, transform.scale * delta));
      const ratio = newScale / transform.scale;

      // Adjust translate so zoom centers on cursor
      transform.x = e.offsetX - ratio * (e.offsetX - transform.x);
      transform.y = e.offsetY - ratio * (e.offsetY - transform.y);
      transform.scale = newScale;

      render();
    },
    { passive: false },
  );

  // Mouse leave — hide tooltip
  canvas.addEventListener("mouseleave", () => {
    tooltip.style.display = "none";
    if (isDragging) {
      isDragging = false;
      dragNodeId = null;
    }
    isPanning = false;
  });
}

// ---------------------------------------------------------------------------
// Controls (search + protocol filters)
// ---------------------------------------------------------------------------

function showDetailPanel(node) {
  const panel = document.getElementById("detail-panel");
  const content = document.getElementById("detail-content");

  // Find connections for this node
  const outgoing = graphData.edges.filter(
    (e) => e.source_service_id === node.id,
  );
  const incoming = graphData.edges.filter(
    (e) => e.target_service_id === node.id,
  );

  // Find target/source names
  const nameById = {};
  graphData.nodes.forEach((n) => (nameById[n.id] = n.name));

  let html = `<h3>${node.name}</h3>`;

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

  if (outgoing.length > 0) {
    html += `<div class="detail-section">
      <div class="detail-label">Calls (${outgoing.length})</div>`;
    for (const e of outgoing) {
      const target = nameById[e.target_service_id] || "?";
      html += `<div class="connection-item">
        <div><span class="conn-method">${e.method || e.protocol}</span> <span class="conn-path">${e.path || ""}</span></div>
        <div class="conn-direction">→ <span class="conn-target">${target}</span></div>
        ${e.source_file ? `<div class="conn-file">${e.source_file}</div>` : ""}
      </div>`;
    }
    html += `</div>`;
  }

  if (incoming.length > 0) {
    html += `<div class="detail-section">
      <div class="detail-label">Called by (${incoming.length})</div>`;
    for (const e of incoming) {
      const source = nameById[e.source_service_id] || "?";
      html += `<div class="connection-item">
        <div><span class="conn-method">${e.method || e.protocol}</span> <span class="conn-path">${e.path || ""}</span></div>
        <div class="conn-direction">← <span class="conn-target">${source}</span></div>
        ${e.target_file ? `<div class="conn-file">${e.target_file}</div>` : ""}
      </div>`;
    }
    html += `</div>`;
  }

  if (outgoing.length === 0 && incoming.length === 0) {
    html += `<div class="detail-section">
      <div class="detail-value" style="color: #718096">No connections</div>
    </div>`;
  }

  content.innerHTML = html;
  panel.style.display = "block";
}

function hideDetailPanel() {
  document.getElementById("detail-panel").style.display = "none";
}

function setupControls() {
  // Search
  document.getElementById("search").addEventListener("input", (e) => {
    searchFilter = e.target.value.toLowerCase();
    render();
  });

  // Protocol filters
  document.querySelectorAll("[data-protocol]").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) activeProtocols.add(cb.dataset.protocol);
      else activeProtocols.delete(cb.dataset.protocol);
      render();
    });
  });
}

// ---------------------------------------------------------------------------
// Project Picker
// ---------------------------------------------------------------------------

/**
 * Fetch projects from /projects API, enrich with service counts,
 * and show the picker modal. Returns a promise that resolves with
 * the selected project root path.
 */
async function showProjectPicker() {
  const picker = document.getElementById("project-picker");
  const list = document.getElementById("project-list");

  let projects;
  try {
    const resp = await fetch("/projects");
    if (!resp.ok) throw new Error("Failed to fetch projects");
    projects = await resp.json();
  } catch {
    document.getElementById("node-info").textContent = "Cannot reach server.";
    return null;
  }

  if (projects.length === 0) {
    picker.style.display = "block";
    list.innerHTML =
      '<p class="no-projects">No projects found. Run <code>/allclear:map</code> to scan your repos first.</p>';
    document.getElementById("node-info").textContent = "No projects";
    return null;
  }

  // Sort by size descending (most data first)
  projects.sort((a, b) => b.size - a.size);

  // Filter to projects that have data (services > 0)
  const withData = projects.filter((p) => p.serviceCount > 0);

  // If only one project has data, auto-select it via hash
  if (withData.length === 1) {
    picker.style.display = "none";
    // Use hash-based loading — projectRoot may not match the original openDb() CWD
    const newUrl = new URL(window.location);
    newUrl.searchParams.set("hash", withData[0].hash);
    window.history.replaceState({}, "", newUrl);
    // Return null to skip project-based loading — the init() will pick up ?hash= on re-check
    return "__hash__" + withData[0].hash;
  }

  // Use projects with data if any, otherwise show all
  const enriched = withData.length > 0 ? withData : projects;

  // Show picker
  picker.style.display = "block";
  list.innerHTML = "";
  document.getElementById("node-info").textContent = "Select a project to view";

  return new Promise((resolve) => {
    for (const p of enriched) {
      const btn = document.createElement("button");
      btn.className = "project-item";

      const sizeKB = Math.round(p.size / 1024);
      const displayName = p.projectRoot
        ? p.projectRoot.split("/").pop()
        : p.hash;
      const displayPath = p.projectRoot || p.dbPath;
      btn.innerHTML = `
        <div><strong>${displayName}</strong></div>
        <div class="project-path">${displayPath}</div>
        <div class="project-stats">${p.serviceCount} services, ${p.repoCount} repos — ${sizeKB} KB</div>
      `;

      btn.addEventListener("click", () => {
        picker.style.display = "none";
        resolve("__hash__" + p.hash);
      });

      list.appendChild(btn);
    }
  });
}

/**
 * Populate the project selector dropdown in the toolbar.
 * Allows switching between projects without reloading.
 */
async function populateProjectSelect(currentProject) {
  const select = document.getElementById("project-select");
  try {
    const resp = await fetch("/projects");
    if (!resp.ok) return;
    const projects = await resp.json();
    if (projects.length <= 1) return; // no need for dropdown with single project

    select.style.display = "inline-block";
    select.innerHTML = "";

    // Add current project as first option
    const currentOpt = document.createElement("option");
    currentOpt.value = currentProject;
    const currentName = currentProject.split("/").pop();
    currentOpt.textContent = currentName;
    currentOpt.selected = true;
    select.appendChild(currentOpt);

    select.addEventListener("change", () => {
      const newUrl = new URL(window.location);
      newUrl.searchParams.set("project", select.value);
      window.location.href = newUrl.toString();
    });
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

async function init() {
  const canvas = document.getElementById("graph-canvas");
  const container = document.getElementById("canvas-container");

  // Resize canvas to fill container
  function resize() {
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    render();
  }
  window.addEventListener("resize", resize);
  resize();

  // Determine project from URL query param or show project picker
  const urlParams = new URLSearchParams(window.location.search);
  let project = urlParams.get("project");
  let hash = urlParams.get("hash");

  if (!project && !hash) {
    // No project specified — fetch available projects and show picker
    const picked = await showProjectPicker();
    if (!picked) return; // user hasn't selected yet or no projects

    // Check if picker returned a hash-based result
    if (picked.startsWith("__hash__")) {
      hash = picked.slice(8);
    } else {
      project = picked;
    }
  }

  // Update URL without reload so refreshes preserve selection
  if (project && !urlParams.get("project")) {
    const newUrl = new URL(window.location);
    newUrl.searchParams.set("project", project);
    window.history.replaceState({}, "", newUrl);
  }

  const projectParam = project
    ? `?project=${encodeURIComponent(project)}`
    : `?hash=${encodeURIComponent(hash)}`;

  // Load graph data
  let resp;
  try {
    resp = await fetch(`/graph${projectParam}`);
  } catch (err) {
    document.getElementById("node-info").textContent = "Cannot reach server.";
    return;
  }

  if (!resp.ok) {
    document.getElementById("node-info").textContent =
      "No map data yet. Run /allclear:map first.";
    return;
  }

  const raw = await resp.json();

  // Map API response shape to UI expected shape
  // API returns { services, connections, repos }
  // UI expects { nodes: [{id, name, language}], edges: [{source_service_id, target_service_id, protocol}] }
  const serviceNameToId = {};
  graphData.nodes = (raw.services || raw.nodes || []).map((s) => {
    serviceNameToId[s.name] = s.id;
    return {
      id: s.id,
      name: s.name,
      language: s.language,
      type: s.type || "service",
      repo_name: s.repo_name,
    };
  });
  graphData.edges = (raw.connections || raw.edges || []).map((c) => ({
    source_service_id: c.source_service_id ?? serviceNameToId[c.source],
    target_service_id: c.target_service_id ?? serviceNameToId[c.target],
    protocol: c.protocol || "internal",
    method: c.method,
    path: c.path,
  }));

  document.getElementById("node-info").textContent =
    `${graphData.nodes.length} services, ${graphData.edges.length} connections`;

  // Initialize positions to random before simulation settles
  graphData.nodes.forEach((n) => {
    positions[n.id] = {
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
    };
  });

  // Start Web Worker force simulation
  forceWorker = new Worker("./force-worker.js", { type: "module" });
  forceWorker.onmessage = handleWorkerMessage;
  forceWorker.postMessage({
    type: "init",
    nodes: graphData.nodes.map((n) => ({ id: n.id, ...positions[n.id] })),
    links: graphData.edges.map((e) => ({
      source: e.source_service_id,
      target: e.target_service_id,
    })),
    width: canvas.width,
    height: canvas.height,
  });

  setupInteractions(canvas);
  setupControls();

  // Detail panel close button
  document.getElementById("detail-close").addEventListener("click", () => {
    hideDetailPanel();
    selectedNodeId = null;
    render();
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

init().catch((err) => {
  document.getElementById("node-info").textContent = `Error: ${err.message}`;
  console.error(err);
});
