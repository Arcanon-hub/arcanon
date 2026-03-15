# Phase 10: Drift Skill - Research

**Researched:** 2026-03-15
**Domain:** Cross-repo consistency checking — version alignment, type definition drift, OpenAPI spec comparison
**Confidence:** HIGH

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DRFT-01 | `/allclear drift` skill checks version alignment of shared dependencies across sibling repos | Version extraction patterns for all 4 manifest formats; comparison logic in pure bash |
| DRFT-02 | Skill checks type definition consistency for shared models across repos | Structural diff via grep/diff on shared type files; heuristic matching on interface/type names |
| DRFT-03 | Skill checks OpenAPI spec consistency for shared endpoints | oasdiff CLI for spec diff; graceful fallback to yq-based structural comparison when oasdiff absent |
| DRFT-04 | Skill supports subcommands: versions, types, openapi | SKILL.md argument routing via `$ALLCLEAR_ARGS` pattern (same as impact skill) |
| DRFT-05 | Skill reports drift with specific divergences and which repos are affected | Output grouping by repo; show which value each repo holds; not just "differ" but "repo A has X, repo B has Y" |
| DRFT-06 | Skill output uses severity levels and defaults to actionable differences only (not wall of text) | Severity: CRITICAL (breaking), WARN (likely issue), INFO (informational); default = CRITICAL+WARN only; --all flag for INFO |
</phase_requirements>

## Summary

Phase 10 implements the `/allclear drift` skill — a SKILL.md prompt playbook that guides Claude through comparing sibling repos for three categories of consistency problems: shared dependency version alignment, shared type/model definition consistency, and OpenAPI specification endpoint matching.

The skill uses `lib/siblings.sh` (built in Phase 2) for repo discovery and routes through three subcommands: `versions`, `types`, and `openapi`. The skill's primary design constraint (DRFT-06) is that output must be actionable by default — users see CRITICAL and WARN severity findings only unless they pass `--all`. This prevents the skill from generating a wall of text when dozens of minor differences exist.

The core implementation challenge is multi-format version extraction: package.json (JSON via jq), Cargo.toml (TOML via yq or grep), pyproject.toml (TOML), and go.mod (plaintext grep). All four parsers must be written in portable bash with graceful fallback when optional tools (yq) are absent. For OpenAPI comparison, the skill delegates to `oasdiff` when present and falls back to `yq`-based structural field comparison. For type checking, the skill uses structural grep patterns since no universal cross-language type comparison tool exists.

**Primary recommendation:** Implement `versions` as the always-reliable baseline (pure bash + jq, no optional tools), `openapi` as optional-tool-enhanced (oasdiff when available), and `types` as best-effort heuristic (grep-based interface/struct name matching). Severity levels follow CRITICAL > WARN > INFO; default output shows only CRITICAL+WARN.

---

## Standard Stack

### Core
| Library/Tool | Version | Purpose | Why Standard |
|-------------|---------|---------|--------------|
| `lib/siblings.sh` | (project) | Sibling repo discovery | Already built Phase 2; shared foundation for all cross-repo skills |
| `jq` | ≥1.6 | Parse package.json, extract versions from JSON | Required by PLGN-07 project-wide; already the standard |
| `yq` (mikefarah) | ≥4.x | Parse TOML (Cargo.toml, pyproject.toml) and YAML | Single binary, no deps; handles JSON+YAML+TOML with consistent syntax |
| `grep` / `sed` / `awk` | POSIX | go.mod parsing; fallback TOML parsing | Universal; always available; no install required |
| `diff` | POSIX | Line-by-line comparison of extracted type definitions | Universal; always available |

### Supporting (Optional, Gracefully Skipped)
| Library/Tool | Version | Purpose | When to Use |
|-------------|---------|---------|-------------|
| `oasdiff` | ≥1.x | Structured OpenAPI spec diff with breaking change detection | When installed; 300+ rule categories; best-in-class for OpenAPI comparison |
| `yq` (kislyuk Python) | ≥4.x | Alternative TOML parser via `tomlq` | Fallback when mikefarah yq absent; same output format |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| yq for TOML | toml-cli (Rust crate) | toml-cli is less commonly installed; yq is already useful for YAML too — one tool serves both needs |
| oasdiff | openapi-diff (OpenAPITools) | openapi-diff requires Java; oasdiff is a Go binary — single-file install matches AllClear's zero-external-deps philosophy |
| grep-based type detection | tsc --declaration + diff | tsc approach is TypeScript-only; grep approach is language-agnostic and works on Go structs, Python dataclasses, Rust structs |

