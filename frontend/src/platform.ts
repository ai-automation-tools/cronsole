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
    'TASKHUB_NATIVE:EXEC': 'Cronsole (Scripts)'
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
    'TASKHUB_NATIVE:EXEC': 'Scripts'
  }[key] ?? sourceLabel(key));

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
