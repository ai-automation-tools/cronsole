// Single source of truth for platform display — labels and badge styling.
// Cronsole-native tasks get a distinct violet identity so they're immediately
// separable from platform-synced tasks (docs/resources/Native_Tasks.md).

export const platformLabel = (p: string) =>
  ({
    WINDOWS_TASK_SCHEDULER: 'Windows',
    MACOS_LAUNCHD: 'macOS',
    CLAUDE_CODE: 'Claude',
    CHATGPT: 'ChatGPT',
    JULES: 'Jules',
    OPEN_CLAW: 'Open Claw',
    HERMES: 'Hermes',
    TASKHUB_NATIVE: 'Cronsole'
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
    TASKHUB_NATIVE: 'Cronsole (Native)'
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
      'Prompts Anthropic runs on a schedule in the cloud. What Cronsole can do here depends on whether this machine has a Claude Code session it can read.'
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
    CHATGPT: 'bg-chatgpt/10 text-chatgpt-text border-chatgpt/20'
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