**Installation (oasdiff, optional):**
```bash
# macOS
brew install oasdiff/tap/oasdiff
# Linux (single binary)
curl -fsSL https://raw.githubusercontent.com/oasdiff/oasdiff/main/install.sh | sh
```

---

## Architecture Patterns

### Recommended Skill Structure
```
skills/drift/
├── SKILL.md              # Prompt playbook: detect siblings, route subcommand, run analysis, report
└── scripts/
    ├── drift-versions.sh # Extract and compare shared dependency versions across repos
    ├── drift-types.sh    # Find and compare shared type/interface definitions across repos
    └── drift-openapi.sh  # Locate and compare OpenAPI specs across repos
```

### Pattern 1: SKILL.md Subcommand Routing
**What:** SKILL.md uses `$ALLCLEAR_ARGS` (or argument injection) to detect which subcommand was invoked and route accordingly. Same pattern as the cross-impact skill (Phase 9).
**When to use:** All skills with subcommands (`drift versions`, `drift types`, `drift openapi`).

```yaml
---
name: drift
description: Check cross-repo consistency: version alignment, type definitions, OpenAPI specs. Use when the user invokes /allclear drift or asks about dependency drift.
disable-model-invocation: true
allowed-tools: Bash
argument-hint: "[versions|types|openapi|--all]"
---

Check cross-repo drift for sibling repositories.

Sibling repos: !`source "${CLAUDE_PLUGIN_ROOT}/lib/siblings.sh" && list_siblings`

## Steps
1. Determine subcommand from arguments (default: run all three checks)
2. For `versions` (or no subcommand): run drift-versions.sh
3. For `types` (or no subcommand): run drift-types.sh
4. For `openapi` (or no subcommand): run drift-openapi.sh
5. Report findings grouped by severity: CRITICAL first, then WARN, suppress INFO unless --all passed
6. For each finding: state which repos are affected and what the specific difference is
```

### Pattern 2: Version Extraction per Manifest Format

**What:** Each manifest format requires a different extraction strategy. All strategies produce the same normalized output: `PACKAGE_NAME=VERSION`.

**package.json (jq — HIGH confidence, always available):**
```bash
# Source: jq docs + project PLGN-07 requirement
# Extract all dependencies and devDependencies as NAME=VERSION lines
jq -r '
  (.dependencies // {}) + (.devDependencies // {}) |
  to_entries[] |
  "\(.key)=\(.value)"
' package.json 2>/dev/null
```

**Cargo.toml (yq — MEDIUM confidence, graceful skip if absent):**
```bash
# Source: mikefarah/yq TOML docs
if command -v yq &>/dev/null; then
  yq -oy '.dependencies | to_entries[] | .key + "=" + .value' Cargo.toml 2>/dev/null
else
  # Fallback: grep-based extraction (works for simple "dep = \"1.2.3\"" and "dep = { version = \"1.2.3\" }")
  grep -E '^\s*\w+ *= *"[0-9]' Cargo.toml | sed 's/\s//g; s/ = /=/g; s/"//g'
fi
```

**pyproject.toml (yq or grep — MEDIUM confidence):**
```bash
# Source: PEP 508 dependency string format; yq TOML support
if command -v yq &>/dev/null; then
  yq -oy '.project.dependencies[]' pyproject.toml 2>/dev/null
  yq -oy '.tool.poetry.dependencies | to_entries[] | .key + "==" + .value' pyproject.toml 2>/dev/null
else
  # Fallback: grep PEP 508 lines from [project.dependencies] section
  awk '/\[project\.dependencies\]/{found=1} found && /^\s*"/{print}' pyproject.toml
fi
```

