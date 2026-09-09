// Single source of truth for platform display — labels, glyphs and badge
// styling. Cronsole-native tasks get a distinct violet identity so they're
// immediately separable from platform-synced tasks (docs/resources/Native_Tasks.md).
import {
  Activity, Cpu, FileCode, Globe, Monitor, Terminal, Zap,
  type LucideIcon
} from 'lucide-react';
import { AppleGlyph, ClaudeCodeGlyph, GitHubActionsGlyph, GoogleGeminiGlyph, VercelGlyph } from './components/sources/BrandIcons';

/**
 * A key that is safe to index *and* to split.
 *
 * **Every function in this file takes `string` and may still be handed
 * something else at runtime**, because these keys come out of a JSON payload
 * rather than out of TypeScript. `JSON.stringify` drops an undefined value
 * entirely, so a backend row whose `platform` was undefined arrives with the
 * field simply *missing* — and the type says `string` the whole way down.
 *
 * Indexing a lookup object with `undefined` is harmless (it misses, and the
 * `??` fallback runs). Calling `.split` on it is not, and that is what turned
 * one malformed row into a blank Sources screen. This makes the fallbacks
 * reachable, which is the only thing that makes them true.
 */
const asKey = (k: string | null | undefined): string => (typeof k === 'string' ? k : '');

/**
 * Which platform a source key belongs to — for identity colour and icons.
 *
 * **Total, like every other function in this file.** Each of its neighbours
 * already ends in a fallback — `sourceIcon` a globe, `platformAccent` muted,
 * `sourceLabel` the platform's own label — and each says why in its comment: *a
 * source added server-side before it is named here should still render as
 * something.* This one did not honour that: a bare `key.split(':')` on an absent
 * key threw before any of those fallbacks could run, and took down the entire
 * Sources screen with *Cannot read properties of undefined (reading 'split')*.
 *
 * The row that caused it carried no `platform` at all, which is a server defect
 * and is now caught at the server's own boot. But a presentation helper
 * crashing the page is a *second* defect rather than the same one — it puts the
 * stack trace two layers away from the cause.
 */
export const sourcePlatform = (key: string | null | undefined): string =>
  asKey(key).split(':')[0]!;

export const platformLabel = (p: string) =>
  ({
    WINDOWS_TASK_SCHEDULER: 'Windows',
    MACOS_LAUNCHD: 'macOS',
    CLAUDE_CODE: 'Claude',
    CHATGPT: 'ChatGPT',
    JULES: 'Jules',
    OPEN_CLAW: 'Open Claw',
    HERMES: 'Hermes',
    TASKHUB_NATIVE: 'Cronsole',
    GITHUB_ACTIONS: 'GitHub',
    VERCEL_CRON: 'Vercel',
    GEMINI_TRIGGERS: 'Gemini'
  }[p] ?? asKey(p).split('_')[0]!);

/**
 * The full name of a task's **source**, for the dashboard's source bar.
 *
 * Longer than `platformLabel` on purpose. A badge on a card sits beside the
 * task it describes and can afford "Windows"; a top-level axis is answering
 * *"where do these come from?"* before you have any context, and "Windows" vs
 * "Cronsole" does not tell a new user that one is their OS scheduler and the
 * other is Cronsole running the job itself.
 *
 * Falls back to `platformLabel` so a source added to `PlatformType` before it
 * is named here still renders as something, rather than a raw enum.
 */
export const platformSourceLabel = (p: string) =>
  ({
    WINDOWS_TASK_SCHEDULER: 'Windows Task Scheduler',
    MACOS_LAUNCHD: 'macOS (launchd)',
    CLAUDE_CODE: 'Claude Code',
    CHATGPT: 'ChatGPT',
    JULES: 'Jules',
    OPEN_CLAW: 'Open Claw',
    HERMES: 'Hermes',
    TASKHUB_NATIVE: 'Cronsole (Native)',
    GITHUB_ACTIONS: 'GitHub Actions',
    VERCEL_CRON: 'Vercel Cron',
    GEMINI_TRIGGERS: 'Gemini API Triggers'
  }[p] ?? platformLabel(p));

