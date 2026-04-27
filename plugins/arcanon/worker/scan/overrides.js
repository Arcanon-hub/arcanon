/**
 * worker/scan/overrides.js — Apply pending operator overrides to the current
 * scan_version, between persistFindings and endScan.
 *
 * CORRECT-03: scan pipeline reads scan_overrides BEFORE endScan and applies
 * pending overrides to the persisted findings. Each override is marked
 * applied_in_scan_version_id on apply. Already-applied overrides are skipped
 * on subsequent scans (filtered by getPendingOverrides WHERE clause).
 *
 * Conflict resolution (RESEARCH section 6 D-02): override wins. The apply pass
 * runs AFTER persistFindings has written the agent rows for this scan_version,
 * so any UPDATE/DELETE here overrides what the agent just wrote.
 *
 * Apply granularity (RESEARCH section 6 D-03): per-override. Each override is
 * stamped with applied_in_scan_version_id immediately after its mutation
 * succeeds (markOverrideApplied is called inside the per-override loop, NOT
 * batched at the end). Crash mid-loop preserves partial progress — unstamped
 * rows retry on the next scan.
 *
 * Dangling target handling (RESEARCH section 6 D-04): UPDATE/DELETE that
 * affects 0 rows is logged at WARN and the override IS STILL stamped — the
 * user intent is satisfied (the row is already gone) and leaving it pending
 * would repeat the WARN on every future scan.
 *
 * Threat model: this is the FIRST function in v0.1.4 that writes to the
 * EXISTING `connections` and `services` domain tables (every prior v0.1.4
 * phase wrote only to NEW tables or nullable additive columns). All writes
 * go through the existing FTS5 triggers (mig 001) so the search index stays
 * in sync. No raw user strings are interpolated into SQL — payload values
 * bind via parameter placeholders (`?` positional binding via better-sqlite3
 * prepared statements). The dynamic UPDATE in the connection|update branch
 * builds its SET clause from a fixed allow-list of column names.
 */

const KIND_ACTION_MATRIX = {
  // kind=connection: delete + update only
  'connection|delete':        true,
  'connection|update':        true,
  // kind=service: delete + rename + set-base-path
  'service|delete':           true,
  'service|rename':           true,
  'service|set-base-path':    true,
};

/**
 * Apply all pending operator overrides against the live `connections` /
 * `services` tables, stamping each row with the supplied scanVersionId on
 * success. Pure async function; the only side effects are the SQL writes
 * dispatched via the supplied queryEngine handle plus the slog calls.
 *
 * @param {number} scanVersionId
 * @param {import('../db/query-engine.js').QueryEngine} queryEngine
 * @param {(level: string, msg: string, extra?: object) => void} slog
 * @returns {Promise<{applied: number, skipped: number, errors: number}>}
 */
export async function applyPendingOverrides(scanVersionId, queryEngine, slog) {
  const pending = queryEngine.getPendingOverrides();
  slog('INFO', 'overrides apply BEGIN', { count: pending.length });

  const counters = { applied: 0, skipped: 0, errors: 0 };

  for (const row of pending) {
    const matrixKey = `${row.kind}|${row.action}`;
    if (!KIND_ACTION_MATRIX[matrixKey]) {
      slog('WARN', 'override invalid kind x action — skipping', {
        override_id: row.override_id,
        kind: row.kind,
        action: row.action,
      });
      counters.skipped++;
      continue;
    }

    let payload;
    try {
      payload = JSON.parse(row.payload || '{}');
    } catch (err) {
      slog('WARN', 'override payload not valid JSON — skipping', {
        override_id: row.override_id,
        error: err.message,
      });
      counters.skipped++;
      continue;
    }

    try {
      const rowsAffected = _applyOne(row, payload, queryEngine);
      if (rowsAffected === 0) {
        // D-04: dangling target — log+skip+stamp
        slog('WARN', 'override target missing — skipping', {
          override_id: row.override_id,
          kind: row.kind,
          target_id: row.target_id,
          action: row.action,
        });
      } else {
        slog('INFO', 'override applied', {
          override_id: row.override_id,
          kind: row.kind,
          target_id: row.target_id,
          action: row.action,
        });
      }
      // Stamp regardless of dangling — D-04 (avoids WARN-loop on future scans).
      queryEngine.markOverrideApplied(row.override_id, scanVersionId);
      counters.applied++;
    } catch (err) {
      slog('ERROR', 'override apply failed', {
        override_id: row.override_id,
        kind: row.kind,
        target_id: row.target_id,
        action: row.action,
        error: err.message,
      });
      counters.errors++;
      // Do NOT stamp on apply error — leaves the override pending for retry.
    }
  }

  slog('INFO', 'overrides apply DONE', counters);
  return counters;
}

