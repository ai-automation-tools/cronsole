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
 * (These point at the repo on GitHub, so they resolve for any reader. A rendered
 * docs site is still tracked in the Go-public checklist — GitHub's Markdown view
 * is the interim.)
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

/**
 * The per-source deep dive, one document per platform.
 *
 * **Separate from `sourcesGuide`, which is the comparison.** That guide is one
 * page covering all six side by side — the right thing to read when you are
 * choosing between them, and the wrong thing to land on when you have already
 * chosen and want to know how to connect *this one*. Anchoring into it put a
 * reader two-thirds of the way down a long page about five other sources, which
 * is the same failure that moved `addingASourceDoc` off it.
 *
 * Keyed by `PlatformType` so a card can ask for its own document without
 * knowing the filename. **A platform with no entry gets `null`** and the card
 * renders no link — quick links have no connector and therefore nothing to
 * document, and a dead button is worse than an absent one.
 */
const SOURCE_DOCS: Record<string, string> = {
  WINDOWS_TASK_SCHEDULER: 'Windows_Task_Scheduler.md',
  TASKHUB_NATIVE: 'Cronsole_Native.md',
  CLAUDE_CODE: 'Claude_Code_Routines.md',
  GEMINI_TRIGGERS: 'Gemini_API_Triggers.md',
  GITHUB_ACTIONS: 'GitHub_Actions.md',
  VERCEL_CRON: 'Vercel_Cron.md'
};

/** Where the per-source guides live, relative to the repo root. */
export const SOURCE_GUIDES = 'docs/user-guides/sources';

/** The deep-dive document for one platform, or `null` if it has none. */
export const sourceDoc = (platform: string): string | null => {
  const file = SOURCE_DOCS[platform];
  return file ? docLink(`${SOURCE_GUIDES}/${file}`) : null;
};

/** The index of the per-source guides — every source, in one place. */
export const sourceDocsIndex = () => docLink(`${SOURCE_GUIDES}/README.md`);
