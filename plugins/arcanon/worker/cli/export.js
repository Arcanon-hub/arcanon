#!/usr/bin/env node
/**
 * worker/cli/export.js — Emit the local service graph in Mermaid, DOT, or HTML.
 *
 * Reads services + connections from the local SQLite DB for a given repo (or
 * all repos) and writes one or more export formats. Useful for:
 *   - Pasting a Mermaid block into docs/PRs
 *   - Rendering DOT with graphviz for print
 *   - Opening the self-contained HTML viewer (cytoscape.js) offline
 *
 * Usage:
 *   node worker/cli/export.js [--repo <path>] [--format mermaid|dot|html|all]
 *                             [--out <path>]
 *
 * Default: format=all, out=./.arcanon/reports/<timestamp>/
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveDataDir } from "../lib/data-dir.js";
import { getQueryEngine } from "../db/pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const val = argv[i + 1];
      if (val && !val.startsWith("--")) {
        flags[key] = val;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

function loadGraph(repoPath) {
  const qe = getQueryEngine(repoPath);
  if (!qe) throw new Error(`no local scan for ${repoPath} — run /arcanon:map first`);
  const db = qe._db;
  const services = db
    .prepare(
      "SELECT id, name, root_path, language, type, boundary_entry FROM services",
    )
    .all();
  const connections = db
    .prepare(
      `SELECT s.name AS source, c.target_name AS target, c.protocol, c.method, c.path, c.crossing
         FROM connections c
         LEFT JOIN services s ON s.id = c.source_service_id`,
    )
    .all();
  return { services, connections };
}

function sanitizeId(s) {
  return String(s || "")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/^(\d)/, "_$1");
}

export function toMermaid({ services, connections }) {
  const lines = ["```mermaid", "graph LR"];
  const seen = new Set();
  for (const svc of services) {
    const id = sanitizeId(svc.name);
    seen.add(svc.name);
    const label = `${svc.name}${svc.language ? `\\n(${svc.language})` : ""}`;
    const shape = svc.type === "library" ? `[${label}]` : svc.type === "infra" ? `(${label})` : `[[${label}]]`;
    lines.push(`  ${id}${shape}`);
  }
  for (const conn of connections) {
    if (!conn.source || !conn.target) continue;
    if (!seen.has(conn.target)) {
      lines.push(`  ${sanitizeId(conn.target)}[(${conn.target})]:::external`);
    }
    const label = [conn.protocol, conn.method, conn.path].filter(Boolean).join(" ");
    lines.push(
      `  ${sanitizeId(conn.source)} -->${label ? `|${label}|` : ""} ${sanitizeId(conn.target)}`,
    );
  }
  lines.push("  classDef external fill:#eef,stroke:#aab;");
  lines.push("```");
  return lines.join("\n");
}

export function toDot({ services, connections }) {
  const lines = [
    "digraph arcanon {",
    "  rankdir=LR;",
    '  node [shape=box, style="rounded,filled", fillcolor="#f7f7fb"];',
    '  edge [color="#555", fontsize=10];',
  ];
  const seen = new Set();
  for (const svc of services) {
    seen.add(svc.name);
    const label = `${svc.name}\\n(${svc.language || "unknown"})`;
    lines.push(`  "${svc.name}" [label="${label}"];`);
  }
  for (const conn of connections) {
    if (!conn.source || !conn.target) continue;
    if (!seen.has(conn.target)) {
      lines.push(
        `  "${conn.target}" [fillcolor="#eef0f7", style="rounded,dashed,filled"];`,
      );
    }
    const label = [conn.protocol, conn.method, conn.path].filter(Boolean).join(" ");
    lines.push(
      `  "${conn.source}" -> "${conn.target}" [label="${label.replace(/"/g, "\\\"")}"];`,
    );
  }
  lines.push("}");
  return lines.join("\n");
}

export function toHtml({ services, connections }, { title = "Arcanon graph" } = {}) {
  const nodes = [];
  const seen = new Set();
  for (const svc of services) {
    seen.add(svc.name);
    nodes.push({
      data: {
        id: svc.name,
        label: `${svc.name}\n(${svc.language || "unknown"})`,
        type: svc.type || "service",
        external: false,
      },
    });
  }
  const edges = [];
  for (const conn of connections) {
    if (!conn.source || !conn.target) continue;
    if (!seen.has(conn.target)) {
      seen.add(conn.target);
      nodes.push({
        data: { id: conn.target, label: conn.target, type: "external", external: true },
      });
    }
    edges.push({
      data: {
        id: `${conn.source}->${conn.target}:${conn.protocol || ""}:${conn.method || ""}:${conn.path || ""}`,
        source: conn.source,
        target: conn.target,
        label: [conn.protocol, conn.method, conn.path].filter(Boolean).join(" "),
      },
    });
  }
  const elements = JSON.stringify([...nodes, ...edges]);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>
  :root { color-scheme: light dark; }
  html, body { margin:0; padding:0; height:100%; font-family: system-ui, -apple-system, Segoe UI, sans-serif; }
  #bar { padding: 8px 12px; border-bottom: 1px solid rgba(0,0,0,0.1); display:flex; justify-content:space-between; align-items:center; gap:12px; }
  #bar h1 { margin:0; font-size: 14px; font-weight: 600; }
  #bar .meta { font-size: 12px; opacity: 0.7; }
  #cy { height: calc(100vh - 42px); width: 100vw; background: radial-gradient(at top left, rgba(60,80,180,.08), transparent 50%); }
  .hint { position: fixed; bottom: 10px; right: 12px; font-size: 11px; padding: 6px 10px; border-radius: 6px; background: rgba(0,0,0,0.05); }
  @media (prefers-color-scheme: dark) { body { background: #0b0d12; color: #e6e8ef; } .hint { background: rgba(255,255,255,0.06);} }
</style>
</head>
<body>
  <div id="bar">
    <h1>${title}</h1>
    <div class="meta">${services.length} services · ${connections.length} connections</div>
  </div>
  <div id="cy"></div>
  <div class="hint">drag to pan · scroll to zoom · click a node to highlight</div>
  <script src="https://unpkg.com/cytoscape@3.30.0/dist/cytoscape.min.js"></script>
  <script src="https://unpkg.com/layout-base@2.0.1/layout-base.js"></script>
  <script src="https://unpkg.com/cose-base@2.2.0/cose-base.js"></script>
  <script src="https://unpkg.com/cytoscape-fcose@2.2.0/cytoscape-fcose.js"></script>
  <script>
    const elements = ${elements};
    const cy = cytoscape({
      container: document.getElementById('cy'),
      elements,
      style: [
        { selector: 'node', style: {
            'background-color': '#6466f1',
            'label': 'data(label)',
            'color': '#111',
            'font-size': 10,
            'text-wrap': 'wrap',
            'text-valign': 'center',
            'text-halign': 'center',
            'width': 70, 'height': 40, 'shape': 'round-rectangle',
            'border-color': '#444', 'border-width': 1,
          } },
        { selector: 'node[external]', style: {
            'background-color': '#e0e3f5', 'color': '#222',
            'border-style': 'dashed', 'border-color': '#8a91c4',
          } },
        { selector: 'node[type="library"]', style: { 'shape': 'round-octagon', 'background-color': '#9c7bf4' } },
        { selector: 'node[type="infra"]', style: { 'shape': 'ellipse', 'background-color': '#5d93c9' } },
        { selector: 'edge', style: {
            'curve-style': 'bezier', 'target-arrow-shape': 'triangle',
            'line-color': '#8c8c8c', 'target-arrow-color': '#8c8c8c',
            'label': 'data(label)', 'font-size': 8, 'text-background-color': '#fff',
            'text-background-opacity': 0.8, 'text-background-padding': 2,
            'width': 1.5,
          } },
        { selector: '.faded', style: { 'opacity': 0.15 } },
        { selector: '.highlight', style: { 'border-color': '#111', 'border-width': 3 } },
      ],
      layout: { name: typeof fcose === 'function' ? 'fcose' : 'cose', animate: false, quality: 'proof' },
    });
    cy.on('tap', 'node', (evt) => {
      const node = evt.target;
      cy.elements().addClass('faded').removeClass('highlight');
      node.closedNeighborhood().removeClass('faded');
      node.addClass('highlight');
    });
    cy.on('tap', (evt) => { if (evt.target === cy) cy.elements().removeClass('faded highlight'); });
  </script>
</body>
</html>`;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const repoPath = path.resolve(flags.repo || process.cwd());
  const format = flags.format || "all";
  const outDir = path.resolve(
    flags.out || path.join(".arcanon", "reports", new Date().toISOString().replace(/[:.]/g, "-")),
  );

  const graph = loadGraph(repoPath);

  fs.mkdirSync(outDir, { recursive: true });
  const written = [];

  if (format === "mermaid" || format === "all") {
    const file = path.join(outDir, "graph.mmd");
    fs.writeFileSync(file, toMermaid(graph));
    written.push(file);
  }
  if (format === "dot" || format === "all") {
    const file = path.join(outDir, "graph.dot");
    fs.writeFileSync(file, toDot(graph));
    written.push(file);
  }
  if (format === "html" || format === "all") {
    const file = path.join(outDir, "graph.html");
    fs.writeFileSync(
      file,
      toHtml(graph, { title: `Arcanon — ${path.basename(repoPath)}` }),
    );
    written.push(file);
  }
  if (format === "json" || format === "all") {
    const file = path.join(outDir, "graph.json");
    fs.writeFileSync(file, JSON.stringify(graph, null, 2));
    written.push(file);
  }

  process.stdout.write(
    `✓ exported ${graph.services.length} services · ${graph.connections.length} connections to:\n` +
      written.map((f) => `  ${f}`).join("\n") +
      "\n",
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(1);
  });
}
