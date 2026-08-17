#!/usr/bin/env node
/**
 * Fail if any markdown file links to a file or heading that does not exist.
 *
 * Why this exists: a stale doc link **does not fail**. Rename a heading and
 * GitHub still serves the page — scrolled to the top, no error anywhere — so a
 * sentence promising *"see Removing a task"* quietly starts delivering the table
 * of contents. Nothing throws, no test reddens, and the only person who finds
 * out is whoever needed the answer. That is CLAUDE.md §11a's drift, in the one
 * form that can be mechanized completely.
 *
 * It has already rotted: the TaskHub → Cronsole rename (2026-07-31) renamed
 * three troubleshooting headings and left **13** links across CHANGELOG and
 * troubleshooting pointing at the old slugs. They sat dead until 2026-08-17,
 * through every green CI run in between, because nothing checked doc → doc.
 *
 * **Scope, and what already covers the rest.**
 * `frontend/src/data/__tests__/docsLinks.test.ts` checks links the *app* sends
 * users to (`help.ts`, `onboarding.ts`) and is staying — it runs in the frontend
 * project against `?raw` imports, so a deleted doc fails its module graph. This
 * script checks links *between markdown files*, which that test cannot see. The
 * two are complementary; neither subsumes the other.
 *
 * Checked, for every tracked (or untracked-but-not-ignored) `.md` file:
 *   - `[x](path/to/file.md)`      → the path exists
 *   - `[x](path/to/file.md#frag)` → the path exists AND has that anchor
 *   - `[x](#frag)`                → this file has that anchor
 *   - `<a href="...">`            → same rules
 *
 * Not checked: external URLs (`http(s)://`, `mailto:`) — reachability is a
 * network fact, not a repo fact, and a link checker that needs the internet is
 * one that gets disabled the first time a site rate-limits CI.
 *
 * Usage: `node scripts/check-doc-links.mjs` (exit 1 on any finding).
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';

/**
 * Paths deliberately absent from a clone.
 *
 * `docs/archive/` and `docs/local/` are gitignored by design (CLAUDE.md §4), so
 * a link to them is correct *and* unresolvable here. Keep this list SHORT — every
 * entry is a hole, and the failure mode it hides is a link nobody can follow.
 */
const ABSENT_BY_DESIGN = ['docs/archive/', 'docs/local/', '.mcp.json'];

/** GitHub's heading → anchor slug. */
const slug = (heading) =>
  heading
    .trim()
    .toLowerCase()
    // One pass, and `_` MUST survive it. An earlier version stripped ``*_~``
    // first as "markdown markers", which also ate the underscore inside
    // `run_task` and `MODULE_NOT_FOUND` — GitHub keeps those, because `_` is a
    // word character and only reads as emphasis when it delimits. That alone
    // produced 21 false failures. `[^\w\s-]` already removes backticks, `*` and
    // `~` (none are word characters), so the extra pass bought nothing and cost
    // correctness. Same single expression the frontend's docsLinks test uses.
    .replace(/[^\w\s-]/g, '')
    // Each whitespace character, NOT runs of them — GitHub does not collapse.
    // Removing an em dash from "Removing a task — two buttons" leaves two
    // spaces, so the real anchor carries two hyphens. Collapsing here would
    // declare correct links broken, which is how a checker loses its audience.
    .replace(/\s/g, '-');

/**
 * Blank out fenced code blocks, preserving line numbers.
 *
 * A fenced example may legitimately contain a path that does not exist (`cd
 * /tmp/gallery`) or a `# heading`-looking comment. Scanning those produces
 * failures nobody can fix, and a checker with unfixable failures gets skipped.
 */
const stripFences = (md) =>
  md.replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, (m) => m.replace(/[^\n]/g, ' '));

/**
 * Also blank inline code spans. **Used for links only, never for headings.**
 *
 * The distinction is load-bearing and got this script wrong on its first run:
 * GitHub *keeps* a code span's text in the anchor, so `## 13. The \`cronsole\`
 * MCP tools…` slugs to `13-the-cronsole-mcp-tools…`. Blanking the span first
 * turns that into a run of spaces and a dozen stray hyphens, which reported 147
 * correct links as broken — a checker whose own bug is indistinguishable from
 * the drift it hunts, and the fastest way to have it switched off.
 *
 * For link *targets* the opposite is right: `` `[x](y)` `` renders as literal
 * text, not a link.
 */
const stripCodeAndFences = (md) =>
  stripFences(md).replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));

/**
 * Every anchor a markdown file offers.
 *
 * Headings **and** explicit HTML anchors: this repo's troubleshooting log ends
 * each entry with a `back to top` link pointing at `<a id="troubleshooting-top">`,
 * which no heading produces. Collecting only headings would report every one of
 * those as dead — the false-positive flood that trains people to ignore a check.
 *
 * Repeated headings get GitHub's `-1`, `-2` disambiguators, in document order.
 */