/**
 * Dispatch a single override's mutation. Returns the rows-affected count
 * from the underlying UPDATE/DELETE (0 means dangling target).
 *
 * Direct SQL via queryEngine._db.prepare(...).run(...) — same pattern as
 * the back-fill block at manager.js:805-807 and the inline writes inside
 * endScan at query-engine.js. FTS5 triggers (mig 001) keep services_fts
 * and connections_fts in sync automatically on UPDATE/DELETE.
 *
 * @param {{kind: string, action: string, target_id: number}} row
 * @param {object} payload
 * @param {import('../db/query-engine.js').QueryEngine} queryEngine
 * @returns {number} changes (0 if dangling target)
 */
function _applyOne(row, payload, queryEngine) {
  const db = queryEngine._db;

  if (row.kind === 'connection' && row.action === 'delete') {
    return db.prepare('DELETE FROM connections WHERE id = ?').run(row.target_id).changes;
  }

  if (row.kind === 'service' && row.action === 'delete') {
    // Cascade: connections referencing this service must go too. The schema
    // has no ON DELETE CASCADE on connections.source_service_id /
    // target_service_id (mig 001 line 41-42), so we delete connections
    // explicitly before the service row to avoid FK violations.
    db.prepare(
      'DELETE FROM connections WHERE source_service_id = ? OR target_service_id = ?'
    ).run(row.target_id, row.target_id);
    return db.prepare('DELETE FROM services WHERE id = ?').run(row.target_id).changes;
  }

  if (row.kind === 'service' && row.action === 'rename') {
    if (typeof payload.new_name !== 'string' || payload.new_name.trim() === '') {
      // Treat as dangling — log+skip path.
      return 0;
    }
    return db.prepare('UPDATE services SET name = ? WHERE id = ?')
      .run(payload.new_name.trim(), row.target_id).changes;
  }

  if (row.kind === 'service' && row.action === 'set-base-path') {
    // Empty string means clear back to NULL.
    const value = (typeof payload.base_path === 'string' && payload.base_path !== '')
      ? payload.base_path
      : null;
    return db.prepare('UPDATE services SET base_path = ? WHERE id = ?')
      .run(value, row.target_id).changes;
  }

  if (row.kind === 'connection' && row.action === 'update') {
    // Build a partial UPDATE from the present payload fields. At least one
    // of source_service_id, target_service_id, evidence MUST be present;
    // otherwise treat as dangling (log+skip+stamp).
    const sets = [];
    const binds = [];
    if (Number.isInteger(payload.source_service_id)) {
      sets.push('source_service_id = ?');
      binds.push(payload.source_service_id);
    }
    if (Number.isInteger(payload.target_service_id)) {
      sets.push('target_service_id = ?');
      binds.push(payload.target_service_id);
    }
    if (typeof payload.evidence === 'string') {
      sets.push('evidence = ?');
      binds.push(payload.evidence);
    }
    if (sets.length === 0) return 0;
    binds.push(row.target_id);
    return db.prepare(`UPDATE connections SET ${sets.join(', ')} WHERE id = ?`)
      .run(...binds).changes;
  }

  // Should never reach here — matrix check above filters unknown combos.
  return 0;
}
