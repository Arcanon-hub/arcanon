/**
 * worker/scan/scan-service.js — Single write pipeline for all four scan transports.
 *
 * Phase 141 (PIPE-01): this module is the ONLY place where the scan write
 * sequence lives:
 *
 *   beginScan → [PIPE-04 re-stamp] → persistFindings →
 *   applyPendingOverridesSync → endScan
 *
 * All four transports (map.md inline-node, rescan.md inline-node, HTTP /scan,
 * manager.js Phase B) call `persistScanResult()`. They are thin adapters that
 * resolve repoId, build `opts`, and pass `queryEngine`.
 *
 * PURE MODULE — no MCP/HTTP/pool imports, no agent-running. Only synchronous
 * SQLite writes via the provided `queryEngine` handle.
 *
 * PIPE-03: the safe logger fallback (`safeSlog`) ensures `applyPendingOverridesSync`
 * never receives undefined as its third argument — eliminating the
 * `TypeError: slog is not a function` in rescan.md (RESEARCH §Q4 bug #2).
 *
 * PIPE-04: `_restampExistingRows` preserves unchanged services by moving ALL
 * existing rows to the new scan_version_id BEFORE `persistFindings` writes the
 * changed subset. `_deleteDeletedFileFindings` runs AFTER the transaction commits
 * to remove services whose defining source file was deleted or renamed.
 *
 * Phase 138 dependency: `queryEngine._db.transaction(fn)` is the synchronous
 * SQLite transaction wrapper from sqlite-adapter.js. All writes (beginScan,
 * re-stamp, persistFindings, overrides, endScan) are atomic inside one
 * transaction; a throw anywhere inside rolls back all of them.
 *
 * Phase 140 dependency: `opts.validateFindings` is an optional callable that
 * throws on invalid findings. It is called BEFORE opening the transaction so
 * invalid findings abort without touching the DB.
 *
 * @module scan-service
 */

import { applyPendingOverridesSync } from './overrides.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Persist one repo's scan findings through the full write pipeline.
 *
 * @param {number}        repoId       - Pre-resolved repo row id (from qe.upsertRepo)
 * @param {string}        repoPath     - Absolute path (used for logging only in this module)
 * @param {object}        findings     - Parsed agent findings { services, connections, ... }
 * @param {string|null}   commit       - Git HEAD at scan time (may be null)
 * @param {object}        [opts={}]    - Options bag
 * @param {string}        [opts.mode]         - 'full' (default) or 'incremental'
 * @param {object}        [opts.changedFiles]  - { modified, deleted, renamed } arrays
 * @param {Function}      [opts.validateFindings] - Optional validator; must throw on invalid
 * @param {string}        [opts.startedAt]    - ISO timestamp; defaults to now
 * @param {object}        queryEngine  - QueryEngine instance (must have _db)
 * @param {Function}      [slog]       - Optional structured logger (default: no-op)
 * @returns {{ scanVersionId: number }}
 */
