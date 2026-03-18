---
phase: 32
slug: ui-detail-panels
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-17
---

# Phase 32 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test |
| **Config file** | none — uses node --test directly |
| **Quick run command** | `node --test tests/ui/utils.test.js tests/ui/detail-panel.test.js` |
| **Full suite command** | `node --test tests/ui/utils.test.js tests/ui/detail-panel.test.js tests/ui/interactions.test.js` |
| **Estimated runtime** | ~2 seconds |

---

## Sampling Rate

- **After every task commit:** Run quick command
- **After every plan wave:** Run full suite
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 2 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 32-01-01 | 01 | 1 | PANEL-01 | source-analysis | `node --test tests/ui/utils.test.js` | ❌ W0 | ⬜ pending |
| 32-02-01 | 02 | 2 | PANEL-02, PANEL-03, PANEL-04 | source-analysis | `node --test tests/ui/detail-panel.test.js` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/ui/utils.test.js` — stubs for PANEL-01 (getNodeType infra guard)
- [ ] `tests/ui/detail-panel.test.js` — stubs for PANEL-02, PANEL-03, PANEL-04 (three-way routing, library panel, infra panel)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Library panel renders exports grouped by functions vs types | PANEL-03 | Requires browser rendering | Click a library node in the graph UI, verify "Exports" section shows grouped items |
| Infra panel renders resources grouped by prefix | PANEL-04 | Requires browser rendering | Click an infra node in the graph UI, verify "Manages" section shows grouped resources |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 2s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