/**
 * The label for a **source** key — a platform, or a platform and a subtype.
 *
 * Sources are finer than platforms: Cronsole-native holds two genuinely
 * different kinds of task, and one bucket called "Cronsole" made the source
 * bar's most granular entry its least informative. Splitting happens here, in
 * presentation, and nowhere else — the connector, the capability matrix and
 * `PlatformConnection` all still see one platform, because native HTTP and
 * native scripts have identical capabilities and the same connection.
 *
 * An unknown subtype falls back to the platform's own label rather than showing
 * a raw key, so a source added server-side before it is named here still reads.
 */
export const sourceLabel = (key: string) =>
  ({
    'TASKHUB_NATIVE:HTTP': 'Cronsole (HTTP)',
    // `EXEC` was labelled "Scripts" until 2026-08-15, which promised more than
    // the type delivered: it runs a program that must **already exist** on the
    // backend host, and Cronsole never sees the script itself. The real
    // inline-body type now owns that name. Presentation only — no stored
    // `jobType`, source key, saved view or link changes.
    'TASKHUB_NATIVE:EXEC': 'Cronsole (Programs)',
    'TASKHUB_NATIVE:SCRIPT': 'Cronsole (Scripts)',
    'TASKHUB_NATIVE:CHECK': 'Cronsole (Checks)'
  }[key] ?? platformSourceLabel(sourcePlatform(key)));

/**
 * The label for a source's **subtype alone**, for a level-2 row in the source
 * rail.
 *
 * `sourceLabel` names the whole source ("Cronsole (Scripts)"), which is right for
 * a flat control where nothing else supplies the context. In the rail the parent
 * row already says *Cronsole*, so repeating it in the child spends the width the
 * tree exists to buy and makes two rows that read almost identically. A key with
 * no subtype falls back to the full source label — the honest answer when the
 * source is not subdivided.
 */
export const sourceSubtypeLabel = (key: string) =>
  ({
    'TASKHUB_NATIVE:HTTP': 'HTTP jobs',
    'TASKHUB_NATIVE:EXEC': 'Programs',
    'TASKHUB_NATIVE:SCRIPT': 'Scripts',
    'TASKHUB_NATIVE:CHECK': 'Checks'
  }[key] ?? sourceLabel(key));

/**
 * One sentence saying what a source **is**, for the dashboard's main pane.
 *
 * The rail and the breadcrumb name the scope; neither says what the scope *means*,
 * and a level-2 row reading "Checks" over an empty list is a destination with no
 * explanation of why you would put anything in it. The rail deliberately lists
 * job types that hold nothing yet — the empty ones are exactly the ones a user has
 * never used and most needs a sentence for.
 *
 * **This is a summary, never the documentation.** It is one line; the `?` beside
 * it opens the matching `HelpTopic`, which links to the Sources Guide. Same rule
 * `help.ts` holds itself to — a control may summarise a doc, but must never
 * quietly become the only place a rule is written down.
 *
 * Degrades key → platform → nothing, mirroring `sourceLabel` and `sourceTopicId`:
 * a source added server-side before it is described here renders no blurb rather
 * than a wrong one.
 */
