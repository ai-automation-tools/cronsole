/**
 * Bundled fallback snapshot of the template catalog, in Registry v1 shape.
 *
 * This is the compiled-in source of truth the seed materializes into the DB and
 * the fallback a future remote-registry source falls back to when the network
 * is down or a fetch fails. It replaces the hand-inlined arrays that used to
 * live in src/seed.ts — content is now data behind a catalog source, not code.
 *
 * Faithfulness rule (step-2 "no behavior change"): every `commandTemplate` and
 * cron here is byte-for-byte identical to the previous seed, and the legacy
 * `tpl_*` IDs are preserved so the DB upsert updates the same rows and existing
 * TemplateFavorite FKs are never orphaned. The on-disk *remote* registry format
 * is JSON; this bundled snapshot is a typed TS module purely so it needs no
 * build-time JSON copy step.
 */

import type { RegistryTemplate } from './schema.js';

// --- Reusable parameter definitions (unchanged from the previous seed). ---
const P = {
  scriptPath: {
    key: 'scriptPath',
    label: 'Script file path',
    type: 'path',
    default: '',
    required: true,
    help: 'Absolute path to the script on the target machine.'
  },
  args: {
    key: 'args',
    label: 'Arguments',
    type: 'text',
    default: '',
    required: false,
    help: 'Optional command-line arguments.'
  },
  inlineCommand: {
    key: 'command',
    label: 'Command',
    type: 'text',
    default: '',
    required: true,
    help: 'The command/code to run inline.'
  },
  exePath: {
    key: 'exePath',
    label: 'Executable path',
    type: 'path',
    default: '',
    required: true,
    help: 'Absolute path to the .exe / binary.'
  },
  url: {
    key: 'url',
    label: 'URL',
    type: 'url',
    default: '',
    required: true,
    help: 'The endpoint to call.'
  },
  method: {
    key: 'method',
    label: 'HTTP method',
    type: 'select',
    options: ['GET', 'POST'],
    default: 'GET',
    required: true,
    help: 'HTTP verb for the request.'
  },
  repoPath: {
    key: 'repoPath',
    label: 'Repository path',
    type: 'path',
    default: '',
    required: true,
    help: 'Absolute path to the local git repository.'
  },
  prompt: {
    key: 'prompt',
    label: 'Prompt',
    type: 'text',
    default: '',
    required: true,
    help: 'The natural-language instruction for the agent.'
  }
};

const sched = (cron: string) => ({ kind: 'schedule' as const, cron });

// =====================================================================
// Tier B — Use-Case Patterns
// =====================================================================
const patterns: RegistryTemplate[] = [
  {
    schemaVersion: '1.0',
    id: 'tpl_daily_database_backup',
    name: 'Daily Database Backup',
    description: 'Back up a PostgreSQL database on a schedule with pg_dump.',
    runtime: 'executable',
    os: 'windows',
    category: 'backup',
    tags: ['windows', 'backup', 'database', 'postgres'],
    icon: 'Database',
    trigger: sched('0 3 * * *'),
    // Redirection needs a shell, so cmd.exe is named explicitly and the whole
    // pg_dump line stays inside one quoted /c argument.
    commandTemplate: 'cmd.exe /c "pg_dump -U {{dbUser}} {{dbName}} > {{backupPath}}"',
    parameters: [
      { key: 'dbUser', label: 'Database user', type: 'text', default: 'postgres', required: true, help: 'The PostgreSQL role to connect as.' },
      { key: 'dbName', label: 'Database name', type: 'text', default: '', required: true, help: 'The database to back up.' },
      { key: 'backupPath', label: 'Backup file path', type: 'path', default: 'C:\\backups\\db.sql', required: true, help: 'Where to write the .sql dump.' }
    ],
    compatibleTargets: ['windows']
  },
  {
    schemaVersion: '1.0',
    id: 'tpl_morning_news_digest',
    name: 'Morning News Digest',
    description: 'Summarize top stories from your news sources into a daily digest.',
    runtime: 'ai-prompt',
    os: 'cross-platform',
    category: 'ai-agent',
    tags: ['ai', 'digest', 'news'],
    icon: 'Newspaper',
    trigger: sched('0 7 * * *'),
    commandTemplate: 'Summarize the top stories from {{feeds}} into a {{length}} digest.',
    parameters: [
      { key: 'feeds', label: 'News sources / feeds', type: 'text', default: '', required: true, help: 'Comma-separated RSS feeds or topics to summarize.' },
      { key: 'length', label: 'Digest length', type: 'select', options: ['short', 'detailed'], default: 'short', required: true, help: 'How long the summary should be.' }
    ],
    compatibleTargets: ['claude-code', 'chatgpt']
  },
  {
    schemaVersion: '1.0',
    id: 'tpl_weekly_system_cleanup',
    name: 'Weekly System Cleanup',
    description: 'Delete temporary files on a schedule to reclaim disk space.',
    runtime: 'batch',
    os: 'windows',
    category: 'cleanup',
    tags: ['windows', 'cleanup', 'disk'],
    icon: 'Trash2',
    trigger: sched('0 0 * * 0'),
    commandTemplate: 'cmd.exe /c "del /q /s {{targetPath}}"',
    parameters: [
      { key: 'targetPath', label: 'Path to clean', type: 'path', default: '%temp%\\*', required: true, help: 'Files/glob to delete, e.g. %temp%\\*.' }
    ],
    compatibleTargets: ['windows']
  },
  {
    schemaVersion: '1.0',
    id: 'tpl_github_pr_triage',
    name: 'GitHub PR Triage',
    description: 'Triage new pull requests in a repo and label them by content.',
    runtime: 'ai-prompt',
    os: 'cross-platform',
    category: 'dev-workflow',
    tags: ['ai', 'github', 'dev'],
    icon: 'GitPullRequest',
    trigger: sched('*/30 * * * *'),
    commandTemplate: 'Triage new pull requests in {{repo}} and label them by content and priority.',
    parameters: [
      { key: 'repo', label: 'Repository', type: 'text', default: '', required: true, help: 'The owner/name of the GitHub repo to triage.' }
    ],
    compatibleTargets: ['claude-code']
  }
];

