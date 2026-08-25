#!/usr/bin/env node
/**
 * **Is the running database actually on the schema this checkout describes?**
 *
 * The fifth thing that runs stale, and until 2026-08-25 the only one with no
 * keeper. The other four announce themselves eventually — a route 404s, an agent
 * command times out, a tool behaves like last week's code. A pending migration
 * does something worse: it produces a **generic 500 with nothing in it**, on
 * every route touching the new value, including the read ones.
 *
 * The Gemini connector shipped with a migration adding `GEMINI_TRIGGERS` to the
 * `PlatformType` enum. The migration was committed and never applied, so the
 * first query naming that value — the `findFirst` every one of its routes opens
 * with — failed in Postgres as `invalid input value for enum`, which Prisma
 * throws and the error handler renders as `{"error":"Internal server error"}`.
 * Adding the source and pasting a valid API key answered that, and so did the
 * card behind it, which made a perfectly good credential look like the problem
 * ([#81](../docs/troubleshooting/README.md)).
 *
 * **Nothing in the repo could see it.** `schema.prisma` has the value, the
 * generated client has the value, `tsc` is happy, and the test suite stubs the
 * client — so the one place the value was missing is the one place no check
 * looked. That asymmetry is the whole argument for this script: it is the only
 * check here that asks the *database* rather than the working tree.
 *
 * Read-only. It runs `prisma migrate status`, which applies nothing.
 *
 * Exit codes: 0 = up to date, 1 = migrations pending (the actionable case),
 * 2 = could not tell (no database reachable, no CLI) — deliberately distinct,
 * because "the schema is behind" and "I could not ask" must not look the same.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const backend = join(repoRoot, 'backend');

if (!existsSync(join(backend, 'prisma', 'schema.prisma'))) {
  console.log('check-migrations-applied: SKIP — no backend/prisma/schema.prisma here.');
  process.exit(2);
}

const result = spawnSync('npx', ['prisma', 'migrate', 'status'], {
  cwd: backend,
  encoding: 'utf8',
  shell: process.platform === 'win32',
  timeout: 60_000
});

const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

// Unreachable database, missing CLI, timeout — all "could not tell". Reporting
// that as a pass would make this check worse than useless: it would go quiet in
// exactly the situation where a developer most wants an answer.
if (result.error || (!result.stdout && !result.stderr)) {
  console.log(`check-migrations-applied: UNKNOWN — could not run prisma migrate status (${result.error?.message ?? 'no output'}).`);
  process.exit(2);
}
if (/P1001|Can't reach database server|Environment variable not found/i.test(output)) {
  console.log('check-migrations-applied: UNKNOWN — no database reachable, so the schema cannot be compared.');
  console.log('  Start the stack (`docker compose up -d db`) and run this again.');
  process.exit(2);
}

// Prisma phrases this a few ways across versions; match the fact, not one string.
const pending = /following migrations? have not yet been applied|Database schema is not up to date|migrations? found in prisma\/migrations.*not yet been applied/is.test(output);

if (pending) {
  const names = [...output.matchAll(/^\s*(\d{14}_[a-z0-9_]+)\s*$/gim)].map(m => m[1]);
  console.log('check-migrations-applied: PENDING — the running database is behind this checkout.');
  for (const name of names) console.log(`  unapplied  ${name}`);
  console.log('');
  console.log('  This is invisible to every other check: schema.prisma, the generated client and');
  console.log('  the test suite all have the new values, so only the database disagrees. A new');
  console.log('  enum value (a platform, a status, a job type) will 500 EVERY route that names');
  console.log('  it, including reads, with a bare "Internal server error".');
  console.log('');
  console.log('  Fix:  cd backend && npx prisma migrate deploy');
  process.exit(1);
}

console.log('check-migrations-applied: OK — the database schema matches this checkout.');
process.exit(0);
