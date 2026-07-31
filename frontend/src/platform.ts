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

export const platformBadgeClass = (p: string) =>
  ({
    WINDOWS_TASK_SCHEDULER: 'bg-primary/10 text-foreground border-primary/20',
    TASKHUB_NATIVE: 'bg-violet-500/10 text-violet-300 border-violet-500/30',
    CLAUDE_CODE: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    CHATGPT: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
  }[p] ?? 'bg-muted/10 text-muted-foreground border-border/20');

export const isNativePlatform = (p: string) => p === 'TASKHUB_NATIVE';

// Platforms Cronsole can actually CREATE a task on today (a registered, working
// connector). Everything else a template lists is "compatible with" only — no
// agent/API yet (macOS launchd, ChatGPT), or an experimental scaffold not wired
// for creation (Claude). Templates advertise broader targetPlatforms; Apply is
// gated to this set so a badge never implies an export that silently fails.
export const CREATABLE_PLATFORMS = new Set(['WINDOWS_TASK_SCHEDULER', 'TASKHUB_NATIVE']);
export const isCreatablePlatform = (p: string) => CREATABLE_PLATFORMS.has(p);