**go.mod (grep/awk — HIGH confidence, pure POSIX):**
```bash
# Source: go.mod format spec (plain text, well-structured)
# Format: "require MODULE VERSION" or block format
awk '/^require \(/{in_block=1; next} /^\)/{in_block=0; next} in_block{print $1"="$2} /^require [^(]/{print $2"="$3}' go.mod 2>/dev/null
```

### Pattern 3: Cross-Repo Version Comparison
**What:** Collect all extracted versions per repo into an associative array keyed by package name, then find packages that appear in 2+ repos with different versions.
**When to use:** `drift versions` subcommand.

```bash
# Source: bash associative array pattern
declare -A pkg_versions  # pkg_versions["REPO:PKG"]="VERSION"
declare -A pkg_repos     # pkg_repos["PKG"]="repo1 repo2 ..."

for REPO in $SIBLINGS; do
  while IFS='=' read -r pkg ver; do
    [[ -z "$pkg" || -z "$ver" ]] && continue
    pkg_versions["${REPO}:${pkg}"]="$ver"
    pkg_repos["$pkg"]="${pkg_repos[$pkg]:-} $REPO"
  done < <(extract_versions "$REPO")
done

# Report drift: packages where not all versions match
for pkg in "${!pkg_repos[@]}"; do
  repos="${pkg_repos[$pkg]}"
  versions=""
  for repo in $repos; do
    v="${pkg_versions["${repo}:${pkg}"]:-}"
    versions="$versions $v"
  done
  # If not all versions identical → drift detected
  unique_versions=$(echo "$versions" | tr ' ' '\n' | sort -u | grep -v '^$')
  count=$(echo "$unique_versions" | wc -l)
  if [[ "$count" -gt 1 ]]; then
    emit_finding "CRITICAL" "$pkg" "$repos" "$unique_versions"
  fi
done
```

### Pattern 4: Severity Level Output
**What:** All findings carry one of three severity levels. Default output suppresses INFO. The `--all` flag reveals INFO findings.
**When to use:** All three subcommands (versions, types, openapi).

```bash
# Severity constants
SEVERITY_CRITICAL="CRITICAL"  # Version mismatch in prod dependency, breaking API change
SEVERITY_WARN="WARN"           # Likely issue: dev dep mismatch, minor field difference
SEVERITY_INFO="INFO"           # Informational: new field added (non-breaking), minor version ahead

# Output filter (set by argument parsing)
SHOW_INFO=false
[[ "$*" == *"--all"* ]] && SHOW_INFO=true

emit_finding() {
  local level="$1" pkg="$2" repos="$3" details="$4"
  case "$level" in
    CRITICAL) echo "[CRITICAL] $pkg — $details (repos: $repos)" ;;
    WARN)     echo "[ WARN  ] $pkg — $details (repos: $repos)" ;;
    INFO)     $SHOW_INFO && echo "[ INFO  ] $pkg — $details (repos: $repos)" || return 0 ;;
  esac
}
```

### Pattern 5: OpenAPI Spec Discovery
**What:** Locate OpenAPI spec files in a repo by probing common file paths before attempting comparison.
**When to use:** `drift openapi` subcommand.

```bash
# Common OpenAPI spec file locations (ordered by convention frequency)
OPENAPI_CANDIDATES=(
  "openapi.yaml" "openapi.yml" "openapi.json"
  "swagger.yaml" "swagger.yml" "swagger.json"
  "api/openapi.yaml" "api/openapi.yml" "api/openapi.json"
  "api/swagger.yaml" "docs/openapi.yaml" "spec/openapi.yaml"
)

find_openapi_spec() {
  local repo_dir="$1"
  for candidate in "${OPENAPI_CANDIDATES[@]}"; do
    if [[ -f "${repo_dir}/${candidate}" ]]; then
      echo "${repo_dir}/${candidate}"
      return 0
    fi
  done
  # Deeper scan as fallback (limited depth to avoid slowness)
  find "$repo_dir" -maxdepth 3 -name "openapi.yaml" -o -name "openapi.json" 2>/dev/null | head -1
  return 1
}
```