export const sourceDescription = (key: string): string | null => {
  const exact: Record<string, string> = {
    'TASKHUB_NATIVE:HTTP':
      'Cronsole calls a URL on your schedule — webhooks, deploy hooks, keeping something warm. Success means the endpoint accepted the request.',
    'TASKHUB_NATIVE:EXEC':
      'Cronsole runs a program that already exists on the machine the backend runs on, and records its exit code, duration and output. No shell unless you name one.',
    'TASKHUB_NATIVE:SCRIPT':
      'Cronsole stores the script itself and runs it under an interpreter you pick — nothing has to exist on disk first, and you can read and edit the body here.',
    'TASKHUB_NATIVE:CHECK':
      'Cronsole measures something and compares it to what you expect — an endpoint, a port, a file that should still be fresh, free disk space. A failure here is a fact about your system, not a bug in a script.',
    WINDOWS_TASK_SCHEDULER:
      'Real Task Scheduler entries on your machine, read and controlled through the Cronsole agent. They keep running whether or not Cronsole is up.',
    TASKHUB_NATIVE:
      'Scheduled and executed by Cronsole itself. Nothing appears in Windows Task Scheduler and no agent is involved — but these only run while the Cronsole backend is running.',
    CLAUDE_CODE:
      'Prompts Anthropic runs on a schedule in the cloud. What Cronsole can do here depends on whether this machine has a Claude Code session it can read.',
    // The one source whose sentence leads with what Cronsole will not do,
    // because that is the surprising half: every other row here can be acted on,
    // so a screen of `unsupported` cells with no explanation reads as a broken
    // connection rather than as the shape of the integration.
    GITHUB_ACTIONS:
      'Scheduled workflows in the repositories you watch. Read-only — Cronsole shows their crons and how their last runs actually went, and changes nothing.',
    // The second read-only row, and its sentence has to do one more job than
    // GitHub's: say what this observer cannot report *that the other one can*.
    // Vercel publishes no run history for a cron, so every row here sits at
    // `unknown` health forever — a user comparing two read-only sources should
    // learn that here rather than infer it from a grey pill.
    VERCEL_CRON:
      'Cron jobs declared by the Vercel projects you watch. Read-only, and Vercel publishes no run history for them — Cronsole shows their schedules, never how they went.',
    // The first hosted source whose sentence leads with what Cronsole *does*,
    // which is the opposite of the two above it — and it has to, because a
    // reader who has learned "hosted means read-only" from those two would
    // carry that assumption here and never press a button that works.
    GEMINI_TRIGGERS:
      'Scheduled prompts Google runs on its own agents in the cloud. Cronsole runs, pauses, reschedules, creates and deletes them, and reads how their last runs actually went.'
  };
  return exact[key] ?? exact[sourcePlatform(key)] ?? null;
};

export const platformBadgeClass = (p: string) =>
  ({
    WINDOWS_TASK_SCHEDULER: 'bg-primary/10 text-foreground border-primary/20',
    TASKHUB_NATIVE: 'bg-native/10 text-native-text border-native/30',
    CLAUDE_CODE: 'bg-claude/10 text-claude-text border-claude/20',
    CHATGPT: 'bg-chatgpt/10 text-chatgpt-text border-chatgpt/20',
    GITHUB_ACTIONS: 'bg-github/10 text-github-text border-github/30',
    VERCEL_CRON: 'bg-vercel/10 text-vercel-text border-vercel/30',
    GEMINI_TRIGGERS: 'bg-gemini/10 text-gemini-text border-gemini/30'
  }[p] ?? 'bg-muted/10 text-muted-foreground border-border/20');

export const isNativePlatform = (p: string) => p === 'TASKHUB_NATIVE';

// Which platforms Cronsole can CREATE a task on used to be a constant here —
// `new Set(['WINDOWS_TASK_SCHEDULER', 'TASKHUB_NATIVE'])`, with a comment
// calling Claude "an experimental scaffold not wired for creation".
//
// **It is not a constant, and it never was one about this app** (removed
// 2026-08-13). For Claude the answer is a property of the *install*: with a
// readable Claude Code session the connector creates routines, without one
// `create` is a boundary — so no literal compiled into this bundle can be right
// in both cases. The server already computes it, per user, with the evidence
// behind it: `GET /api/tools/platforms`. Read it through
// `usePlatformCreatability()` in `hooks/usePlatformMatrix.ts`.
//
// Same rule as `isSystem` and the Failures tier: **the server sends a verdict,
// the browser renders it.** A second copy in the browser is the drift that took
// a whole folder out of every sync (troubleshooting #20a) — and this copy had
// already gone wrong in both directions inside two days.

