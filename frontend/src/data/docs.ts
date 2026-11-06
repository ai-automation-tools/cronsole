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
export const DOCS_BASE = 'https://github.com/ai-automation-tools/cronsole/blob/main';

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

/** Where the per-source guides live, relative to the repo root. */
export const SOURCE_GUIDES = 'docs/user-guides/sources';

/** The UI guide, which most topics point into. */
export const uiGuide = (anchor?: string) => docLink(`${GUIDES}/UI_User_Guide.md`, anchor);

/**
 * The sources overview: every source in one table, plus what is true of all of
 * them (what a source is, choosing which you see, quick links, adding one).
 *
 * Until 2026-11-06 this was `guides/Sources_Guide.md`, a second document that
 * repeated every per-source guide in shorter form, so each fact had two copies
 * to keep in step. It now points at the per-source folder's own index, and a
 * help topic about one source links to that source's document via `sourceDoc`.
 */
export const sourcesGuide = (anchor?: string) => docLink(`${SOURCE_GUIDES}/README.md`, anchor);

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
 * **Separate from `sourcesGuide`, which is the overview.** That page compares
 * every source in one table — the right thing to read when you are choosing
 * between them, and the wrong thing to land on when you have already chosen and
 * want to know how to connect *this one*.
 *
 * Keyed by `PlatformType` so a card can ask for its own document without
 * knowing the filename. **A platform with no entry gets `null`** and the card
 * renders no link — quick links have no connector and therefore nothing to
 * document, and a dead button is worse than an absent one.
 */
const SOURCE_DOCS = {
  WINDOWS_TASK_SCHEDULER: 'Windows_Task_Scheduler.md',
  TASKHUB_NATIVE: 'Cronsole_Native.md',
  CLAUDE_CODE: 'Claude_Code_Routines.md',
  GEMINI_TRIGGERS: 'Gemini_API_Triggers.md',
  GITHUB_ACTIONS: 'GitHub_Actions.md',
  VERCEL_CRON: 'Vercel_Cron.md',
  N8N: 'n8n.md'
} as const;

/** A platform that has a guide. Help topics name one of these, so their link can never be null. */
export type ShippedSource = keyof typeof SOURCE_DOCS;

/** Every source Cronsole ships, as `PlatformType` keys: the one list `docsLinks.test.ts` pins. */
export const SHIPPED_SOURCES = Object.keys(SOURCE_DOCS);

/** The deep-dive document for one platform, or `null` if it has none. */
export function sourceDoc(platform: ShippedSource, anchor?: string): string;
export function sourceDoc(platform: string, anchor?: string): string | null;
export function sourceDoc(platform: string, anchor?: string): string | null {
  const file = (SOURCE_DOCS as Record<string, string>)[platform];
  return file ? docLink(`${SOURCE_GUIDES}/${file}`, anchor) : null;
}
