---
phase: 94-auth-db-enrichment
plan: "02"
subsystem: worker/scan/enrichment
tags: [csharp, aspnet-core, ef-core, auth-enrichment, db-enrichment, tdd]
dependency_graph:
  requires: [java-auth-db-enrichment]
  provides: [csharp-auth-db-enrichment]
  affects: [auth-db-extractor.js, enrichment-pipeline]
tech_stack:
  added: []
  patterns: [signal-table-per-language, tdd-red-green, minimal-api-ef-core-pattern]
key_files:
  created:
    - plugins/arcanon/worker/scan/enrichment/auth-db-extractor.csharp.test.js
    - plugins/arcanon/worker/scan/enrichment/fixtures/csharp/Api.csproj
    - plugins/arcanon/worker/scan/enrichment/fixtures/csharp/Program.cs
    - plugins/arcanon/worker/scan/enrichment/fixtures/csharp/AppDbContext.cs
    - plugins/arcanon/worker/scan/enrichment/fixtures/csharp/appsettings.json
    - plugins/arcanon/worker/scan/enrichment/fixtures/csharp/Controllers/UsersController.cs
    - plugins/arcanon/worker/scan/enrichment/fixtures/csharp/obj/Debug/net8.0/Api.AssemblyInfo.cs
    - plugins/arcanon/worker/scan/enrichment/fixtures/csharp/bin/Debug/net8.0/GeneratedStub.cs
    - plugins/arcanon/worker/scan/enrichment/fixtures/csharp-identity/Program.cs
    - plugins/arcanon/worker/scan/enrichment/fixtures/csharp-identity/AppDbContext.cs
    - plugins/arcanon/worker/scan/enrichment/fixtures/csharp-empty/obj/Debug/Fake.cs
    - plugins/arcanon/worker/scan/enrichment/fixtures/csharp-bare/SomeFile.cs
  modified:
    - plugins/arcanon/worker/scan/enrichment/auth-db-extractor.js
decisions:
  - "Test D implemented via tmpdir copy of Controllers/UsersController.cs (not live file deletion) — avoids fixture mutation and test isolation issues"
  - "DB_SOURCE_SIGNALS.csharp captures EF Core minimal-API pattern via UseNpgsql/UseSqlServer etc. (Pitfall 11 GREEN path) — no AddDbContext wrapper regex needed"
  - "partial class limitation documented as comment in AUTH_SIGNALS.csharp, not implemented (Phase 92 TYPE-03 locked decision)"
metrics:
  duration: "166s"
  completed: "2026-04-19"
  tasks_completed: 2
  files_changed: 13
---

# Phase 94 Plan 02: C# Auth/DB Enrichment Summary

C# auth/db signal tables added to auth-db-extractor.js covering ASP.NET Core Identity and EF Core minimal-API pattern, with obj/bin exclusion and TDD-verified end-to-end tests.

## What Was Done

Extended `plugins/arcanon/worker/scan/enrichment/auth-db-extractor.js` with four edits:

1. **EXCLUDED_DIRS** — added `'obj'` and `'bin'` so MSBuild output directories are never traversed (ENR-08)
2. **AUTH_SIGNALS.csharp** — 4 entries:
   - `jwt`: `AddJwtBearer`, `JwtBearerDefaults`, `JwtSecurityToken`, `Microsoft.AspNetCore.Authentication.JwtBearer`, `System.IdentityModel.Tokens.Jwt`
   - `session`: `AddDefaultIdentity`, `AddIdentity`, `IdentityUser`, `SignInManager`, `UserManager`, `.AddCookie(`, `[Authorize` (ENR-03 widened per ENR-03 requirement)
   - `oauth2`: `AddOpenIdConnect`, `AddMicrosoftIdentityWebApp`, `OAuthOptions`, `OpenIdConnectOptions`
   - `api-key`: `ApiKeyMiddleware`, `IApiKeyValidator`, `X-API-Key`, `ApiKeyAttribute`
   - Code comment: partial class is Phase 92 TYPE-03 concern, not implemented here (ENR-03)
