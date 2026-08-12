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

// Platforms Cronsole can actually CREATE a task on today (a registered, working
// connector). Everything else a template lists is "compatible with" only — no
// agent/API yet (macOS launchd, ChatGPT), or an experimental scaffold not wired
// for creation (Claude). Templates advertise broader targetPlatforms; Apply is
// gated to this set so a badge never implies an export that silently fails.
export const CREATABLE_PLATFORMS = new Set(['WINDOWS_TASK_SCHEDULER', 'TASKHUB_NATIVE']);
export const isCreatablePlatform = (p: string) => CREATABLE_PLATFORMS.has(p);