### Pattern 6: Type Definition Consistency (Heuristic)
**What:** Find shared model/type names (struct, interface, class, type alias) across repos and compare their field lists. This is language-agnostic and heuristic — it looks for names that appear in multiple repos, then compares the fields.
**When to use:** `drift types` subcommand.

```bash
# Extract TypeScript interface/type names and their fields
extract_ts_types() {
  local repo_dir="$1"
  # Find interface/type declarations in .ts files
  grep -rh --include="*.ts" -E "^(export )?(interface|type) [A-Z][A-Za-z]+" "$repo_dir/src" 2>/dev/null |
    sed 's/export //' | awk '{print $2}'
}

# Extract Go struct names
extract_go_structs() {
  local repo_dir="$1"
  grep -rh --include="*.go" -E "^type [A-Z][A-Za-z]+ struct" "$repo_dir" 2>/dev/null |
    awk '{print $2}'
}

# Find shared names (appearing in 2+ repos)
find_shared_types() {
  local -a all_names=()
  for repo in $SIBLINGS; do
    extract_ts_types "$repo"
    extract_go_structs "$repo"
  done
}
```

### Anti-Patterns to Avoid
- **Requiring yq for all operations:** yq may not be installed. Version extraction for go.mod and package.json must work without yq. Only TOML parsing benefits from yq; provide grep fallback.
- **Comparing all packages across all repos:** With 10 repos × 100 deps each, this generates massive output. Only report packages that appear in 2+ repos. Single-repo packages are not drift — they're just dependencies.
- **Treating semver range vs exact version as a match:** `^1.2.3` and `1.2.3` are not the same. Normalize ranges before comparison or flag the mismatch.
- **Hard-failing when oasdiff is absent:** `drift openapi` must work (with reduced fidelity) even when oasdiff is not installed. Graceful skip with explanation, not error.
- **Wall-of-text output:** Showing every package in every repo with "OK" status violates DRFT-06. Default to actionable differences only. 50 repos × 200 packages = 10,000 lines without filtering.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OpenAPI structured diff | Custom YAML field comparator | `oasdiff` | 300+ breaking change rules; handles $ref resolution, allOf, discriminators, etc. Custom comparator misses 95% of edge cases |
| TOML parsing | Custom TOML regex parser | `yq` (mikefarah) or `tomlq` (kislyuk) | TOML allows inline tables, multi-line strings, dotted keys — regex parsers break on legal TOML |
| Semver comparison | String comparison (`"1.10" > "1.9"` is false in ASCII) | semver-aware sort: `sort -V` (GNU) or explicit semver logic | Lexicographic comparison of version strings gives wrong results for minor version ≥ 10 |
| Sibling repo discovery | Manual path logic | `lib/siblings.sh` | Already built in Phase 2; includes allclear.config.json override support |

**Key insight:** The version comparison domain has subtle edge cases (semver ranges, pre-release tags, `~`/`^` specifiers) that hand-rolled string comparison consistently gets wrong. Use `sort -V` for ordering and normalize range specifiers before comparison.

---

## Common Pitfalls

### Pitfall 1: Semver Range Specifiers are Not Versions
**What goes wrong:** `package.json` uses `^1.2.3`, `~1.2.0`, `>=1.0.0 <2.0.0`. Comparing these strings directly yields false positives and false negatives. Repo A has `^1.2.3`, repo B has `1.2.3` — these are different strings but compatible ranges.
**Why it happens:** Developers conflate "the constraint string" with "the resolved version." Package files store constraints, not resolved versions.
**How to avoid:** For package.json, strip leading `^~>=<` before comparing pinned versions. Flag range specifiers vs exact pins as WARN (different locking strategy) rather than CRITICAL (incompatible versions). Lock files (package-lock.json, yarn.lock) have resolved versions but are excluded from editing by the file guard hook.
**Warning signs:** A high volume of false-positive drifts on Node.js repos.

### Pitfall 2: TOML Inline Tables Break Grep Fallback
**What goes wrong:** `Cargo.toml` can express `serde = { version = "1.0", features = ["derive"] }`. The grep fallback pattern `grep '= "[0-9]'` misses this because the value is an inline table, not a bare string.
**Why it happens:** Cargo.toml has two syntaxes for dependency versions. Grep only catches the simple string form.
**How to avoid:** When yq is absent, use a more careful pattern that also handles `version = "..."` within inline tables: `grep -oE 'version = "[^"]+"'`. Flag these as lower-confidence extractions. Recommend installing yq for full TOML support.
**Warning signs:** Known packages missing from drift report.

