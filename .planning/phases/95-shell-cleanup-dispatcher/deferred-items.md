
## WRKR-07 pre-existing failure (logged from 95-02)
- **File:** tests/worker-lifecycle.bats, line 161
- **Issue:** Migration log line `▶ migration 010 — service_dependencies` appears before JSON log lines, causing JSON-validity check to fail
- **Confirmed:** pre-existing before 95-02 (verified by git stash test)
- **Action needed:** Either suppress migration output during test or update test to skip non-JSON lines
