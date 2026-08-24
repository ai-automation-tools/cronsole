/**
 * Deep-links into the repo's own documentation.
 *
 * One definition, because there are now two callers (the Help Center's guide
 * list and every `?` button's topic) and a second copy of the base URL is a
 * second thing to forget when the deploy branch or the repo name changes — the
 * rename to `cronsole` already made that a real event rather than a hypothetical.
 *
 * **These links are a mirror surface.** They describe the docs rather than being
 * checked by them, so a renamed heading leaves a link that still resolves — to
 * the top of the page, silently, looking like it worked. `docs-links.test.ts`
 * resolves every one of them back to a real file and a real heading for exactly
 * that reason; see `frontend/src/data/__tests__/docsLinks.test.ts`.
 *
 * (The app repo is private today, so these open for the owner. Hosting the docs
 * for a public audience is tracked in the Go-public checklist.)
 */

/** Repo root on the deploy branch. */
export const DOCS_BASE = 'https://github.com/michaelschecht/cronsole/blob/main';

/** Where the user guides live, relative to the repo root. */
export const GUIDES = 'docs/user-guides/guides';

/**
 * A link to a doc, optionally to one heading inside it.
 *
 * `path` is repo-relative (`docs/…`) and `anchor` is the GitHub heading slug
 * **without** the `#`. Both halves are asserted by the test, so a typo here
 * fails the suite rather than shipping a `?` button that goes nowhere useful.
 */
export const docLink = (path: string, anchor?: string) =>
  `${DOCS_BASE}/${path}${anchor ? `#${anchor}` : ''}`;

/** The UI guide, which most topics point into. */
export const uiGuide = (anchor?: string) => docLink(`${GUIDES}/UI_User_Guide.md`, anchor);

/** The per-source guide — the target for every source-type help topic. */
export const sourcesGuide = (anchor?: string) => docLink(`${GUIDES}/Sources_Guide.md`, anchor);

/**
 * The contributor doc for writing a new connector.
 *
 * Deliberately **not** an anchor into the Sources Guide, which is where this
 * used to point. That guide is written for someone *using* Cronsole, so a
 * developer arriving with intent to build landed two-thirds of the way down a
 * long page about something else. The two audiences want different documents,
 * and the split is what lets each one stop hedging for the other.
 */
export const addingASourceDoc = () => docLink('docs/contributing/Adding_A_Source.md');