// =====================================================================
// Developer Pack — dev-workflow use-case patterns (2026-07-13)
// Tagged via the free-form tags model ('dev' on every entry + specifics).
// New entries use the plain-kebab id form per Registry_Schema_v1 §7 (the
// legacy tpl_* form is only for the pre-registry rows).
// =====================================================================
const devPack: RegistryTemplate[] = [
  {
    schemaVersion: '1.0',
    id: 'dev-git-fetch-prune',
    name: 'Git Fetch & Prune',
    description: 'Keep a local repository fresh: fetch all remotes and prune deleted remote branches.',
    runtime: 'executable',
    os: 'cross-platform',
    category: 'dev-workflow',
    tags: ['dev', 'git', 'sync', 'hygiene'],
    icon: 'GitBranch',
    trigger: sched('0 6 * * *'),
    commandTemplate: 'git -C "{{repoPath}}" fetch --all --prune',
    parameters: [P.repoPath],
    compatibleTargets: ['windows', 'macos']
  },
  {
    schemaVersion: '1.0',
    id: 'dev-git-maintenance',
    name: 'Git Repo Maintenance',
    description: 'Run git maintenance (gc, commit-graph, prefetch) to keep a large repository fast.',
    runtime: 'executable',
    os: 'cross-platform',
    category: 'dev-workflow',
    tags: ['dev', 'git', 'hygiene'],
    icon: 'Wrench',
    trigger: sched('0 2 * * 0'),
    commandTemplate: 'git -C "{{repoPath}}" maintenance run',
    parameters: [P.repoPath],
    compatibleTargets: ['windows', 'macos']
  },
  {
    schemaVersion: '1.0',
    id: 'dev-git-autocommit-push',
    name: 'Git Auto-Commit & Push',
    description: 'Snapshot a working repository on a schedule: stage everything, commit, and push.',
    runtime: 'powershell',
    os: 'windows',
    category: 'dev-workflow',
    tags: ['dev', 'git', 'backup'],
    icon: 'GitCommitHorizontal',
    trigger: sched('0 18 * * 1-5'),
    commandTemplate:
      'powershell.exe -NoProfile -Command "git -C \'{{repoPath}}\' add -A; git -C \'{{repoPath}}\' commit -m \'{{message}}\'; git -C \'{{repoPath}}\' push"',
    parameters: [
      P.repoPath,
      { key: 'message', label: 'Commit message', type: 'text', default: 'chore: scheduled auto-commit', required: true, help: 'Message used for each scheduled commit. Avoid single quotes.' }
    ],
    compatibleTargets: ['windows']
  },
  {
    schemaVersion: '1.0',
    id: 'dev-npm-outdated-check',
    name: 'Dependency Update Check (npm)',
    description: 'Write an npm outdated report for a project on a schedule.',
    runtime: 'node',
    os: 'windows',
    category: 'dev-workflow',
    tags: ['dev', 'node', 'npm', 'dependencies'],
    icon: 'PackageSearch',
    trigger: sched('0 7 * * 1'),
    commandTemplate: 'cmd.exe /c "cd /d {{projectPath}} && npm outdated > {{reportPath}} 2>&1"',
    parameters: [
      { key: 'projectPath', label: 'Project path', type: 'path', default: '', required: true, help: 'Folder containing package.json (avoid spaces in the path).' },
      { key: 'reportPath', label: 'Report file path', type: 'path', default: 'C:\\reports\\npm-outdated.txt', required: true, help: 'Where to write the outdated report. Note: npm outdated exits non-zero when updates exist, so the run shows as failed exactly when there is something to update.' }
    ],
    compatibleTargets: ['windows']
  },
  {
    schemaVersion: '1.0',
    id: 'dev-npm-nightly-build',
    name: 'Nightly Build (npm)',
    description: 'Run an npm script (build, lint, …) for a project every night and capture the log.',
    runtime: 'node',
    os: 'windows',
    category: 'dev-workflow',
    tags: ['dev', 'node', 'npm', 'build', 'ci'],
    icon: 'Hammer',
    trigger: sched('0 4 * * *'),
    commandTemplate: 'cmd.exe /c "cd /d {{projectPath}} && npm run {{script}} > {{logPath}} 2>&1"',
    parameters: [
      { key: 'projectPath', label: 'Project path', type: 'path', default: '', required: true, help: 'Folder containing package.json (avoid spaces in the path).' },
      { key: 'script', label: 'npm script', type: 'text', default: 'build', required: true, help: 'The package.json script to run, e.g. build or lint.' },
      { key: 'logPath', label: 'Log file path', type: 'path', default: 'C:\\logs\\nightly-build.log', required: true, help: 'Where to write the build output.' }
    ],
    compatibleTargets: ['windows']
  },
  {
    schemaVersion: '1.0',
    id: 'dev-npm-test-run',
    name: 'Scheduled Test Run (npm)',
    description: 'Run a project test suite on a schedule and capture the log; a red run means failing tests.',
    runtime: 'node',
    os: 'windows',
    category: 'dev-workflow',
    tags: ['dev', 'node', 'npm', 'test', 'ci'],
    icon: 'FlaskConical',
    trigger: sched('0 5 * * *'),
    commandTemplate: 'cmd.exe /c "cd /d {{projectPath}} && npm test > {{logPath}} 2>&1"',
    parameters: [
      { key: 'projectPath', label: 'Project path', type: 'path', default: '', required: true, help: 'Folder containing package.json (avoid spaces in the path).' },
      { key: 'logPath', label: 'Log file path', type: 'path', default: 'C:\\logs\\test-run.log', required: true, help: 'Where to write the test output.' }
    ],
    compatibleTargets: ['windows']
  },
  {
    schemaVersion: '1.0',
    id: 'dev-dotnet-build',
    name: '.NET Build',
    description: 'Build a .NET project or solution with the dotnet CLI on a schedule.',
    runtime: 'executable',
    os: 'cross-platform',
    category: 'dev-workflow',
    tags: ['dev', 'dotnet', 'build', 'ci'],
    icon: 'Package',
    trigger: sched('30 4 * * *'),
    commandTemplate: 'dotnet build "{{projectPath}}" {{args}}',
    parameters: [
      { key: 'projectPath', label: 'Project / solution path', type: 'path', default: '', required: true, help: 'Absolute path to the .csproj or .sln.' },
      P.args
    ],
    compatibleTargets: ['windows', 'macos']
  },
  {
    schemaVersion: '1.0',
    id: 'dev-docker-prune',
    name: 'Docker Cleanup (prune)',
    description: 'Reclaim disk space by pruning unused Docker containers, networks, and images.',
    runtime: 'executable',
    os: 'cross-platform',
    category: 'cleanup',
    tags: ['dev', 'docker', 'cleanup', 'disk'],
    icon: 'Trash2',
    trigger: sched('0 1 * * 0'),
    commandTemplate: 'docker system prune -f {{args}}',
    parameters: [
      { key: 'args', label: 'Extra prune flags', type: 'text', default: '', required: false, help: 'Optional extra flags, e.g. --volumes or -a (removes ALL unused images).' }
    ],
    compatibleTargets: ['windows', 'macos']
  },
  {
    schemaVersion: '1.0',
    id: 'dev-docker-compose-up',
    name: 'Docker Compose Self-Heal',
    description: 'Re-run docker compose up on an interval so a dev stack restarts itself if it stops (the pattern TaskHub uses for its own stack).',
    runtime: 'executable',
    os: 'cross-platform',
    category: 'monitoring',
    tags: ['dev', 'docker', 'self-heal', 'monitoring'],
    icon: 'RefreshCw',
    trigger: sched('*/10 * * * *'),
    commandTemplate: 'docker compose -f "{{composeFile}}" up -d',
    parameters: [
      { key: 'composeFile', label: 'Compose file path', type: 'path', default: '', required: true, help: 'Absolute path to the docker-compose.yml. up -d is idempotent — running containers are left alone.' }
    ],
    compatibleTargets: ['windows', 'macos']
  }
];

