// Single source of truth for platform display — labels, glyphs and badge
// styling. Cronsole-native tasks get a distinct violet identity so they're
// immediately separable from platform-synced tasks (docs/resources/Native_Tasks.md).
import {
  Activity, Bot, Cpu, FileCode, GitBranch, Globe, Laptop, Monitor, Terminal, Triangle, Zap,
  type LucideIcon
} from 'lucide-react';

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
    VERCEL_CRON: 'Vercel'
  }[p] ?? p.split('_')[0]);

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
    VERCEL_CRON: 'Vercel Cron'
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
  }[key] ?? platformSourceLabel(key.split(':')[0]));

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
      'Cron jobs declared by the Vercel projects you watch. Read-only, and Vercel publishes no run history for them — Cronsole shows their schedules, never how they went.'
  };
  return exact[key] ?? exact[key.split(':')[0]] ?? null;
};

/** Which platform a source key belongs to — for identity colour and icons. */
export const sourcePlatform = (key: string) => key.split(':')[0];

export const platformBadgeClass = (p: string) =>
  ({
    WINDOWS_TASK_SCHEDULER: 'bg-primary/10 text-foreground border-primary/20',
    TASKHUB_NATIVE: 'bg-native/10 text-native-text border-native/30',
    CLAUDE_CODE: 'bg-claude/10 text-claude-text border-claude/20',
    CHATGPT: 'bg-chatgpt/10 text-chatgpt-text border-chatgpt/20',
    GITHUB_ACTIONS: 'bg-github/10 text-github-text border-github/30',
    VERCEL_CRON: 'bg-vercel/10 text-vercel-text border-vercel/30'
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
 */
const SOURCE_ICON: Record<string, LucideIcon> = {
  WINDOWS_TASK_SCHEDULER: Monitor,
  MACOS_LAUNCHD: Laptop,
  'TASKHUB_NATIVE:HTTP': Globe,
  'TASKHUB_NATIVE:EXEC': Terminal,
  // A stored script reads as a document; a check reads as a measurement. Both
  // are deliberately unlike Terminal, since the three sit adjacent in the tree
  // and a shared glyph would make the level-2 rows scan as one thing.
  'TASKHUB_NATIVE:SCRIPT': FileCode,
  'TASKHUB_NATIVE:CHECK': Activity,
  TASKHUB_NATIVE: Zap,
  CLAUDE_CODE: Bot,
  CHATGPT: Cpu,
  // lucide dropped its brand glyphs at v1, so there is no Octocat to reach for.
  // A branch is the honest second choice: what Cronsole reads here is a workflow
  // living in a repository, not the service's logo.
  GITHUB_ACTIONS: GitBranch,
  // Vercel's mark is a triangle, and lucide has one that is not a brand glyph —
  // so unlike GitHub this is the shape the user already associates with the
  // platform rather than a second choice. Outline, not filled: the tile behind
  // it carries the identity colour, and a solid triangle at this size reads as
  // a warning sign.
  VERCEL_CRON: Triangle
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
export const platformAccent = (p: string): { tile: string; rule: string } =>
  ({
    WINDOWS_TASK_SCHEDULER: { tile: 'bg-primary/10 text-foreground', rule: 'bg-primary/40' },
    TASKHUB_NATIVE: { tile: 'bg-native/10 text-native-text', rule: 'bg-native/40' },
    CLAUDE_CODE: { tile: 'bg-claude/10 text-claude-text', rule: 'bg-claude/40' },
    CHATGPT: { tile: 'bg-chatgpt/10 text-chatgpt-text', rule: 'bg-chatgpt/40' },
    GITHUB_ACTIONS: { tile: 'bg-github/10 text-github-text', rule: 'bg-github/40' },
    VERCEL_CRON: { tile: 'bg-vercel/10 text-vercel-text', rule: 'bg-vercel/40' }
  }[p] ?? { tile: 'bg-muted text-muted-foreground', rule: 'bg-border' });

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
    }
  }[p] ?? { hasPanel: false, hint: 'Nothing to connect here yet.' });
