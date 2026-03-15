import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { z } from 'zod';

const dbPath = process.env.ALLCLEAR_DB_PATH
  || path.join(process.cwd(), '.allclear', 'impact-map.db');

/**
 * Open the SQLite database in read-only mode.
 * Returns null if the file does not exist or if any error occurs.
 */
export function openDb() {
  if (!fs.existsSync(dbPath)) {
    return null;
  }
  try {
    const db = new Database(dbPath, { readonly: true });
    db.pragma('journal_mode = WAL');
    return db;
  } catch (err) {
    console.error('[allclear-mcp] Failed to open database:', err.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Pure query functions (exported for testing)
// ─────────────────────────────────────────────────────────────

/**
 * Query impact for a given service.
 * @param {Database|null} db
 * @param {{ service: string, endpoint?: string, direction?: string, transitive?: boolean }} params
 * @returns {{ results: Array }}
 */
export async function queryImpact(db, { service, endpoint, direction = 'consumes', transitive = false }) {
  if (!db) return { results: [] };

  const svcRow = db.prepare('SELECT id FROM services WHERE name = ?').get(service);
  if (!svcRow) return { results: [] };
  const serviceId = svcRow.id;

  if (transitive) {
    // Recursive CTE for full transitive impact
    const cte = `
      WITH RECURSIVE impacted(id, depth, path) AS (
        SELECT ${direction === 'consumes' ? 'target_service_id' : 'source_service_id'}, 1,
               CAST(? AS TEXT) || ',' || CAST(${direction === 'consumes' ? 'target_service_id' : 'source_service_id'} AS TEXT)
        FROM connections WHERE ${direction === 'consumes' ? 'source_service_id' : 'target_service_id'} = ?
        UNION ALL
        SELECT ${direction === 'consumes' ? 'c.target_service_id' : 'c.source_service_id'}, i.depth + 1,
               i.path || ',' || CAST(${direction === 'consumes' ? 'c.target_service_id' : 'c.source_service_id'} AS TEXT)
        FROM connections c JOIN impacted i ON ${direction === 'consumes' ? 'c.source_service_id' : 'c.target_service_id'} = i.id
        WHERE i.path NOT LIKE '%,' || CAST(${direction === 'consumes' ? 'c.target_service_id' : 'c.source_service_id'} AS TEXT) || ',%'
          AND i.depth < 10
      )
      SELECT DISTINCT i.id, i.depth, s.name as service, c.protocol, c.method, c.path as path
      FROM impacted i
      JOIN services s ON s.id = i.id
      JOIN connections c ON (
        ${direction === 'consumes'
          ? 'c.source_service_id = i.id OR c.target_service_id = i.id'
          : 'c.source_service_id = i.id OR c.target_service_id = i.id'}
      )
      ORDER BY i.depth, s.name
    `;
    const rows = db.prepare(cte).all(serviceId, serviceId);
    const results = rows.map(r => ({
      service: r.service,
      protocol: r.protocol,
      method: r.method,
      path: r.path,
      depth: r.depth,
    }));
    return { results };
  }

  // Direct (non-transitive) query
  let query;
  if (direction === 'consumes') {
    query = `
      SELECT s.name as service, c.protocol, c.method, c.path as path, 1 as depth
      FROM connections c
      JOIN services s ON s.id = c.target_service_id
      WHERE c.source_service_id = ?
    `;
  } else {
    query = `
      SELECT s.name as service, c.protocol, c.method, c.path as path, 1 as depth
      FROM connections c
      JOIN services s ON s.id = c.source_service_id
      WHERE c.target_service_id = ?
    `;
  }

  if (endpoint) {
    query += ' AND c.path LIKE ?';
    const rows = db.prepare(query).all(serviceId, `%${endpoint}%`);
    return { results: rows };
  }

  const rows = db.prepare(query).all(serviceId);
  return { results: rows };
}

/**
 * Query which services are affected by changed files.
 * @param {Database|null} db
 * @param {{ repo?: string, commit_range?: string, _changedFiles?: string[] }} params
 * @returns {{ affected: Array, changed_files: string[], error?: string }}
 */
export async function queryChanged(db, { repo, commit_range, _changedFiles } = {}) {
  // Allow tests to inject changed files directly (bypasses git)
  let changedFiles = _changedFiles;
  let gitError = null;

  if (!changedFiles) {
    const cwd = repo || process.cwd();
    try {
      if (commit_range) {
        const out = execSync(`git diff --name-only ${commit_range}`, { cwd, encoding: 'utf8' });
        changedFiles = out.trim().split('\n').filter(Boolean);
      } else {
        const unstaged = execSync('git diff --name-only HEAD', { cwd, encoding: 'utf8' });
        const staged = execSync('git diff --name-only --cached', { cwd, encoding: 'utf8' });
        changedFiles = [
          ...new Set([
            ...unstaged.trim().split('\n').filter(Boolean),
            ...staged.trim().split('\n').filter(Boolean),
          ]),
        ];
      }
    } catch (err) {
      gitError = 'not a git repo';
      changedFiles = [];
    }
  }

  if (!db) {
    const result = { affected: [], changed_files: changedFiles };
    if (gitError) result.error = gitError;
    return result;
  }

  if (changedFiles.length === 0) {
    const result = { affected: [], changed_files: [] };
    if (gitError) result.error = gitError;
    return result;
  }

  const affectedMap = new Map();
  const stmt = db.prepare(`
    SELECT DISTINCT s.name, COUNT(c.id) as connection_count
    FROM services s
    JOIN connections c ON (c.source_service_id = s.id OR c.target_service_id = s.id)
    WHERE c.source_file LIKE ? OR c.target_file LIKE ?
    GROUP BY s.name
  `);

  for (const file of changedFiles) {
    const pattern = `%${file}%`;
    const rows = stmt.all(pattern, pattern);
    for (const row of rows) {
      if (!affectedMap.has(row.name)) {
        affectedMap.set(row.name, row.connection_count);
      }
    }
  }

  const affected = Array.from(affectedMap.entries()).map(([service, connection_count]) => ({
    service,
    connection_count,
  }));

  const result = { affected, changed_files: changedFiles };
  if (gitError) result.error = gitError;
  return result;
}

/**
 * Return the dependency subgraph for a service.
 * @param {Database|null} db
 * @param {{ service: string, depth?: number, direction?: string }} params
 * @returns {{ nodes: Array, edges: Array }}
 */
export async function queryGraph(db, { service, depth = 2, direction = 'both' }) {
  if (!db) return { nodes: [], edges: [] };

  const svcRow = db.prepare('SELECT id, name, language FROM services WHERE name = ?').get(service);
  if (!svcRow) return { nodes: [], edges: [] };
  const serviceId = svcRow.id;
  const maxDepth = Math.min(depth, 5);

  const nodeMap = new Map();
  const edgeSet = new Set();
  const edges = [];

  nodeMap.set(svcRow.id, { id: svcRow.id, name: svcRow.name, language: svcRow.language });

  // Traverse downstream (this service → targets)
  if (direction === 'downstream' || direction === 'both') {
    const cte = `
      WITH RECURSIVE traversal(id, depth) AS (
        SELECT target_service_id, 1 FROM connections WHERE source_service_id = ?
        UNION ALL
        SELECT c.target_service_id, t.depth + 1
        FROM connections c JOIN traversal t ON c.source_service_id = t.id
        WHERE t.depth < ?
      )
      SELECT DISTINCT id FROM traversal
    `;
    const reachable = db.prepare(cte).all(serviceId, maxDepth);
    for (const { id } of reachable) {
      if (!nodeMap.has(id)) {
        const s = db.prepare('SELECT id, name, language FROM services WHERE id = ?').get(id);
        if (s) nodeMap.set(id, { id: s.id, name: s.name, language: s.language });
      }
    }

    // Collect edges among reachable nodes
    const reachableIds = [serviceId, ...reachable.map(r => r.id)];
    const connStmt = db.prepare(`
      SELECT c.id, s1.name as source, s2.name as target, c.protocol, c.method, c.path
      FROM connections c
      JOIN services s1 ON c.source_service_id = s1.id
      JOIN services s2 ON c.target_service_id = s2.id
      WHERE c.source_service_id IN (${reachableIds.map(() => '?').join(',')})
        AND c.target_service_id IN (${reachableIds.map(() => '?').join(',')})
    `);
    const conns = connStmt.all(...reachableIds, ...reachableIds);
    for (const conn of conns) {
      const key = `${conn.source}→${conn.target}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push({ source: conn.source, target: conn.target, protocol: conn.protocol, method: conn.method, path: conn.path });
      }
    }
  }

  // Traverse upstream (sources → this service)
  if (direction === 'upstream' || direction === 'both') {
    const cte = `
      WITH RECURSIVE traversal(id, depth) AS (
        SELECT source_service_id, 1 FROM connections WHERE target_service_id = ?
        UNION ALL
        SELECT c.source_service_id, t.depth + 1
        FROM connections c JOIN traversal t ON c.target_service_id = t.id
        WHERE t.depth < ?
      )
      SELECT DISTINCT id FROM traversal
    `;
    const reachable = db.prepare(cte).all(serviceId, maxDepth);
    for (const { id } of reachable) {
      if (!nodeMap.has(id)) {
        const s = db.prepare('SELECT id, name, language FROM services WHERE id = ?').get(id);
        if (s) nodeMap.set(id, { id: s.id, name: s.name, language: s.language });
      }
    }

    // Collect upstream edges
    const reachableIds = [serviceId, ...reachable.map(r => r.id)];
    const connStmt = db.prepare(`
      SELECT c.id, s1.name as source, s2.name as target, c.protocol, c.method, c.path
      FROM connections c
      JOIN services s1 ON c.source_service_id = s1.id
      JOIN services s2 ON c.target_service_id = s2.id
      WHERE c.source_service_id IN (${reachableIds.map(() => '?').join(',')})
        AND c.target_service_id IN (${reachableIds.map(() => '?').join(',')})
    `);
    const conns = connStmt.all(...reachableIds, ...reachableIds);
    for (const conn of conns) {
      const key = `${conn.source}→${conn.target}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push({ source: conn.source, target: conn.target, protocol: conn.protocol, method: conn.method, path: conn.path });
      }
    }
  }

  // Remove the root service node from result nodes list (return only connected nodes)
  // Actually include all nodes including root for full subgraph
  const nodes = Array.from(nodeMap.values()).filter(n => n.id !== serviceId);

  return { nodes, edges };
}

// ─────────────────────────────────────────────────────────────
// MCP Server setup
// ─────────────────────────────────────────────────────────────

const server = new McpServer({ name: 'allclear-impact', version: '2.0.0' });

// ── impact_query ─────────────────────────────────────────────
server.tool(
  'impact_query',
  'Query which services consume or are consumed by a given service. Returns direct or transitive dependency relationships.',
  {
    service: z.string().describe('Name of the service to query'),
    endpoint: z.string().optional().describe('Filter by specific endpoint path'),
    direction: z.enum(['consumes', 'exposes']).default('consumes')
      .describe('consumes = services this service calls; exposes = services that call this service'),
    transitive: z.boolean().default(false)
      .describe('When true, follows dependency chains transitively (up to depth 10)'),
  },
  async (params) => {
    const db = openDb();
    const result = await queryImpact(db, params);
    if (db) db.close();
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
);

// ── impact_changed ───────────────────────────────────────────
server.tool(
  'impact_changed',
  'Identify which services are affected by currently changed files in the git working tree.',
  {
    repo: z.string().optional().describe('Absolute path to the git repo (defaults to cwd)'),
    commit_range: z.string().optional().describe('Git commit range e.g. "HEAD~3..HEAD" — if omitted, uses working tree diff'),
  },
  async (params) => {
    const db = openDb();
    const result = await queryChanged(db, params);
    if (db) db.close();
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
);

// ── impact_graph ─────────────────────────────────────────────
server.tool(
  'impact_graph',
  'Return the dependency subgraph (nodes + edges) for a service up to a given depth.',
  {
    service: z.string().describe('Name of the service to centre the graph on'),
    depth: z.number().int().min(1).max(5).default(2)
      .describe('How many hops to traverse (max 5)'),
    direction: z.enum(['upstream', 'downstream', 'both']).default('both')
      .describe('Which direction to traverse: upstream = callers, downstream = callees, both = full neighbourhood'),
  },
  async (params) => {
    const db = openDb();
    const result = await queryGraph(db, params);
    if (db) db.close();
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
);

// Tools for impact_search and impact_scan will be added in Task 2.

const transport = new StdioServerTransport();
await server.connect(transport);

process.on('SIGTERM', () => process.exit(0));