### Pitfall 3: OpenAPI $ref Resolution
**What goes wrong:** OpenAPI specs use `$ref` to reference shared schemas. Two specs may look identical at the path level but resolve `$ref: './schemas/User.yaml'` differently. Structural comparison without `$ref` resolution misses these differences.
**Why it happens:** YAML/JSON structural diff sees `$ref: './schemas/User.yaml'` as identical strings even if the referenced file differs.
**How to avoid:** Only use oasdiff for OpenAPI comparison — it resolves `$ref` before comparing. When oasdiff is absent, flag OpenAPI comparison as degraded and skip `$ref`-dependent checks. Never do raw YAML diff of OpenAPI specs.
**Warning signs:** Specs appear identical but client/server disagree on types.

### Pitfall 4: Type Name Collisions Across Languages
**What goes wrong:** TypeScript repo has `interface User`, Go repo has `type User struct`. The heuristic type checker finds both, tries to compare them, and produces noise because field syntax differs.
**Why it happens:** Type names are common; `User`, `Order`, `Product` appear in many repos independently.
**How to avoid:** Scope type consistency checks to repos that share the same language (detect from manifest). Only compare TS↔TS or Go↔Go types. Cross-language comparison should require explicit opt-in via `allclear.config.json` with schema mappings. Default behavior: language-scoped only.
**Warning signs:** High false-positive rate on type drift in polyglot repo sets.

### Pitfall 5: Slow Execution on Large Repos
**What goes wrong:** `drift types` does recursive grep across all source files in all sibling repos. On repos with thousands of source files, this takes tens of seconds.
**Why it happens:** Skills run in the Claude Code context where users expect responsiveness. A 60-second drift check feels broken.
**How to avoid:** Limit scan depth (`find -maxdepth 4`). Limit number of type names compared (cap at top 50 by occurrence). Consider adding a progress indicator via stderr. Document expected timing in SKILL.md.
**Warning signs:** Skill hangs or takes >30 seconds on moderate-sized repos.

### Pitfall 6: go.mod `require` Block vs Inline
**What goes wrong:** go.mod supports both `require github.com/foo/bar v1.2.3` (single-line) and block form with `require ( ... )`. A simple awk pattern that only handles one form misses half the packages.
**Why it happens:** Go module files use both forms, often in the same file (direct deps in block, indirect deps in separate block).
**How to avoid:** Use the awk pattern in Pattern 2 above which handles both forms. Test with a real go.mod that has both forms.
**Warning signs:** Go dependency counts from extraction look low compared to actual dependency count.

---

## Code Examples

