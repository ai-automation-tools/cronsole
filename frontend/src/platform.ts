// Single source of truth for platform display — labels and badge styling.
// TaskHub-native tasks get a distinct violet identity so they're immediately
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
    TASKHUB_NATIVE: 'TaskHub'
  }[p] ?? p.split('_')[0]);

export const platformBadgeClass = (p: string) =>
  ({
    WINDOWS_TASK_SCHEDULER: 'bg-primary/10 text-foreground border-primary/20',
    TASKHUB_NATIVE: 'bg-violet-500/10 text-violet-300 border-violet-500/30',
    CLAUDE_CODE: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    CHATGPT: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
  }[p] ?? 'bg-muted/10 text-muted-foreground border-border/20');

export const isNativePlatform = (p: string) => p === 'TASKHUB_NATIVE';