const anchorsIn = (md) => {
  const seen = new Map();
  const anchors = new Set();
  // Fences only — inline code stays, because GitHub keeps it in the anchor.
  for (const line of stripFences(md).split(/\r?\n/)) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      const base = slug(heading[1]);
      if (!base) continue;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      anchors.add(n === 0 ? base : `${base}-${n}`);
    }
  }
  // HTML anchors are read from the RAW markdown: they are frequently written
  // inside the same lines as prose and are not code.
  for (const m of md.matchAll(/<a[^>]*\s(?:name|id)=["']([^"']+)["']/gi)) anchors.add(m[1]);
  for (const m of md.matchAll(/<[^>]*\sid=["']([^"']+)["']/gi)) anchors.add(m[1]);
  return anchors;
};

/** Every link target in a markdown file, with the line it sits on. */
const linksIn = (md) => {
  const out = [];
  const lines = stripCodeAndFences(md).split(/\r?\n/);
  lines.forEach((line, i) => {
    // `](target)` and `href="target"`. Deliberately simple: these docs do not
    // use nested-paren targets, and a greedier pattern costs more in false
    // positives than it buys.
    for (const m of line.matchAll(/\]\(\s*<?([^)>\s]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
      out.push({ target: m[1], line: i + 1 });
    }
    for (const m of line.matchAll(/<a[^>]*\shref=["']([^"']+)["']/gi)) {
      out.push({ target: m[1], line: i + 1 });
    }
  });
  return out;
};

const files = execSync('git ls-files --cached --others --exclude-standard', { maxBuffer: 1 << 28 })
  .toString()
  .split('\n')
  .filter(Boolean)
  .map((f) => f.replace(/\\/g, '/'));

const known = new Set(files);
/** A link may point at a directory; treat one as real if it holds a known file. */
const knownDirs = new Set();
for (const f of files) {
  const parts = f.split('/');
  for (let i = 1; i < parts.length; i++) knownDirs.add(parts.slice(0, i).join('/') + '/');
}

const markdown = files.filter((f) => f.toLowerCase().endsWith('.md'));
/** Anchors are parsed once per file — several docs are linked from many others. */
const anchorCache = new Map();
const anchorsFor = (path) => {
  if (!anchorCache.has(path)) {
    try {
      anchorCache.set(path, anchorsIn(readFileSync(path, 'utf8')));
    } catch {
      anchorCache.set(path, null);
    }
  }
  return anchorCache.get(path);
};

const findings = [];
let checked = 0;

for (const file of markdown) {
  let source;
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const dir = posix.dirname(file);

  for (const { target, line } of linksIn(source)) {
    if (/^(https?:|mailto:|tel:|data:)/i.test(target)) continue;

    const hash = target.indexOf('#');
    const rawPath = hash < 0 ? target : target.slice(0, hash);
    const anchor = hash < 0 ? '' : decodeURIComponent(target.slice(hash + 1));
    if (!rawPath && !anchor) continue;

    // Same-file anchor.
    if (!rawPath) {
      checked++;
      if (!anchorsIn(source).has(anchor)) {
        findings.push({ file, line, target, why: `no heading or anchor #${anchor} in this file` });
      }
      continue;
    }

    const resolved = posix.normalize(posix.join(dir, decodeURIComponent(rawPath))).replace(/^\.\//, '');
    if (ABSENT_BY_DESIGN.some((p) => resolved === p.replace(/\/$/, '') || resolved.startsWith(p))) continue;

    checked++;
    // `posix.normalize` preserves a trailing slash, so a link written as
    // `user-guides/guides/` must be compared without one before the `+ '/'`
    // directory lookup — otherwise every directory link fails on a `//`.
    const bare = resolved.replace(/\/+$/, '');
    const isDir = knownDirs.has(bare + '/');
    if (!known.has(bare) && !isDir) {
      findings.push({ file, line, target, why: `${resolved} does not exist` });
      continue;
    }

    if (anchor && bare.toLowerCase().endsWith(".md")) {
      const anchors = anchorsFor(bare);
      if (anchors && !anchors.has(anchor)) {
        findings.push({ file, line, target, why: `${resolved} has no anchor #${anchor}` });
      }
    }
  }
}

if (findings.length === 0) {
  console.log(
    `check-doc-links: OK — ${checked} relative link(s) across ${markdown.length} markdown files resolve.`
  );
  process.exit(0);
}

console.error(`check-doc-links: FAILED — ${findings.length} broken link(s):\n`);
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}  [${f.target}]\n      ${f.why}`);
}
console.error(
  '\nA broken doc link does not 404 — GitHub serves the page scrolled to the top, so the\n' +
  'reader silently gets the wrong section. Fix the target, or if the heading moved, update\n' +
  'every link to it (this is what the TaskHub rename missed in 13 places). A path that is\n' +
  'gitignored by design belongs in ABSENT_BY_DESIGN in this script.'
);
process.exit(1);