3. **DB_SOURCE_SIGNALS.csharp** — 6 entries covering EF Core Use-provider discriminators:
   - `postgresql`: `UseNpgsql`, `Npgsql`, `NpgsqlConnection`, `Npgsql.EntityFrameworkCore` (ENR-06 PITFALL-11 GREEN)
   - `mysql`: `UseMySql`, `Pomelo.EntityFrameworkCore.MySql`, `MySql.EntityFrameworkCore`
   - `sqlserver`: `UseSqlServer`, `SqlConnection`, `Microsoft.EntityFrameworkCore.SqlServer`
   - `sqlite`: `UseSqlite`, `SQLiteConnection`, `Microsoft.EntityFrameworkCore.Sqlite`
   - `mongodb`: `MongoDB.Driver`, `MongoClient`, `IMongoDatabase`
   - `cosmosdb`: `UseCosmos`, `CosmosClient`, `Microsoft.EntityFrameworkCore.Cosmos`
4. **LANG_EXTENSIONS.csharp** — `['.cs']` so `.cs` files are collected during traversal (ENR-01 csharp portion)

Fixture tree created under:
- `fixtures/csharp/` — ASP.NET Core 8 minimal API with `AddJwtBearer` + `AddDbContext<T>(UseNpgsql(...))` + `[Authorize]` controller + decoy files in `obj/` and `bin/`
- `fixtures/csharp-identity/` — `AddDefaultIdentity<IdentityUser>()` session auth, no JWT
- `fixtures/csharp-empty/` — only `obj/Debug/Fake.cs` with `AddJwtBearer` decoy; no real .cs at root
- `fixtures/csharp-bare/` — `SomeFile.cs` with bare class, no signals

End-to-end test `auth-db-extractor.csharp.test.js` — 6 tests, all GREEN:
- Test A: minimal-API fixture yields `auth_mechanism='jwt'`, `db_backend='postgresql'`; node_metadata + services columns written
- Test B: Identity fixture yields `auth_mechanism='session'`
- Test C (structural): `EXCLUDED_DIRS.has('obj') && EXCLUDED_DIRS.has('bin')` asserted
- Test C (functional): `csharp-empty/` with only `obj/` decoy yields `auth_mechanism=null`
- Test D: `[Authorize]` alone (tmpdir copy of UsersController.cs) yields `auth_mechanism='session'`
- Test E: bare fixture returns `{ auth_mechanism: null, db_backend: null }`

Regression tests — no failures:
- `auth-db-extractor.java.test.js` — 5/5 pass (Plan 94-01 unchanged)
- `auth-db-extractor.test.js` — 35/35 pass (python/js/ts/go/rust unchanged)

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written, with one minor implementation note:

**Test D fixture isolation (approach clarified, not a bug)**
- **Plan said:** "use the main fixture but delete Program.cs at test setup time"
- **Implemented as:** `before()` hook creates a `tmpdir` copy containing only `Controllers/UsersController.cs`, then `after()` removes it. This achieves the same isolation without mutating the shared fixture directory, which would be fragile if tests run concurrently.
- **Outcome:** Test D passes correctly, fixture remains intact.

## TDD Gate Compliance

- RED commit: `7d60ba8` — `test(94-02): add failing C# auth/db fixture + e2e test (ENR-09 csharp)`
- GREEN commit: `e8b341c` — `feat(94-02): add C# auth/db signals + 'obj' + 'bin' in EXCLUDED_DIRS`

Both gates present. No REFACTOR pass needed.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes introduced.

## Self-Check: PASSED

Files verified present:
- `plugins/arcanon/worker/scan/enrichment/auth-db-extractor.js` (modified — csharp entries + obj/bin)
- `auth-db-extractor.csharp.test.js` (created)
- `fixtures/csharp/Program.cs`, `AppDbContext.cs`, `Controllers/UsersController.cs`, `appsettings.json`, `Api.csproj`
- `fixtures/csharp/obj/Debug/net8.0/Api.AssemblyInfo.cs`, `fixtures/csharp/bin/Debug/net8.0/GeneratedStub.cs`
- `fixtures/csharp-identity/Program.cs`, `fixtures/csharp-identity/AppDbContext.cs`
- `fixtures/csharp-empty/obj/Debug/Fake.cs`
- `fixtures/csharp-bare/SomeFile.cs`

Commits verified: 7d60ba8 (RED), e8b341c (GREEN)