/**
 * Icon per source key, then per platform, then a globe.
 *
 * Keyed on the full source key first so a subtype can differ from its platform —
 * a native HTTP job and a native script are the same platform and should not
 * look identical in the one control that separates them.
 *
 * **Hoisted out of `SourceRail` on 2026-08-24**, when the Sources tab needed the
 * same glyphs for its cards. Two private maps of one fact is the §11a shape: the
 * rail and the Sources tab would have drifted into drawing the same platform two
 * ways, and neither would have failed a test while doing it.
 *
 * **Real brand marks where one is safe to reach for** (2026-09-05,
 * `BrandIcons.tsx`) — GitHub Actions, Vercel, Claude Code, Google Gemini and
 * Apple (for macOS) each get their actual glyph instead of a lucide
 * approximation, because a user scanning this tab for "which service is
 * this" already has the real mark memorized from every other place they meet
 * it. **Windows and ChatGPT keep their lucide stand-ins** — Microsoft's and
 * OpenAI's marks are the two simple-icons does not offer, which reads as a
 * trademark-enforcement removal rather than a gap in the catalog, so hand-drawing
 * either here would carry the same risk the removal exists to avoid. Cronsole's
 * own row (`TASKHUB_NATIVE`) keeps `Zap` rather than the app's own multi-colour
 * favicon: every other glyph in this map is one flat shape, and the favicon is a
 * small dark scene with its own background — dropping it in would be the one
 * tile that stops matching its neighbours.
 *
 * The five brand glyphs render in the brand's own real colour, not the tile's
 * accent — see `BrandIcons.tsx` for why that is the one place in this codebase
 * a hardcoded colour is the correct choice rather than the violation §9 warns
 * against.
 */
const SOURCE_ICON: Record<string, LucideIcon> = {
  WINDOWS_TASK_SCHEDULER: Monitor,
  MACOS_LAUNCHD: AppleGlyph,
  'TASKHUB_NATIVE:HTTP': Globe,
  'TASKHUB_NATIVE:EXEC': Terminal,
  // A stored script reads as a document; a check reads as a measurement. Both
  // are deliberately unlike Terminal, since the three sit adjacent in the tree
  // and a shared glyph would make the level-2 rows scan as one thing.
  'TASKHUB_NATIVE:SCRIPT': FileCode,
  'TASKHUB_NATIVE:CHECK': Activity,
  TASKHUB_NATIVE: Zap,
  CLAUDE_CODE: ClaudeCodeGlyph,
  CHATGPT: Cpu,
  GITHUB_ACTIONS: GitHubActionsGlyph,
  VERCEL_CRON: VercelGlyph,
  GEMINI_TRIGGERS: GoogleGeminiGlyph
};

export const sourceIcon = (key: string): LucideIcon =>
  SOURCE_ICON[key] ?? SOURCE_ICON[sourcePlatform(key)] ?? Globe;

/**
 * A platform's identity colour, as the two classes a card actually needs.
 *
 * Identity, **not status** — the same distinction `--native` and `--system` are
 * kept apart for. A card's tile says *which* source this is; the health pill
 * beside it says how it is doing, and the two must never be read off one colour.
 *
 * Role tokens only (`bg-claude/10`, `text-claude-text`), never a raw Tailwind
 * palette utility — those are banned in `frontend/src` because a literal cannot
 * know which theme it is in, and light mode ends up wearing dark mode's colours.
 * Windows has no token of its own and uses `primary`, matching the badge it
 * already wears on every task card.
 */
const PLATFORM_ACCENT: Record<string, { tile: string; rule: string; glyph: string }> = {
  WINDOWS_TASK_SCHEDULER: {
    tile: 'bg-primary/10 text-foreground',
    rule: 'bg-primary/40',
    glyph: 'text-primary-text'
  },
  TASKHUB_NATIVE: {
    tile: 'bg-native/10 text-native-text',
    rule: 'bg-native/40',
    glyph: 'text-native-text'
  },
  CLAUDE_CODE: {
    tile: 'bg-claude/10 text-claude-text',
    rule: 'bg-claude/40',
    glyph: 'text-claude-text'
  },
  CHATGPT: {
    tile: 'bg-chatgpt/10 text-chatgpt-text',
    rule: 'bg-chatgpt/40',
    glyph: 'text-chatgpt-text'
  },
  GITHUB_ACTIONS: {
    tile: 'bg-github/10 text-github-text',
    rule: 'bg-github/40',
    glyph: 'text-github-text'
  },
  VERCEL_CRON: {
    tile: 'bg-vercel/10 text-vercel-text',
    rule: 'bg-vercel/40',
    glyph: 'text-vercel-text'
  },
  GEMINI_TRIGGERS: {
    tile: 'bg-gemini/10 text-gemini-text',
    rule: 'bg-gemini/40',
    glyph: 'text-gemini-text'
  }
};

