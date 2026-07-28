/**
 * Compile `connect-pack/` into `connectPackBundled.ts`.
 *
 * Run: `npm run connectpack:build`
 *
 * Why generate instead of reading the files at runtime: `tsc` emits only `.js`,
 * so `.md` files under `src/` never reach `dist/`. A route that read them from
 * disk would work under `tsx` in dev and 404 in production — a fourth thing that
 * runs stale, and the worst kind, because dev would look fine.
 *
 * Same reasoning (and same shape) as the template catalog's bundled snapshot.
 * `connectPack.drift.test.ts` fails if the generated file and these sources
 * disagree, so editing the markdown without regenerating cannot pass CI.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, relative } from 'path';

const SOURCE_DIR = fileURLToPath(new URL('./connect-pack', import.meta.url));
const OUTPUT_FILE = fileURLToPath(new URL('./connectPackBundled.ts', import.meta.url));

/** Every file under connect-pack/, as `/`-separated paths, sorted for stability. */
function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectFiles(full));
    } else {
      out.push(relative(SOURCE_DIR, full).split('\\').join('/'));
    }
  }
  return out.sort();
}

export function renderBundle(): string {
  const files = collectFiles(SOURCE_DIR);

  const entries = files
    .map(path => {
      // Normalize CRLF: the generated content is served byte-for-byte and hashed
      // by the drift test, so a checkout with different line endings must not
      // produce a different bundle.
      const content = readFileSync(join(SOURCE_DIR, path), 'utf8').replace(/\r\n/g, '\n');
      // JSON.stringify handles every escape — including the backticks that make
      // a template literal impossible for markdown containing code fences.
      return `  ${JSON.stringify(path)}: ${JSON.stringify(content)}`;
    })
    .join(',\n');

  return `/**
 * GENERATED FILE — do not edit.
 *
 * Source: src/tools/connect-pack/
 * Regenerate: npm run connectpack:build
 *
 * Bundled rather than read from disk because tsc emits only .js, so the markdown
 * sources never reach dist/. Guarded by connectPack.drift.test.ts.
 */

export const CONNECT_PACK_FILES: Record<string, string> = {
${entries}
};
`;
}

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntrypoint) {
  writeFileSync(OUTPUT_FILE, renderBundle(), 'utf8');
  console.log(`Wrote ${relative(process.cwd(), OUTPUT_FILE)} (${collectFiles(SOURCE_DIR).length} files).`);
}