### Complete drift-versions.sh Skeleton
```bash
#!/usr/bin/env bash
# Source: AllClear Phase 10 — drift-versions subcommand
set -euo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
source "${PLUGIN_ROOT}/lib/siblings.sh"

SHOW_INFO=false
[[ "${*:-}" == *"--all"* ]] && SHOW_INFO=true

emit_finding() {
  local level="$1" pkg="$2" repos="$3" details="$4"
  case "$level" in
    CRITICAL) printf "[CRITICAL] %-40s %s\n           Repos: %s\n" "$pkg" "$details" "$repos" ;;
    WARN)     printf "[ WARN  ] %-40s %s\n           Repos: %s\n" "$pkg" "$details" "$repos" ;;
    INFO)     $SHOW_INFO && printf "[ INFO  ] %-40s %s\n           Repos: %s\n" "$pkg" "$details" "$repos" ;;
  esac
}

extract_versions() {
  local repo_dir="$1"
  # package.json
  if [[ -f "${repo_dir}/package.json" ]]; then
    jq -r '(.dependencies // {}) + (.devDependencies // {}) | to_entries[] | "\(.key)=\(.value)"' \
      "${repo_dir}/package.json" 2>/dev/null
  fi
  # go.mod
  if [[ -f "${repo_dir}/go.mod" ]]; then
    awk '/^require \(/{in_block=1; next} /^\)/{in_block=0; next} in_block && /^\t/{print $1"="$2} /^require [^(]/{print $2"="$3}' \
      "${repo_dir}/go.mod" 2>/dev/null
  fi
  # Cargo.toml
  if [[ -f "${repo_dir}/Cargo.toml" ]]; then
    if command -v yq &>/dev/null; then
      yq -oy '(.dependencies // {}) | to_entries[] | .key + "=" + (.value | .version // .)' \
        "${repo_dir}/Cargo.toml" 2>/dev/null
    else
      grep -E '^\s*\w+ *= *"[0-9]' "${repo_dir}/Cargo.toml" | sed 's/\s//g; s/=.*"//; s/"$//; s/ //g'
      grep -oE 'version = "[^"]+"' "${repo_dir}/Cargo.toml" | sed 's/version = "//; s/"//'
    fi
  fi
}

declare -A pkg_versions pkg_repos

SIBLINGS=$(list_siblings 2>/dev/null || echo "")
if [[ -z "$SIBLINGS" ]]; then
  echo "No sibling repos found. Run from a directory with sibling git repos." >&2
  exit 0
fi

for REPO in $SIBLINGS; do
  while IFS='=' read -r pkg ver; do
    [[ -z "${pkg:-}" || -z "${ver:-}" ]] && continue
    pkg_versions["${REPO}:${pkg}"]="$ver"
    pkg_repos["$pkg"]="${pkg_repos[$pkg]:-}${REPO} "
  done < <(extract_versions "$REPO")
done

found_drift=false
for pkg in "${!pkg_repos[@]}"; do
  repos="${pkg_repos[$pkg]}"
  repo_count=$(echo "$repos" | tr ' ' '\n' | grep -c '\S' || true)
  [[ "$repo_count" -lt 2 ]] && continue  # only in one repo — not drift

  versions_seen=""
  repos_detail=""
  for repo in $repos; do
    v="${pkg_versions["${repo}:${pkg}"]:-}"
    [[ -z "$v" ]] && continue
    versions_seen="${versions_seen}${v} "
    repos_detail="${repos_detail}${repo}=${v} "
  done
  unique=$(echo "$versions_seen" | tr ' ' '\n' | sort -uV | grep -v '^$' | tr '\n' ' ')
  unique_count=$(echo "$versions_seen" | tr ' ' '\n' | sort -uV | grep -c '\S' || true)

  if [[ "$unique_count" -gt 1 ]]; then
    found_drift=true
    emit_finding "CRITICAL" "$pkg" "$repos" "$repos_detail"
  fi
done

if ! $found_drift; then
  echo "No version drift detected across $(echo "$SIBLINGS" | wc -w) repos."
fi
```

