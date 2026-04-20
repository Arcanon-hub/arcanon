# Changelog

All notable changes to the Arcanon plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- Migration loader no longer imports `.test.js` files from `worker/db/migrations/`, preventing the Node test runner from polluting the MCP server's stdout and the worker's `logs/worker.log`. Fixes previously deferred bats failures MCP-01 ("tools/list returns exactly 8 tools") and WRKR-07 ("worker writes structured JSON log to logs/worker.log").
- Moved `worker/db/migrations/010_service_dependencies.test.js` to `worker/db/migration-010.test.js` to match the existing `migration-004.test.js` / `migration-008.test.js` convention and keep `migrations/` free of test files.
- Fixed broken `npm test` script that pointed at a non-existent `tests/` directory. `test`, `test:storage`, and `test:hub-sync` now resolve real test file paths; new `test:migrations` script added.
- Added `.gitignore` entries for `.DS_Store`, `.superset/`, local `.claude/` directory, `AGENTS.md`, and presentation artifacts (`*.pptx`, `*.xlsx`).

## Notes on prior versions

Historical releases (v1.0 through v5.7.0) were shipped under the **Ligamen** name. The plugin was rebranded to **Arcanon**, adding the Arcanon Hub sync pipeline and consolidating the library-drift workstream. The version was reset to `0.1.0` for the first public Arcanon release; legacy `~/.ligamen/` data dirs and `LIGAMEN_*` env vars are still read for back-compat.

The v5.8.0 internal milestone (Library Drift & Language Parity) shipped during the Arcanon rebrand and is captured as part of the first Arcanon public release rather than tagged separately. It delivered:

- **Library-level dependency drift (THE-1019):** manifest-aware `dep-collector.js` covering 7 ecosystems (npm, PyPI, Go, Cargo, Maven, NuGet, RubyGems), `service_dependencies` table with `dep_kind` discriminant and 4-column UNIQUE key, and Hub Payload v1.1 gated behind the `hub.beta_features.library_deps` feature flag.
- **Java / C# / Ruby parity (THE-1020):** `lib/detect.sh` language/project-type detection, `worker/scan/discovery.js` MANIFESTS extension (pom.xml, build.gradle, build.gradle.kts, Gemfile), drift parsers for Maven (with `<parent>` inheritance and `<dependencyManagement>` resolution), Gradle (Groovy + Kotlin DSL + `libs.versions.toml` catalog), NuGet (including `Directory.Packages.props` Central Package Management), and Bundler (`Gemfile.lock` with GEM/GIT/PATH sections). Type extractors for `.java`, `.cs`, `.rb`. Auth/DB enrichment signals for Spring Security 5+6, ASP.NET Identity, EF Core (including minimal-API `AddDbContext<T>()`), Devise, ActiveRecord, and `config/database.yml` adapter probe. `EXCLUDED_DIRS` adds Maven `target/` and MSBuild `obj/` / `bin/`.
- **Shell cleanup + dispatcher (THE-1021):** new `scripts/drift.sh` dispatcher with subprocess-based routing and reserved `licenses` / `security` slots, `lib/worker-restart.sh` extracted from duplicated restart logic in `session-start.sh` and `worker-start.sh`, and bug fixes (the `bc` subprocess in `wait_for_worker`, the `declare -A` key leak in `drift-types.sh`, the global stderr suppression in `lint.sh`, and an explicit Bash 4+ floor guard). Dead code removed from `impact.sh` and `lint.sh`.
