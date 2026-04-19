# Requirements: arcanon v5.8.0 — Library Drift & Language Parity

**Defined:** 2026-04-19
**Core Value:** Every edit is automatically formatted and linted, every quality check runs with one command, and breaking changes across repos are caught before they ship.

**Linear tickets:** THE-1019 (manifest persistence + payload v1.1), THE-1020 (Java/C#/Ruby parity), THE-1021 (shell cleanup + drift dispatcher).

## v1 Requirements (Milestone v5.8.0)

Requirements for v5.8.0 release. Each maps to exactly one roadmap phase.

### Manifest Parsing (shell)

New ecosystem parsers in `scripts/drift-versions.sh`. Zero new runtime deps — POSIX awk/grep/sed only.

- [ ] **MF-01**: `/arcanon:drift versions` parses Maven `pom.xml` and resolves `<parent>` inheritance so managed deps surface with correct versions
- [ ] **MF-02**: `/arcanon:drift versions` parses Gradle Groovy DSL (`build.gradle`) and Kotlin DSL (`build.gradle.kts`) with separate passes
- [ ] **MF-03**: `/arcanon:drift versions` resolves Gradle version catalogs (`gradle/libs.versions.toml`) for BOM-managed deps
- [ ] **MF-04**: `/arcanon:drift versions` parses NuGet `.csproj` `<PackageReference>` entries including Central Package Management (`Directory.Packages.props`)
- [ ] **MF-05**: `/arcanon:drift versions` parses Bundler `Gemfile.lock` — uses lockfile pinned versions (not Gemfile ranges); covers GEM, GIT, PATH sections
- [ ] **MF-06**: Each new parser has a bats fixture covering its non-obvious edge case (parent POM, Kotlin DSL, CPM, GEM+GIT+PATH); `tests/fixtures/drift/` extended
- [ ] **MF-07**: No regressions in existing npm / pypi / go / cargo drift output; bats suite remains green

### Language Detection

- [ ] **LANG-01**: `lib/detect.sh detect_language()` recognizes Java (pom.xml / build.gradle / build.gradle.kts), .NET (.csproj / .sln), Ruby (Gemfile); session-start banner shows correct project type
- [ ] **LANG-02**: `detect_project_type()` priority order keeps existing TS/Python/Go/Rust precedence; appends `java > dotnet > ruby`
- [ ] **LANG-03**: `worker/scan/discovery.js` MANIFESTS array includes `pom.xml`, `build.gradle`, `build.gradle.kts`, `Gemfile` so linked-repo discovery picks them up

### Type Extraction

- [ ] **TYPE-01**: `scripts/drift-types.sh detect_repo_language()` returns tokens `java | cs | rb` for `.java | .cs | .rb` files
- [ ] **TYPE-02**: Java extractor captures `public interface|class|record|enum <Name>`; handles generic bounds
- [ ] **TYPE-03**: C# extractor captures `public interface|class|record|struct|enum <Name>`; handles `partial class` (document limitation: fragments compared as separate types)
- [ ] **TYPE-04**: Ruby extractor captures `class|module <Name>`; no false positive on `self.class_eval` or re-opens
- [ ] **TYPE-05**: New extractors use the `$WORK_DIR/<pkg_safe>` tmpdir pattern already established in drift-versions.sh (no new `declare -A` — Bash 3.2 compatible)

### Auth / DB Enrichment

Extend `worker/scan/enrichment/auth-db-extractor.js` with language switch cases.

- [ ] **ENR-01**: `LANG_EXTENSIONS` map includes `java: ['.java']`, `csharp: ['.cs']`, `ruby: ['.rb']`
- [ ] **ENR-02**: `AUTH_SIGNALS.java` ships BOTH Spring Security 5 (`@EnableWebSecurity`, `@PreAuthorize`) AND Spring Security 6 (`SecurityFilterChain` bean, `OAuth2ResourceServer`) patterns
- [ ] **ENR-03**: `AUTH_SIGNALS.csharp` covers ASP.NET Identity (`[Authorize]`, `AddAuthentication`, `AddJwtBearer`)
- [ ] **ENR-04**: `AUTH_SIGNALS.ruby` covers Devise (`before_action :authenticate_user!`, `devise_for`) and HTTP basic
- [ ] **ENR-05**: `DB_SOURCE_SIGNALS.java` covers Spring Data (`@Entity`, `JdbcTemplate`, `EntityManager`, `spring.datasource.url` in application.{yml,properties})
- [ ] **ENR-06**: `DB_SOURCE_SIGNALS.csharp` covers EF Core (`DbContext`, `Microsoft.EntityFrameworkCore`, minimal-API `builder.Services.AddDbContext<T>()`)
- [ ] **ENR-07**: `DB_SOURCE_SIGNALS.ruby` covers ActiveRecord and probes `config/database.yml` `adapter:` key
- [ ] **ENR-08**: `EXCLUDED_DIRS` adds `target` (Maven output), `obj`, `bin` (MSBuild output) so enrichment does not traverse generated files
- [ ] **ENR-09**: `services.auth_mechanism` and `services.db_backend` populated for scanned Java/C#/Ruby services (end-to-end test against a fixture repo per language)

### Dependency Persistence (THE-1019 core)

- [ ] **DEP-01**: Migration `010_service_dependencies.js` creates `service_dependencies` table with columns: `id`, `service_id FK ON DELETE CASCADE`, `scan_version_id FK`, `ecosystem TEXT`, `package_name TEXT`, `version_spec TEXT`, `resolved_version TEXT`, `manifest_file TEXT`, `dep_kind TEXT CHECK(dep_kind IN ('direct','transient')) DEFAULT 'direct'`
- [ ] **DEP-02**: Unique constraint `UNIQUE(service_id, ecosystem, package_name, manifest_file)` — 4-column key handles mono-repos with the same package in multiple manifests
- [ ] **DEP-03**: Index on `package_name` for cross-repo drift lookup; index on `scan_version_id` for stale cleanup
- [ ] **DEP-04**: v5.8.0 writes `dep_kind = 'direct'` only; `'transient'` is a reserved future value (column in, parsing out)
- [ ] **DEP-05**: `worker/scan/enrichment/dep-collector.js` exports `collectDependencies(repoPath, rootPath)` returning one row per dep across all supported ecosystems (npm/pypi/go/cargo/maven/nuget/rubygems)
- [ ] **DEP-06**: `dep-collector.js` emits `slog('WARN', 'dep-scan: unsupported manifest skipped', {...})` for manifests it cannot parse, and returns `ecosystems_scanned: []` field so coverage gaps are visible in logs
- [ ] **DEP-07**: `dep-collector.js` persists production deps only (not devDependencies); `drift-versions.sh` local output is unchanged
- [ ] **DEP-08**: `query-engine.js upsertDependency(row)` uses prepared statement + `ON CONFLICT DO UPDATE` preserving row IDs across re-scans
- [ ] **DEP-09**: `manager.js` Phase B loop calls `collectDependencies` after `runEnrichmentPass` for each service (no change to `beginScan`/`endScan` bracket)
- [ ] **DEP-10**: Stale rows cleaned automatically via `ON DELETE CASCADE` when `endScan()` removes a stale service; no new cleanup statement needed
- [ ] **DEP-11**: node:test coverage: one test per ecosystem parser (npm/pypi/go/cargo/maven/nuget/rubygems), upsert, get, dedup across re-scans, stale cleanup

### Hub Payload v1.1

- [ ] **HUB-01**: `buildFindingsBlock()` in `worker/hub-sync/payload.js` emits `dependencies: []` array per service from `queryEngine.getDependenciesForService(serviceId)`
- [ ] **HUB-02**: `buildScanPayload()` sets `version: "1.1"` when any service has non-empty `dependencies`; falls back to `"1.0"` when all empty (backward compat with pre-THE-1018 hubs)
- [ ] **HUB-03**: Feature flag `hub.beta_features.library_deps` in `.arcanon/config.json` (default `false`) gates emission — when off, payload is v1.0 regardless of deps
- [ ] **HUB-04**: node:test covers: empty deps → v1.0, populated deps + flag on → v1.1, populated deps + flag off → v1.0
- [ ] **HUB-05**: Existing `/arcanon:drift versions` command keeps working exactly as today — no change to shell output shape

### Drift Dispatcher & Shell Cleanup (THE-1021)

- [ ] **DSP-01**: New `scripts/drift.sh` dispatcher supports subcommands `versions | types | openapi | all`; reserves `licenses | security` for future (prints "not yet implemented" with exit 2)
- [ ] **DSP-02**: Dispatcher invokes subcommands as subshells (`bash "$PLUGIN_ROOT/scripts/drift-${sub}.sh"`), never `source` — existing direct-invoke paths continue to work unchanged
- [ ] **DSP-03**: `scripts/drift-*.sh` subcommand scripts keep sourcing `drift-common.sh` themselves (no coupling to dispatcher)
- [ ] **DSP-04**: `scripts/drift.sh` bails cleanly with helpful message if `${BASH_VERSINFO[0]} < 4`
- [ ] **DSP-05**: New `lib/worker-restart.sh` exports `should_restart_worker()` (returns 0/1 + stdout reason) and `restart_worker_if_stale()` (idempotent stop-then-background-start)
- [ ] **DSP-06**: `scripts/session-start.sh` lines 43-68 replaced with `source lib/worker-restart.sh; restart_worker_if_stale || true`
- [ ] **DSP-07**: `scripts/worker-start.sh` lines 28-61 replaced with same call; PID-file mutex preserved
- [ ] **DSP-08**: `drift-common.sh` "no linked repos" case emits `echo "drift: no linked repos configured" >&2` before return
- [ ] **DSP-09**: Bug fix: `lib/worker-client.sh:38` — remove `bc` subprocess per sleep iteration; pre-compute once or use `awk`
- [ ] **DSP-10**: Bug fix: `scripts/drift-types.sh:148,202` — `unset type_repos && declare -A type_repos` per language block to prevent associative-array leak
- [ ] **DSP-11**: Bug fix: `scripts/lint.sh:10` — remove global `exec 2>/dev/null`; redirect per linter call so linter panics are surfaced
- [ ] **DSP-12**: Bug fix: Declare Bash 4+ as plugin floor — add version guard at top of `drift-types.sh`; update `lib/config.sh:32` comment to drop bash 3.2 language
- [ ] **DSP-13**: Dead code removed: `scripts/impact.sh:16-55` `classify_match()` function; `scripts/lint.sh:109` `NPM_BIN=$(npm bin ...)` line
- [ ] **DSP-14**: Full bats suite passes (existing + new fixtures for MF-06, DSP-10); zero regressions

## v2 Requirements (Deferred)

### Dependency Drift (future)

- **DEP-V2-01**: Transient dependencies scanned and persisted (`dep_kind = 'transient'`) — column exists in v5.8.0, parsing deferred
- **DEP-V2-02**: `devDependencies` persisted with `scope = 'dev'` — requires adding `scope` column in future migration
- **DEP-V2-03**: MCP tool `list_service_deps` for agent-autonomous dep analysis
- **DEP-V2-04**: `/arcanon:drift licenses` subcommand — license mismatch detection across linked repos
- **DEP-V2-05**: `/arcanon:drift security` subcommand — CVE advisory cross-reference (may require external feed; evaluate vs no-external-deps constraint)

### Language Coverage (future)

- **LANG-V2-01**: Kotlin project type (`settings.gradle.kts`, `build.gradle.kts` with Kotlin plugin)
- **LANG-V2-02**: Scala SBT (`build.sbt`)
- **LANG-V2-03**: PHP Composer (`composer.json`)
- **LANG-V2-04**: Swift Package Manager (`Package.swift`)
- **LANG-V2-05**: Elixir Mix (`mix.exs`)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Hub-side `service_dependencies` resolver (THE-1018) | Separate ticket on `arcanon-hub` repo; plugin ships v1.1 payload ready for it |
| AST parsers (JavaParser, Roslyn, tree-sitter) | Violates zero-external-dep constraint; agent-first scan design |
| `mvn` / `gradle` / `dotnet list` / `bundle list` invocations | Requires buildable project; fails on bare clones; violates offline-capable constraint |
| Range resolution at scan time (`^1.2.3` → pinned) | Requires `npm install` / `bundle install`; breaks air-gapped environments |
| Transitive dep trees in `service_dependencies` | Would bloat SQLite with 500-2000 rows per service; hub-side responsibility |
| CVE / license feeds | External service dependency; violates no-external-service-deps constraint |
| Auto-upgrade PRs | Unsafe without review; out of plugin scope |
| Agent prompt changes for new languages | Agents already handle Java/C#/Ruby general cases; prompt-quality pass is a separate follow-up |
| Backwards compat for plugin-side v1.0 payload emission | Once THE-1018 ships and feature flag flips to default-on, v1.0 emission is retained but no-op for populated deps |
| Kotlin/Scala/PHP/Swift/Elixir language parity | Deferred to v2; documented 4-file extension pattern in place after THE-1020 |

## Traceability

Populated by gsd-roadmapper during ROADMAP.md creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| MF-01 | 92 | Pending |
| MF-02 | 92 | Pending |
| MF-03 | 92 | Pending |
| MF-04 | 92 | Pending |
| MF-05 | 92 | Pending |
| MF-06 | 92 | Pending |
| MF-07 | 92 | Pending |
| LANG-01 | 92 | Pending |
| LANG-02 | 92 | Pending |
| LANG-03 | 92 | Pending |
| TYPE-01 | 92 | Pending |
| TYPE-02 | 92 | Pending |
| TYPE-03 | 92 | Pending |
| TYPE-04 | 92 | Pending |
| TYPE-05 | 92 | Pending |
| ENR-01 | 94 | Pending |
| ENR-02 | 94 | Pending |
| ENR-03 | 94 | Pending |
| ENR-04 | 94 | Pending |
| ENR-05 | 94 | Pending |
| ENR-06 | 94 | Pending |
| ENR-07 | 94 | Pending |
| ENR-08 | 94 | Pending |
| ENR-09 | 94 | Pending |
| DEP-01 | 93 | Pending |
| DEP-02 | 93 | Pending |
| DEP-03 | 93 | Pending |
| DEP-04 | 93 | Pending |
| DEP-05 | 93 | Pending |
| DEP-06 | 93 | Pending |
| DEP-07 | 93 | Pending |
| DEP-08 | 93 | Pending |
| DEP-09 | 93 | Pending |
| DEP-10 | 93 | Pending |
| DEP-11 | 93 | Pending |
| HUB-01 | 96 | Pending |
| HUB-02 | 96 | Pending |
| HUB-03 | 96 | Pending |
| HUB-04 | 96 | Pending |
| HUB-05 | 96 | Pending |
| DSP-01 | 95 | Pending |
| DSP-02 | 95 | Pending |
| DSP-03 | 95 | Pending |
| DSP-04 | 95 | Pending |
| DSP-05 | 95 | Pending |
| DSP-06 | 95 | Pending |
| DSP-07 | 95 | Pending |
| DSP-08 | 95 | Pending |
| DSP-09 | 95 | Pending |
| DSP-10 | 95 | Pending |
| DSP-11 | 95 | Pending |
| DSP-12 | 95 | Pending |
| DSP-13 | 95 | Pending |
| DSP-14 | 95 | Pending |

**Coverage:**
- v1 requirements: 53 total
- Mapped to phases: 53, Unmapped: 0 ✓

---
*Requirements defined: 2026-04-19*
*Last updated: 2026-04-19 after roadmap creation*