// =====================================================================
// Tier A — Script Starters (isStarter = true)
// =====================================================================
const starters: RegistryTemplate[] = [
  // ---- Windows ----
  {
    schemaVersion: '1.0',
    id: 'tpl_starter_powershell_script',
    name: 'PowerShell Script',
    description: 'Run a .ps1 PowerShell script file on a schedule.',
    runtime: 'powershell',
    os: 'windows',
    category: 'other',
    tags: ['windows', 'script', 'powershell'],
    icon: 'Terminal',
    isStarter: true,
    trigger: sched('0 9 * * *'),
    commandTemplate: 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "{{scriptPath}}"',
    parameters: [P.scriptPath],
    compatibleTargets: ['windows']
  },
  {
    schemaVersion: '1.0',
    id: 'tpl_starter_powershell_inline',
    name: 'PowerShell Inline Command',
    description: 'Run an inline PowerShell command without a script file.',
    runtime: 'powershell',
    os: 'windows',
    category: 'other',
    tags: ['windows', 'powershell'],
    icon: 'Terminal',
    isStarter: true,
    trigger: sched('0 * * * *'),
    commandTemplate: 'powershell.exe -NoProfile -Command "{{command}}"',
    parameters: [P.inlineCommand],
    compatibleTargets: ['windows']
  },
  {
    schemaVersion: '1.0',
    id: 'tpl_starter_batch_script',
    name: 'Batch / CMD Script',
    description: 'Run a .bat or .cmd batch file via cmd.exe.',
    runtime: 'batch',
    os: 'windows',
    category: 'other',
    tags: ['windows', 'batch', 'script'],
    icon: 'SquareTerminal',
    isStarter: true,
    trigger: sched('0 0 * * *'),
    commandTemplate: 'cmd.exe /c "{{scriptPath}}"',
    parameters: [P.scriptPath],
    compatibleTargets: ['windows']
  },
  {
    schemaVersion: '1.0',
    id: 'tpl_starter_python_windows',
    name: 'Python Script (Windows)',
    description: 'Run a Python script with the Windows python interpreter.',
    runtime: 'python',
    os: 'windows',
    category: 'other',
    tags: ['windows', 'python', 'script'],
    icon: 'FileCode',
    isStarter: true,
    trigger: sched('0 8 * * *'),
    commandTemplate: 'python "{{scriptPath}}" {{args}}',
    parameters: [P.scriptPath, P.args],
    compatibleTargets: ['windows']
  },
  {
    schemaVersion: '1.0',
    id: 'tpl_starter_node_windows',
    name: 'Node.js Script (Windows)',
    description: 'Run a Node.js script with node on Windows.',
    runtime: 'node',
    os: 'windows',
    category: 'other',
    tags: ['windows', 'node', 'script'],
    icon: 'Hexagon',
    isStarter: true,
    trigger: sched('*/30 * * * *'),
    commandTemplate: 'node "{{scriptPath}}" {{args}}',
    parameters: [P.scriptPath, P.args],
    compatibleTargets: ['windows']
  },
  {
    schemaVersion: '1.0',
    id: 'tpl_starter_run_exe',
    name: 'Run a Program / .exe',
    description: 'Launch an executable or binary directly on a schedule.',
    runtime: 'executable',
    os: 'windows',
    category: 'other',
    tags: ['windows', 'executable'],
    icon: 'AppWindow',
    isStarter: true,
    trigger: sched('0 7 * * 1'),
    commandTemplate: '"{{exePath}}" {{args}}',
    parameters: [P.exePath, P.args],
    compatibleTargets: ['windows']
  },
  {
    schemaVersion: '1.0',
    id: 'tpl_starter_webhook_windows',
    name: 'Webhook / HTTP Ping (Windows)',
    description: 'Call a URL on a schedule using Invoke-WebRequest.',
    runtime: 'http',
    os: 'windows',
    category: 'monitoring',
    tags: ['windows', 'http', 'monitoring', 'webhook'],
    icon: 'Globe',
    isStarter: true,
    trigger: sched('*/15 * * * *'),
    commandTemplate: 'powershell.exe -Command "Invoke-WebRequest -Uri \'{{url}}\' -Method {{method}}"',
    parameters: [P.url, P.method],
    compatibleTargets: ['windows']
  },
  {
    schemaVersion: '1.0',
    id: 'tpl_starter_vbscript',
    name: 'VBScript (legacy)',
    description: 'Run a legacy .vbs script via cscript.',
    runtime: 'vbscript',
    os: 'windows',
    category: 'other',
    tags: ['windows', 'vbscript', 'legacy'],
    icon: 'FileCode',
    isStarter: true,
    trigger: sched('0 6 * * *'),
    commandTemplate: 'cscript //nologo "{{scriptPath}}"',
    parameters: [P.scriptPath],
    compatibleTargets: ['windows']
  },

  // ---- macOS (catalog-only until the macOS agent ships) ----
  {
    schemaVersion: '1.0',
    id: 'tpl_starter_zsh_script',
    name: 'Shell Script (zsh)',
    description: 'Run a shell script with zsh, the macOS default shell.',
    runtime: 'zsh',
    os: 'macos',
    category: 'other',
    tags: ['macos', 'shell', 'zsh'],
    icon: 'Terminal',
    isStarter: true,
    trigger: sched('0 9 * * *'),
    commandTemplate: '/bin/zsh "{{scriptPath}}" {{args}}',
    parameters: [P.scriptPath, P.args],
    compatibleTargets: ['macos']
  },
  {
    schemaVersion: '1.0',
    id: 'tpl_starter_bash_script',
    name: 'Shell Script (bash)',
    description: 'Run a shell script with bash on macOS or Linux.',
    runtime: 'bash',
    os: 'macos',
    category: 'other',
    tags: ['macos', 'shell', 'bash'],
    icon: 'Terminal',
    isStarter: true,
    trigger: sched('0 9 * * *'),
    commandTemplate: '/bin/bash "{{scriptPath}}" {{args}}',
    parameters: [P.scriptPath, P.args],
    compatibleTargets: ['macos']
  },
  {
    schemaVersion: '1.0',
    id: 'tpl_starter_python_macos',
    name: 'Python Script (macOS)',
    description: 'Run a Python script with python3 on macOS.',
    runtime: 'python',
    os: 'macos',
    category: 'other',
    tags: ['macos', 'python', 'script'],
    icon: 'FileCode',
    isStarter: true,
    trigger: sched('0 8 * * *'),
    commandTemplate: 'python3 "{{scriptPath}}" {{args}}',
    parameters: [P.scriptPath, P.args],
    compatibleTargets: ['macos']
  },
  {
    schemaVersion: '1.0',
    id: 'tpl_starter_node_macos',
    name: 'Node.js Script (macOS)',
    description: 'Run a Node.js script with node on macOS.',
    runtime: 'node',
    os: 'macos',
    category: 'other',
    tags: ['macos', 'node', 'script'],
    icon: 'Hexagon',
    isStarter: true,
    trigger: sched('*/30 * * * *'),
    commandTemplate: 'node "{{scriptPath}}" {{args}}',
    parameters: [P.scriptPath, P.args],
    compatibleTargets: ['macos']
  },
  {
    schemaVersion: '1.0',
    id: 'tpl_starter_applescript',
    name: 'AppleScript',
    description: 'Run an AppleScript file via osascript.',
    runtime: 'applescript',
    os: 'macos',
    category: 'other',
    tags: ['macos', 'applescript'],
    icon: 'Apple',
    isStarter: true,
    trigger: sched('0 18 * * *'),
    commandTemplate: 'osascript "{{scriptPath}}"',
    parameters: [P.scriptPath],
    compatibleTargets: ['macos']
  },
  {
    schemaVersion: '1.0',
    id: 'tpl_starter_shell_inline_macos',
    name: 'Inline Shell Command (macOS)',
    description: 'Run an inline shell command via zsh.',
    runtime: 'zsh',
    os: 'macos',
    category: 'other',
    tags: ['macos', 'shell'],
    icon: 'Terminal',
    isStarter: true,
    trigger: sched('0 * * * *'),
    commandTemplate: '/bin/zsh -c "{{command}}"',
    parameters: [P.inlineCommand],
    compatibleTargets: ['macos']
  },
  {
    schemaVersion: '1.0',
    id: 'tpl_starter_webhook_macos',
    name: 'Webhook / HTTP Ping (macOS)',
    description: 'Call a URL on a schedule using curl.',
    runtime: 'http',
    os: 'macos',
    category: 'monitoring',
    tags: ['macos', 'http', 'monitoring', 'webhook'],
    icon: 'Globe',
    isStarter: true,
    trigger: sched('*/15 * * * *'),
    commandTemplate: 'curl -fsS -X {{method}} "{{url}}"',
    parameters: [P.method, P.url],
    compatibleTargets: ['macos']
  },

  // ---- Cross-platform / platform-native ----
  {
    schemaVersion: '1.0',
    id: 'tpl_starter_python_cross',
    name: 'Python Script (cross-platform)',
    description: 'Run a Python script on Windows or macOS (interpreter resolved at apply-time).',
    runtime: 'python',
    os: 'cross-platform',
    category: 'other',
    tags: ['python', 'script'],
    icon: 'FileCode',
    isStarter: true,
    trigger: sched('0 8 * * *'),
    commandTemplate: 'python "{{scriptPath}}" {{args}}',
    parameters: [P.scriptPath, P.args],
    compatibleTargets: ['windows', 'macos']
  },
  {
    schemaVersion: '1.0',
    id: 'tpl_starter_node_cross',
    name: 'Node.js Script (cross-platform)',
    description: 'Run a Node.js script on Windows or macOS.',
    runtime: 'node',
    os: 'cross-platform',
    category: 'other',
    tags: ['node', 'script'],
    icon: 'Hexagon',
    isStarter: true,
    trigger: sched('0 8 * * *'),
    commandTemplate: 'node "{{scriptPath}}" {{args}}',
    parameters: [P.scriptPath, P.args],
    compatibleTargets: ['windows', 'macos']
  },
  {
    schemaVersion: '1.0',
    id: 'tpl_starter_git_sync',
    name: 'Git Pull / Repo Sync',
    description: 'Pull the latest commits for a local git repository on a schedule.',
    runtime: 'bash',
    os: 'cross-platform',
    category: 'dev-workflow',
    tags: ['git', 'dev', 'sync'],
    icon: 'GitBranch',
    isStarter: true,
    trigger: sched('0 */6 * * *'),
    commandTemplate: 'git -C "{{repoPath}}" pull',
    parameters: [P.repoPath],
    compatibleTargets: ['windows', 'macos']
  },
  {
    schemaVersion: '1.0',
    id: 'tpl_starter_claude_routine',
    name: 'Claude Code Routine',
    description: 'Run a natural-language Claude Code routine on a schedule.',
    runtime: 'ai-prompt',
    os: 'cross-platform',
    category: 'ai-agent',
    tags: ['ai', 'claude-code'],
    icon: 'Sparkles',
    isStarter: true,
    trigger: sched('0 7 * * *'),
    commandTemplate: '{{prompt}}',
    parameters: [P.prompt],
    compatibleTargets: ['claude-code']
  },
  {
    schemaVersion: '1.0',
    id: 'tpl_starter_chatgpt_link',
    name: 'ChatGPT Automation (link)',
    description: 'Quick-link to create a ChatGPT automation (no public API — opens native UI).',
    runtime: 'ai-prompt',
    os: 'cross-platform',
    category: 'ai-agent',
    tags: ['ai', 'chatgpt'],
    icon: 'MessageSquare',
    isStarter: true,
    trigger: sched('0 9 * * *'),
    commandTemplate: '{{prompt}}',
    parameters: [P.prompt],
    compatibleTargets: ['chatgpt']
  }
];

/** The full bundled catalog (patterns, then the Developer Pack, then starters), Registry v1 shape. */
export const bundledCatalog: RegistryTemplate[] = [...patterns, ...devPack, ...starters];
