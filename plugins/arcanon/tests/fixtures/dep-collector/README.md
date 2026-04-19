# dep-collector fixtures

Minimal manifest repos used by `dep-collector.test.js` (node:test).

| Directory | Manifests | Invariant tested |
|---|---|---|
| `npm-basic/` | `package.json` + `package-lock.json` | npm production deps emitted; `devDependencies` excluded; `resolved_version` from lockfile |
| `pypi-pyproject/` | `pyproject.toml` | PEP 621 `[project.dependencies]` array + `[tool.poetry.dependencies]` table both parsed; `python` itself excluded |
| `pypi-reqs/` | `requirements.txt` | requirements.txt accepted as deprecated fallback; flag lines (`-r`) skipped |
| `go-module/` | `go.mod` | Both single-line `require X v1` and block `require ( ... )` forms parsed |
| `cargo-crate/` | `Cargo.toml` | Both simple `name = "version"` and inline-table `name = { version = "X" }` forms parsed |
| `maven-project/` | `pom.xml` | `${property}` resolution; `<dependencyManagement>` version inheritance; `<scope>test</scope>` excluded |
| `nuget-solution/` | `Directory.Packages.props` + `Main.csproj` | CPM: `PackageReference` without `Version=` gets version from `Directory.Packages.props` |
| `rubygems-bundle/` | `Gemfile.lock` | GEM + GIT + PATH sections all emit direct-gem rows; sub-dep lines (6-space indent) excluded |
| `unsupported-swift/` | `Package.swift` | Triggers `WARN dep-scan: unsupported manifest skipped` |
| `invalid-npm/` | `package.json` (corrupt) | Parser error contained; `WARN dep-scan: parser error` emitted; no throw; npm absent from `ecosystems_scanned` |
| `empty-repo/` | `.gitkeep` only | Zero rows; empty `ecosystems_scanned` array |
