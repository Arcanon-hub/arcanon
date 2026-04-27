#!/usr/bin/env node
/**
 * tests/fixtures/externals/seed-actors.js — Phase 121 Plan 02 (INT-09).
 *
 * Thin wrapper around the canonical Phase 114 list seeder
 * (tests/fixtures/list/seed.js). Exists to satisfy plan 121-02's
 * artifacts.contains: "INSERT INTO actors" expectation and to give the
 * tests/externals-labels.bats E2E suite a single, semantically-named
 * entry-point for seeding "1 repo + 1 service + N bare actors + 1 scan
 * version".
 *
 * Why a wrapper rather than a duplicate seed:
 *   - One source of truth for migration application + repo/service/scan
 *     scaffolding (the list seeder already does this correctly).
 *   - The bare-actors mode is just one of the modes already exposed by the
 *     list seeder via --actors-named-csv. This wrapper hides the verb so
 *     the bats test reads cleanly: `seed-actors.sh ... --actors stripe,custom`.
 *
 * Usage:
 *   node seed-actors.js --project <root> --db <db-path> --actors <csv>
 *
 * The --actors flag is forwarded as --actors-named-csv to seed.js.
 *
 * Schema covered (via the list seeder):
 *   - migrations 001-018 applied
 *   - INSERT INTO repos (3 rows)
 *   - INSERT INTO services (8 rows)
 *   - INSERT INTO scan_versions (1 row)
 *   - INSERT INTO actors (N rows, label NULL — labeling pass populates)
 *   - INSERT INTO actor_connections (N rows, one per actor)
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.project || !args.db || !args.actors) {
    process.stderr.write(
      'usage: node seed-actors.js --project <root> --db <db-path> --actors <name1,name2,...>\n',
    );
    process.exit(2);
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  // The list seeder lives one level up + fixtures/list/seed.js.
  const listSeed = path.resolve(here, '..', 'list', 'seed.js');
  const r = spawnSync(
    process.execPath,
    [
      listSeed,
      '--project', args.project,
      '--db', args.db,
      '--actors-named-csv', args.actors,
    ],
    { stdio: 'inherit' },
  );
  process.exit(r.status ?? 1);
}