### OpenAPI Comparison with oasdiff Fallback
```bash
#!/usr/bin/env bash
# Source: AllClear Phase 10 — drift-openapi subcommand

compare_openapi() {
  local spec_a="$1" spec_b="$2" repo_a="$3" repo_b="$4"

  if command -v oasdiff &>/dev/null; then
    # Structured diff with breaking change detection
    result=$(oasdiff breaking "$spec_a" "$spec_b" 2>/dev/null)
    if [[ -n "$result" ]]; then
      emit_finding "CRITICAL" "openapi-spec" "${repo_a} ${repo_b}" "Breaking changes: $result"
    fi
    # Non-breaking diffs
    result=$(oasdiff diff "$spec_a" "$spec_b" --format text 2>/dev/null | head -20)
    if [[ -n "$result" ]]; then
      emit_finding "WARN" "openapi-spec" "${repo_a} ${repo_b}" "Non-breaking diffs found (first 20 lines)"
    fi
  else
    # Fallback: structural field count comparison via yq or diff
    echo "[ INFO  ] oasdiff not installed — using basic structural comparison for OpenAPI specs" >&2
    if command -v yq &>/dev/null; then
      paths_a=$(yq '.. | path | join(".")' "$spec_a" 2>/dev/null | sort)
      paths_b=$(yq '.. | path | join(".")' "$spec_b" 2>/dev/null | sort)
      delta=$(diff <(echo "$paths_a") <(echo "$paths_b") | grep '^[<>]' | wc -l)
      if [[ "$delta" -gt 0 ]]; then
        emit_finding "WARN" "openapi-spec" "${repo_a} ${repo_b}" \
          "Structural differences found ($delta paths differ). Install oasdiff for detailed analysis."
      fi
    else
      emit_finding "INFO" "openapi-spec" "${repo_a} ${repo_b}" \
        "Cannot compare without oasdiff or yq. Install either tool for OpenAPI drift detection."
    fi
  fi
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual diff of lock files | Cross-repo version extraction + comparison | 2023+ | Automated; works on manifest files not lock files (which are excluded by file-guard hook) |
| Swagger 2.0 spec files | OpenAPI 3.0/3.1 | 2021+ | Drift checker should handle both swagger.yaml and openapi.yaml formats; oasdiff supports both |
| jq-only TOML parsing (not possible) | yq 4.x TOML support | 2022 (mikefarah/yq v4.6) | TOML is now first-class parseable from shell; before v4.6 yq did not support TOML |
| openapi-diff (Java jar) | oasdiff (Go binary) | 2023+ | Single-binary Go tool; no JVM required; faster cold start; better CI integration |

**Deprecated/outdated:**
- `swagger-diff`: Predecessor to oasdiff; Swagger 2.0 only; replaced by oasdiff which handles both.
- `kislyuk/yq` for TOML: Works but requires Python + tomlkit; `mikefarah/yq` is a single binary that is more portable.

---

## Open Questions

1. **Should `drift` default to running all three subcommands or just `versions`?**
   - What we know: DRFT-04 says skill "supports subcommands"; DRFT-06 says "defaults to actionable differences only"
   - What's unclear: Does "no subcommand" mean "all three" or "just versions" (cheapest)?
   - Recommendation: Default to all three checks. Filter by severity (DRFT-06) limits noise. Document that `drift versions` is fastest if users want speed.

2. **How to handle repos with no shared packages at all?**
   - What we know: Cross-repo analysis only makes sense for repos that share deps
   - What's unclear: A Python API and a Go CLI share no package ecosystem — is that a finding?
   - Recommendation: Silently skip cross-ecosystem comparisons. Only report drift where the same package name appears in multiple repos. If zero shared packages, emit INFO-level "No shared dependencies found between repo A (Python) and repo B (Go)."

3. **Should type checking compare TypeScript and Python types that model the same domain entity?**
   - What we know: Polyglot teams often have `User` in TS frontend and `User` in Python backend
   - What's unclear: The structure will always differ (TypeScript interface vs Python dataclass)
   - Recommendation: Scope to same-language by default. Document in SKILL.md that cross-language type consistency requires explicit allclear.config.json schema mappings. Out of scope for this phase.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | bats-core (same as all other AllClear shell script tests) |
| Config file | `tests/` directory (flat, one .bats file per script under test) |
| Quick run command | `bats tests/drift-versions.bats` |
| Full suite command | `bats tests/` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DRFT-01 | extract_versions returns correct NAME=VERSION for package.json | unit | `bats tests/drift-versions.bats::extract_package_json` | ❌ Wave 0 |
| DRFT-01 | extract_versions returns correct NAME=VERSION for Cargo.toml | unit | `bats tests/drift-versions.bats::extract_cargo_toml` | ❌ Wave 0 |
| DRFT-01 | extract_versions returns correct NAME=VERSION for go.mod | unit | `bats tests/drift-versions.bats::extract_go_mod` | ❌ Wave 0 |
| DRFT-01 | extract_versions returns correct NAME=VERSION for pyproject.toml | unit | `bats tests/drift-versions.bats::extract_pyproject` | ❌ Wave 0 |
| DRFT-05 | drift report shows which repo has which version | unit | `bats tests/drift-versions.bats::report_with_repos` | ❌ Wave 0 |
| DRFT-06 | CRITICAL findings shown by default | unit | `bats tests/drift-versions.bats::default_shows_critical` | ❌ Wave 0 |
| DRFT-06 | INFO findings suppressed without --all | unit | `bats tests/drift-versions.bats::info_suppressed_by_default` | ❌ Wave 0 |
| DRFT-06 | INFO findings shown with --all | unit | `bats tests/drift-versions.bats::all_flag_shows_info` | ❌ Wave 0 |
| DRFT-03 | OpenAPI comparison uses oasdiff when available | integration | `bats tests/drift-openapi.bats::uses_oasdiff` | ❌ Wave 0 |
| DRFT-03 | OpenAPI comparison falls back gracefully without oasdiff | unit | `bats tests/drift-openapi.bats::graceful_fallback` | ❌ Wave 0 |
| DRFT-04 | drift versions subcommand invokes version check | unit | `bats tests/drift.bats::subcommand_versions` | ❌ Wave 0 |
| DRFT-04 | drift types subcommand invokes type check | unit | `bats tests/drift.bats::subcommand_types` | ❌ Wave 0 |
| DRFT-04 | drift openapi subcommand invokes openapi check | unit | `bats tests/drift.bats::subcommand_openapi` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `bats tests/drift-versions.bats`
- **Per wave merge:** `bats tests/`
- **Phase gate:** Full bats suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/drift-versions.bats` — covers DRFT-01, DRFT-05, DRFT-06 version-related tests
- [ ] `tests/drift-openapi.bats` — covers DRFT-03 oasdiff + fallback tests
- [ ] `tests/drift.bats` — covers DRFT-04 subcommand routing
- [ ] `tests/fixtures/drift/` — test fixture repos with sample package.json, Cargo.toml, go.mod, openapi.yaml

