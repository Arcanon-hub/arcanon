---
phase: 30
slug: storage-correctness
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-17
---

# Phase 30 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test |
| **Config file** | none — uses node --test directly |
| **Quick run command** | `node --test tests/storage/migration-007.test.js` |
| **Full suite command** | `node --test tests/storage/migration-007.test.js tests/storage/query-engine-upsert.test.js` |
| **Estimated runtime** | ~3 seconds |

---

## Sampling Rate

- **After every task commit:** Run `node --test tests/storage/migration-007.test.js`
- **After every plan wave:** Run `node --test tests/storage/migration-007.test.js tests/storage/query-engine-upsert.test.js`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 3 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 30-01-01 | 01 | 1 | STORE-01 | unit | `node --test tests/storage/migration-007.test.js` | ❌ W0 | ⬜ pending |
| 30-01-02 | 01 | 1 | STORE-02 | unit | `node --test tests/storage/migration-007.test.js` | ❌ W0 | ⬜ pending |
| 30-02-01 | 02 | 1 | STORE-03 | unit | `node --test tests/storage/query-engine-upsert.test.js` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/storage/migration-007.test.js` — stubs for STORE-01, STORE-02 (kind column exists, malformed rows purged)
- [ ] `tests/storage/query-engine-upsert.test.js` — extend existing with STORE-03 tests (type-conditional exposes parsing)
- [ ] Update `makeQE()` helper to run migrations 006 and 007

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Validate DELETE predicate against real DB | STORE-02 | Requires production-like data | Run `SELECT COUNT(*) FROM exposed_endpoints WHERE method IS NULL AND path NOT LIKE '/%'` before and after migration on a real project DB |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 3s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