const NO_ACCENT = {
  tile: 'bg-muted text-muted-foreground',
  rule: 'bg-border',
  glyph: 'text-muted-foreground'
};

export const platformAccent = (p: string): { tile: string; rule: string } =>
  PLATFORM_ACCENT[p] ?? NO_ACCENT;

/**
 * A platform's identity colour on a **bare glyph** — no tile behind it.
 *
 * The third face of `platformAccent`, and it exists because the rail dropped the
 * tile. A tile could carry identity in its *background* and leave the icon
 * neutral (`text-foreground` on Windows, above); with the tile gone the glyph is
 * the only thing left that can say which source a row is, so the colour moves
 * onto it. Same table, so a platform cannot be violet on a card and grey here.
 *
 * The `-text` half of the pair, never the accent: this is drawn on the page
 * background, which is the flip a raw utility cannot express. It says *which*
 * source and never *how it is doing* — the health dot beside it owns that, and
 * reading both off one colour is the thing the two-token split exists to stop.
 */
export const sourceAccentGlyph = (key: string): string =>
  (PLATFORM_ACCENT[sourcePlatform(key)] ?? NO_ACCENT).glyph;

/**
 * What actually makes this source connect — for a card that says *Not connected*.
 *
 * The half-finished state used to render a full capability matrix of unproven
 * chips and the words "Not connected", which names the problem and offers
 * nothing. Two shapes of answer, and which one a platform gets is a real
 * difference rather than a gap in the copy:
 *
 *  - **Composed by hand** (Claude, GitHub) — there is a panel to fill in, so the
 *    card opens it. `hasPanel` is what the card branches on.
 *  - **Connects itself** (Windows, native) — nothing to type; the connection
 *    appears when the agent dials in or the backend comes up. Offering a
 *    *Connect* button here would be a control that cannot do what it says.
 *
 * Copy, not a judgement: `configured` is the server's and is never re-derived.
 */
export const sourceSetupHint = (p: string): { hasPanel: boolean; hint: string } =>
  ({
    WINDOWS_TASK_SCHEDULER: {
      hasPanel: false,
      hint: 'Connects itself once the Cronsole agent is installed and running on this machine. Nothing to fill in here — if it stays unconnected, the agent is the thing to check.'
    },
    TASKHUB_NATIVE: {
      hasPanel: false,
      hint: 'Connects itself whenever the Cronsole backend is running, because this database is its scheduler. If it reads unconnected, the backend is down.'
    },
    MACOS_LAUNCHD: {
      hasPanel: false,
      hint: 'Waiting on the macOS agent. Nothing to connect yet.'
    },
    CLAUDE_CODE: {
      hasPanel: true,
      hint: 'Anthropic issues a token per routine and publishes no way to list them, so each routine is registered here by hand.'
    },
    GITHUB_ACTIONS: {
      hasPanel: true,
      hint: 'Name the repositories to watch and Cronsole reads their scheduled workflows. Read-only — it changes nothing in the repository.'
    },
    VERCEL_CRON: {
      hasPanel: true,
      hint: 'Paste a Vercel access token and pick the projects to watch — Cronsole lists them for you, with how many cron jobs each has. Read-only: it changes nothing in the project.'
    },
    // The shortest hint of the three panelled sources, and the platform is the
    // reason: a Gemini API key is scoped to one Google Cloud project and sees
    // every trigger in it, so there is nothing to name, pick or watch. The
    // sentence says so rather than leaving someone hunting for the second step.
    GEMINI_TRIGGERS: {
      hasPanel: true,
      hint: 'Paste a Gemini API key. There is nothing else to pick — a key sees every trigger in its own Google Cloud project, and Cronsole can act on all of them.'
    }
  }[p] ?? { hasPanel: false, hint: 'Nothing to connect here yet.' });