export function persistScanResult(repoId, repoPath, findings, commit, opts = {}, queryEngine, slog) {
  // PIPE-03: always compute a safe logger — never pass undefined to applyPendingOverridesSync.
  // The rescan.md bug (TypeError: slog is not a function) was caused by callers omitting
  // this arg; the safeSlog fallback eliminates that class of error unconditionally.
  const safeSlog = typeof slog === 'function' ? slog : () => {};

  // Phase 140: optional contract validation.
  // Runs BEFORE opening the transaction so invalid findings abort without any DB write.
  if (typeof opts.validateFindings === 'function') {
    opts.validateFindings(findings); // throws on validation failure
  }

  // Phase 138: wrap the full write sequence in one db.transaction(fn)().
  // Any throw inside fn → SQLite ROLLBACK → scan_versions row, override stamps,
  // and all service/connection rows from this scan are all rolled back atomically.
  const writeTx = queryEngine._db.transaction(() => {
    // Phase 138: beginScan inside the transaction so the scan_versions INSERT
    // is rolled back on failure (ISO-04 fix).
    const startedAt = opts.startedAt ?? new Date().toISOString();
    const scanVersionId = queryEngine.beginScan(repoId, startedAt);

    // PIPE-04: for incremental scans, re-stamp ALL existing rows with the new
    // scan_version_id BEFORE persistFindings writes the changed subset.
    // This prevents endScan's stale-delete from wiping unchanged rows.
    // Full-mode scans skip this — endScan's cleanup handles them correctly.
    if (opts.mode === 'incremental') {
      _restampExistingRows(queryEngine._db, repoId, scanVersionId);
    }

    // Phase 138/139: persistFindings upserts services + connections and runs
    // Phase 139's pre-wipe DELETEs for actor_connections inside the same tx.
    queryEngine.persistFindings(repoId, findings, commit, scanVersionId);

    // PIPE-03: applyPendingOverridesSync fires with safeSlog — no TypeError risk.
    // The exactly-once guarantee: the override stamp lives inside this transaction,
    // so a rollback also rolls back the stamp (override remains pending for retry).
    applyPendingOverridesSync(scanVersionId, queryEngine, safeSlog);

    // Phase 138: endScan stamps completed_at as the LAST step (ISO-04) and runs
    // stale-row cleanup (DELETE WHERE scan_version_id != scanVersionId).
    queryEngine.endScan(repoId, scanVersionId);

    return scanVersionId;
  });

  // Execute the transaction. Throws on failure → ROLLBACK.
  const scanVersionId = writeTx();

  // PIPE-04: after the transaction commits, delete services whose defining
  // source file was deleted or renamed. Runs OUTSIDE the transaction
  // (Pitfall 6 in RESEARCH): if writeTx() threw, execution never reaches here
  // — which is correct, because we should not delete anything on scan failure.
  if (opts.mode === 'incremental' && opts.changedFiles) {
    _deleteDeletedFileFindings(queryEngine._db, repoId, opts.changedFiles, safeSlog);
  }

  return { scanVersionId };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Re-stamp ALL existing services and connections for this repo with the NEW
 * scan_version_id BEFORE persistFindings writes the changed subset. This
 * ensures endScan's stale-delete (`WHERE scan_version_id != newId`) does not
 * wipe unchanged rows whose files were not examined in this incremental scan.
 *
 * Targets the latest COMPLETED scan only (WHERE completed_at IS NOT NULL) to
 * avoid stamping from an in-progress (crashed) scan's scan_version_id
 * (Pitfall 2 in RESEARCH — concurrent-scan guard).
 *
 * @param {object} db            - sqlite-adapter Database instance
 * @param {number} repoId        - Repo row id
 * @param {number} newScanVersionId - The scan_version_id just created by beginScan
 */
function _restampExistingRows(db, repoId, newScanVersionId) {
  // Find the latest completed scan version to re-stamp FROM.
  const prevRow = db.prepare(
    `SELECT id FROM scan_versions
     WHERE repo_id = ? AND completed_at IS NOT NULL
     ORDER BY id DESC LIMIT 1`
  ).get(repoId);

  // No completed prior scan → this is the first scan; nothing to re-stamp.
  if (!prevRow) return;

  const prevSvId = prevRow.id;

  // Re-stamp services: move unchanged rows to the new scan_version_id so
  // endScan's DELETE WHERE scan_version_id != newId spares them.
  db.prepare(
    `UPDATE services SET scan_version_id = ?
     WHERE repo_id = ? AND scan_version_id = ?`
  ).run(newScanVersionId, repoId, prevSvId);

  // Re-stamp connections whose source service was just re-stamped.
  // Connections also carry scan_version_id and are subject to the same stale delete.
  db.prepare(
    `UPDATE connections SET scan_version_id = ?
     WHERE source_service_id IN (SELECT id FROM services WHERE repo_id = ?)
       AND scan_version_id = ?`
  ).run(newScanVersionId, repoId, prevSvId);
}

/**
 * Remove services (and their cascade-dependent rows) whose defining source
 * file was deleted or renamed since the last scan.
 *
 * Called AFTER the write transaction commits (Pitfall 6 in RESEARCH). If the
 * transaction threw, this function is never reached — correct behaviour, since
 * we must not delete anything on scan failure.
 *
 * Uses `source_file = ?` with bound parameters (T-141-01 tamper mitigation).
 * Null-source_file services are never matched — they cannot be attributed to
 * a specific deleted file and are left untouched.
 *
 * @param {object}   db          - sqlite-adapter Database instance
 * @param {number}   repoId      - Repo row id
 * @param {object}   changedFiles - { deleted: string[], renamed: Array<{from,to}> }
 * @param {Function} slog        - Safe logger (never undefined here)
 */
function _deleteDeletedFileFindings(db, repoId, changedFiles, slog) {
  // Collect paths to clean up: explicitly deleted files + renamed-from paths.
  const paths = [
    ...(changedFiles.deleted ?? []),
    ...(changedFiles.renamed ?? []).map(r => r.from),
  ];
  if (paths.length === 0) return;

  for (const p of paths) {
    // Resolve service IDs to delete so we can clean up their FK-referencing
    // connections first. The schema has no ON DELETE CASCADE on
    // connections.source_service_id / connections.target_service_id (mig 001),
    // so we must delete connections explicitly before deleting services to avoid
    // FK constraint failures.
    const svcIds = db.prepare(
      `SELECT id FROM services WHERE repo_id = ? AND source_file = ?`
    ).all(repoId, p).map(r => r.id);

    for (const svcId of svcIds) {
      db.prepare(
        'DELETE FROM connections WHERE source_service_id = ? OR target_service_id = ?'
      ).run(svcId, svcId);
    }

    // Now safe to delete the services themselves.
    const result = db.prepare(
      `DELETE FROM services WHERE repo_id = ? AND source_file = ?`
    ).run(repoId, p);

    if (result.changes > 0) {
      slog('INFO', 'incremental: removed service from deleted/renamed source file', {
        source_file: p,
        changes: result.changes,
      });
    }
  }
}