---

## Sources

### Primary (HIGH confidence)
- Architecture research (`.planning/research/ARCHITECTURE.md`) — skill structure, SKILL.md pattern, lib/siblings.sh usage
- [mikefarah/yq GitHub](https://github.com/mikefarah/yq) — TOML support confirmed in v4.6+; single binary
- [oasdiff GitHub](https://github.com/oasdiff/oasdiff) — OpenAPI diff tool; 300+ rules; Go binary; breaking change detection
- [jq docs](https://jqlang.github.io/jq/) — JSON extraction patterns for package.json; HIGH confidence per PLGN-07

### Secondary (MEDIUM confidence)
- [kislyuk/yq PyPI](https://pypi.org/project/yq/) — Alternative Python-based TOML via `tomlq`; verified but less preferred than mikefarah
- [go.mod format](https://go.dev/ref/mod) — Official Go modules reference; require block and inline formats confirmed
- [PEP 508](https://peps.python.org/pep-0508/) — Python dependency string format in pyproject.toml; confirmed via official PEP
- [semver-tool (fsaintjacques)](https://github.com/fsaintjacques/semver-tool) — Bash semver comparison; sort -V is simpler alternative
- [oasdiff.com](https://www.oasdiff.com/) — Commercial docs with CLI usage examples

### Tertiary (LOW confidence — verify before use)
- WebSearch findings on Cargo.toml grep fallback patterns — multiple sources agree on `version = "..."` inner-table form; not verified against full Cargo.toml spec
- WebSearch findings on OpenAPI common file locations — `openapi.yaml`, `openapi.json`, `swagger.yaml` widely confirmed; deep framework paths need validation per ecosystem

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — jq confirmed required (PLGN-07); yq and oasdiff verified via official GitHub/docs
- Architecture: HIGH — follows identical pattern to cross-impact skill (Phase 9) per existing ARCHITECTURE.md
- Version extraction patterns: MEDIUM — package.json/go.mod are HIGH; Cargo.toml/pyproject.toml grep fallbacks are MEDIUM (TOML edge cases)
- Pitfalls: HIGH — semver range trap and TOML inline tables are well-documented; OpenAPI $ref trap confirmed via oasdiff docs
- Type checking heuristic: MEDIUM — grep-based approach is pragmatic but acknowledged as heuristic; no production-grade cross-language type comparison tool exists for this use case

**Research date:** 2026-03-15
**Valid until:** 2026-04-15 (30 days — tools are stable; oasdiff and yq update frequently but API is stable)
