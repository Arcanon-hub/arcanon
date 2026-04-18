# Ligamen Scan — Common Rules

## Scope Rule

Only report services/libraries whose **source code is in `{{REPO_PATH}}`**. If this repo calls an external service, that service appears ONLY as a `target` in `connections` — never in `services`. Do not report services referenced only in config files, Dockerfiles, or deployment manifests.

## Confidence Rules

**HIGH** — literal string definition in source code:
- `@app.route('/users')` — Python Flask
- `router.get('/health', handler)` — Node.js Express
- `@RestController` + `@GetMapping("/users")` — Java Spring Boot
- `[HttpGet("users")]` + `[Route("api/[controller]")]` — C# ASP.NET Core
- `get '/users', to: 'users#index'` — Ruby on Rails routes.rb
- `@Get("/users") fun getUsers()` — Kotlin Ktor / Spring Boot
- `producer.send('order.created', msg)` — event producer (any language)

**LOW** — inferred from variables/patterns without a literal string:
- `fetch(baseUrl + path)`, `const endpoint = getConfig().endpoint`

**CRITICAL:** Do not report an endpoint or connection without a directly citable literal string from source.

## Evidence Requirement

Every connection **must** include an `evidence` field: the exact code snippet (≤ 3 lines) that proves this connection. Not optional.

## Crossing Semantics

Every connection must include a `crossing` field. Use exactly one of these three values:

| Value | Meaning | When to use |
|-------|---------|-------------|
| `internal` | Within the same deployable unit | Source and target are in the same repo and the same service boundary (e.g., one microservice calling its own internal module) |
| `cross-service` | Different service in a linked repo | Target is a named service that exists in another repo in the same project (e.g., user-api calling auth-service when both repos are linked) |
| `external` | Outside the project entirely | Target is a third-party API, SaaS, or any service NOT found in any linked repo (e.g., stripe.com, sendgrid, Twilio) |

**Default conservatively:** If you cannot confirm the target is a known linked-repo service, use `external`. Post-scan reconciliation will upgrade misclassified values automatically.

## Service Naming Convention

The `name` field must be **lowercase-hyphenated**, derived from the package manifest:

| Ecosystem | Manifest | Name field |
|-----------|----------|------------|
| Node.js | `package.json` | `"name"` |
| Python | `pyproject.toml` | `[project]` → `name` |
| Go | `go.mod` | Last segment of `module` |
| Rust | `Cargo.toml` | `[package]` → `name` |

Fallback: repository directory basename. Strip `@scope/` prefixes. Replace `_` and spaces with `-`.

**DISALLOWED generic names** (append path-based suffix instead): `server, worker, api, app, main, service, backend, frontend`

Names must be **stable across scans** — always manifest name, never hostname or container tag.

## What NOT to Report

- Do not invent connections or infer from imports alone
- Do not report library-internal calls
- Do not report CLI scripts, build tools, or test files as services
- Do not add prose before or after the JSON output

## Output Format

Return **only** a fenced JSON code block. Nothing before or after.

````
```json
{ ... your findings object ... }
```
````

## JSON Schema

Read the schema from: `{{SCHEMA_JSON}}`
