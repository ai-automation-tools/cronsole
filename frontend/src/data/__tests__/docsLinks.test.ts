// Vite's `?raw` rather than node:fs — this file is compiled by tsconfig.app.json,
// whose `types` is `["vite/client"]`, so node builtins are not available here
// (and shouldn't be: it's the browser project). Same call as useTheme.test.tsx.
//
// It buys something beyond conformity: a doc that has been **deleted or moved**
// fails the import, so existence is checked by the module graph and only the
// anchors need asserting.
import uiUserGuide from '../../../../docs/user-guides/guides/UI_User_Guide.md?raw';
import sourcesGuideDoc from '../../../../docs/user-guides/guides/Sources_Guide.md?raw';
import agentSetupGuide from '../../../../docs/user-guides/guides/Agent_Setup_Guide.md?raw';
import templatesDoc from '../../../../docs/reports/templates/Templates.md?raw';
import troubleshooting from '../../../../docs/troubleshooting/README.md?raw';
import adrPerJobSecrets from '../../../../docs/adr/0003-per-job-secrets.md?raw';
import remoteAccessGuide from '../../../../docs/user-guides/guides/Remote_Access_Guide.md?raw';
import addingASource from '../../../../docs/contributing/Adding_A_Source.md?raw';

import { describe, it, expect } from 'vitest';
import { DOCS_BASE, addingASourceDoc } from '../docs';
import { helpTopics } from '../help';
import { GETTING_STARTED_STEPS, HELP_GUIDES } from '../onboarding';

/**
 * **Every in-app doc link resolves to a real file and a real heading.**
 *
 * This exists because of how a stale doc link fails: it doesn't. Rename a
 * heading and GitHub still serves the page — just scrolled to the top, with no
 * error anywhere — so a `?` button that promised *"Read the full docs › Removing
 * a task"* quietly starts delivering the table of contents. Nothing throws,
 * nothing renders differently, and the only person who finds out is the user who
 * needed the answer.
 *
 * That is the same class of drift `/sync-surfaces` exists for (CLAUDE.md §11a):
 * a surface that *describes* the repo rather than being compiled against it. The
 * difference is that this one can be mechanized completely, so it is.
 *
 * A repo link to a doc **not in `DOC_SOURCES` below fails** rather than being
 * skipped. Skipping unknown paths is how a checker ends up checking nothing:
 * the one link nobody remembered to wire up is exactly the one that rots.
 */

/** The docs the app deep-links into, keyed by the repo-relative path in the URL. */
const DOC_SOURCES: Record<string, string> = {
  'docs/user-guides/guides/UI_User_Guide.md': uiUserGuide,
  'docs/user-guides/guides/Sources_Guide.md': sourcesGuideDoc,
  'docs/user-guides/guides/Agent_Setup_Guide.md': agentSetupGuide,
  'docs/reports/templates/Templates.md': templatesDoc,
  'docs/troubleshooting/README.md': troubleshooting,
  'docs/adr/0003-per-job-secrets.md': adrPerJobSecrets,
  'docs/user-guides/guides/Remote_Access_Guide.md': remoteAccessGuide,
  'docs/contributing/Adding_A_Source.md': addingASource
};

/**
 * GitHub's heading → anchor slug: lowercase, drop punctuation other than `-`
 * and `_`, then whitespace to hyphens.
 *
 * Reimplemented rather than imported because the app never needs it — the
 * anchors are hand-written in `help.ts`, and this is what proves they are right.
 */
const slug = (heading: string) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    // Each whitespace character, NOT runs of them. GitHub does not collapse:
    // dropping the em dash from "Removing a task — two buttons" leaves two
    // spaces, so the real anchor has two hyphens. Collapsing here would have
    // quietly declared five correct links broken.
    .replace(/\s/g, '-');

/** Every `#`-heading anchor a markdown source offers. */
const anchorsIn = (markdown: string): string[] =>
  // `\r?\n`: these files are CRLF, and `.` does not match `\r`, so splitting on
  // `\n` alone leaves a trailing CR that makes `$` fail and yields zero anchors.
  // Silently zero — which would have made this whole test a tautology.
  markdown
    .split(/\r?\n/)
    .map(line => /^#{1,6}\s+(.*)$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map(m => slug(m[1]));

/** Every link the app can send a user to, with where it came from. */
const links: { from: string; label: string; url: string }[] = [
  ...helpTopics().flatMap(topic => [
    { from: `topic "${topic.id}"`, label: topic.doc.label, url: topic.doc.url },
    ...(topic.more ?? []).map(l => ({ from: `topic "${topic.id}" › more`, label: l.label, url: l.url }))
  ]),
  ...GETTING_STARTED_STEPS.filter(s => s.link).map(s => ({
    from: `getting-started "${s.title}"`,
    label: s.link!.label,
    url: s.link!.url
  })),
  ...HELP_GUIDES.map(g => ({ from: 'Help Center guides', label: g.label, url: g.url })),
  // Not a `HelpTopic`, so none of the collectors above sees it — and a link the
  // matrix cannot see is exactly the one that rots, which is this file's whole
  // premise. `AddCustomSourcePanel` is the only component that deep-links into
  // the repo on its own rather than through `help.ts`; if a second ever does,
  // the honest fix is to collect them rather than to add a second line here.
  {
    from: 'AddCustomSourcePanel',
    label: 'Adding a source',
    url: addingASourceDoc()
  }
];

describe('in-app documentation links', () => {
  it('has links to check', () => {
    // A silently-empty matrix would make every `it.each` below pass by vacuum,
    // which is the one way this test could become decoration.
    expect(links.length).toBeGreaterThan(20);
  });

  it.each(links)('$from → $label', ({ url }) => {
    expect(url).toMatch(/^https:\/\//);

    if (!url.startsWith(DOCS_BASE)) return; // external reference — not ours to resolve

    const [path, anchor] = url.slice(DOCS_BASE.length + 1).split('#');
    const markdown = DOC_SOURCES[path];
    expect(
      markdown,
      `${path} is linked from the app but not imported in this test — add it to DOC_SOURCES`
    ).toBeDefined();

    if (anchor) {
      expect(anchorsIn(markdown), `${path} has no heading whose anchor is #${anchor}`).toContain(anchor);
    }
  });
});

describe('help topics', () => {
  it('every topic carries a doc link', () => {
    // The rule that keeps a popover a summary. A topic with nowhere to point is
    // one explaining something undocumented, and the fix is a doc — not a longer
    // popover that becomes the only place a rule is written down.
    for (const topic of helpTopics()) {
      expect(topic.doc.url, `topic "${topic.id}" has no doc`).toBeTruthy();
      expect(topic.doc.label, `topic "${topic.id}" has an unlabelled doc`).toBeTruthy();
    }
  });

  it('every topic says something specific', () => {
    for (const topic of helpTopics()) {
      expect(topic.points.length, `topic "${topic.id}" has no points`).toBeGreaterThanOrEqual(3);
      expect(topic.summary.length).toBeGreaterThan(40);
    }
  });

  it('ids are unique', () => {
    const ids = helpTopics().map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
