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
    core: true,
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
    core: true,
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
    core: true,
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
    description: 'Re-run docker compose up on an interval so a dev stack restarts itself if it stops (the pattern Cronsole uses for its own stack).',
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
// AI Pack (Claude Code + Codex) — ai-agent use-case patterns (2026-07-13)
// Real, *creatable* Windows tasks that run AI coding CLIs unattended, distinct
// from the honest-manual `ai-prompt` link starters below.
//
// Claude Code clears the gate with headless print mode (`claude -p`), permission
// fencing via `--permission-mode dontAsk`, an explicit user-scoped `--allowedTools`
// allowlist, `--bare`, and captured output.
//
// Codex clears the gate with non-interactive mode (`codex exec`), explicit
// no-prompt approval policy (`codex --ask-for-approval never exec ...`), explicit
// sandbox selection, `--ephemeral`, `--color never`, final-message capture via
// `-o`, and full stream capture via PowerShell redirection. The default templates
// stay read-only; the workspace-write template is labeled higher-trust. Verified
// against the installed Codex CLI (`codex exec --help`, v0.144.1) and a live
// read-only smoke run.
//
// Both CLIs are invoked bare, assuming they're on the task user's PATH (as git,
// npm, and docker are). Redirection needs a shell, so PowerShell is named
// explicitly and the multi-word prompt rides as a single-quoted string inside
// the one `-Command` arg.
// =====================================================================
const aiPack: RegistryTemplate[] = [
  {
    schemaVersion: '1.0',
    id: 'ai-claude-headless-run',
    name: 'Claude Code Headless Run',
    description:
      'Run the Claude Code CLI unattended against a repo on a schedule with a fixed prompt. Non-interactive (`-p`), fenced by `--permission-mode dontAsk`, scoped to the tools you list, output captured to a log.',
    runtime: 'powershell',
    os: 'windows',
    category: 'ai-agent',
    tags: ['ai', 'llm', 'cli', 'agents', 'claude-code'],
    icon: 'Bot',
    trigger: sched('0 7 * * *'),
    commandTemplate:
      "powershell.exe -NoProfile -Command \"Set-Location '{{repoPath}}'; claude -p '{{prompt}}' --allowedTools '{{allowedTools}}' --permission-mode dontAsk --max-turns {{maxTurns}} --model {{model}} --bare *> '{{logPath}}'\"",
    parameters: [
      P.repoPath,
      { key: 'prompt', label: 'Prompt', type: 'text', default: '', required: true, help: 'The instruction Claude runs each time. Avoid single quotes (they close the PowerShell string).' },
      { key: 'allowedTools', label: 'Allowed tools', type: 'text', default: 'Read,Grep,Glob', required: true, help: "Comma-separated Claude Code tool allowlist, e.g. Read,Grep,Glob or Bash(git log *),Edit. dontAsk still auto-denies anything not listed. See the Claude Code --allowedTools docs for the exact syntax." },
      { key: 'maxTurns', label: 'Max turns', type: 'text', default: '5', required: true, help: 'Abort the run after this many agentic turns (bounds runtime and cost).' },
      { key: 'model', label: 'Model', type: 'select', options: ['sonnet', 'opus', 'haiku'], default: 'sonnet', required: true, help: 'Claude model alias to run.' },
      { key: 'logPath', label: 'Log file path', type: 'path', default: 'C:\\logs\\claude-run.log', required: true, help: 'Where the run output (Claude\'s printed result + any errors) is captured.' }
    ],
    compatibleTargets: ['windows']
  },
  {
    schemaVersion: '1.0',
    id: 'ai-claude-repo-digest',
    name: 'Claude Code Repo Digest',
    description:
      'A read-only Claude Code run that summarizes a repository into a Markdown digest on a schedule (e.g. weekly). Tools are locked to read/search only; the printed digest is written to a report file.',
    runtime: 'powershell',
    os: 'windows',
    category: 'ai-agent',
    tags: ['ai', 'llm', 'cli', 'agents', 'claude-code', 'report'],
    icon: 'ScrollText',
    trigger: sched('0 7 * * 1'),
    commandTemplate:
      "powershell.exe -NoProfile -Command \"Set-Location '{{repoPath}}'; claude -p '{{prompt}}' --allowedTools 'Read,Grep,Glob' --permission-mode dontAsk --max-turns {{maxTurns}} --model {{model}} --bare *> '{{reportPath}}'\"",
    parameters: [
      P.repoPath,
      { key: 'prompt', label: 'Digest prompt', type: 'text', default: 'Summarize the notable changes, open TODOs, and anything that looks risky in this repository into a concise Markdown digest.', required: true, help: 'What to summarize. Read-only tools only — avoid single quotes.' },
      { key: 'maxTurns', label: 'Max turns', type: 'text', default: '8', required: true, help: 'Abort the run after this many agentic turns.' },
      { key: 'model', label: 'Model', type: 'select', options: ['sonnet', 'opus', 'haiku'], default: 'sonnet', required: true, help: 'Claude model alias to run.' },
      { key: 'reportPath', label: 'Report file path', type: 'path', default: 'C:\\reports\\repo-digest.md', required: true, help: 'Where the Markdown digest is written.' }
    ],
    compatibleTargets: ['windows']
  },
  {
    schemaVersion: '1.0',
    id: 'ai-claude-autofix-commit',
    name: 'Claude Code Auto-Fix & Commit',
    description:
      'Higher-trust: let Claude Code edit a repo and commit on a schedule. Still fenced by `--permission-mode dontAsk` — only the edit/git tools you list are pre-approved. Scope `--allowedTools` narrowly and review the log/commits.',
    runtime: 'powershell',
    os: 'windows',
    category: 'ai-agent',
    tags: ['ai', 'llm', 'cli', 'agents', 'claude-code', 'git'],
    icon: 'GitPullRequestArrow',
    trigger: sched('0 3 * * *'),
    commandTemplate:
      "powershell.exe -NoProfile -Command \"Set-Location '{{repoPath}}'; claude -p '{{prompt}}' --allowedTools '{{allowedTools}}' --permission-mode dontAsk --max-turns {{maxTurns}} --model {{model}} --bare *> '{{logPath}}'\"",
    parameters: [
      P.repoPath,
      { key: 'prompt', label: 'Prompt', type: 'text', default: '', required: true, help: 'The task Claude performs, e.g. "Fix lint errors and commit". Avoid single quotes.' },
      { key: 'allowedTools', label: 'Allowed tools', type: 'text', default: 'Read,Edit,Write,Grep,Glob,Bash(git add *),Bash(git commit *),Bash(git status *),Bash(git diff *)', required: true, help: 'Edit + scoped git tools pre-approved for the run. Keep Bash scoped (e.g. Bash(git commit *)), never a bare Bash. dontAsk auto-denies anything not listed.' },
      { key: 'maxTurns', label: 'Max turns', type: 'text', default: '10', required: true, help: 'Abort the run after this many agentic turns.' },
      { key: 'model', label: 'Model', type: 'select', options: ['sonnet', 'opus', 'haiku'], default: 'sonnet', required: true, help: 'Claude model alias to run.' },
      { key: 'logPath', label: 'Log file path', type: 'path', default: 'C:\\logs\\claude-autofix.log', required: true, help: 'Where the run output is captured for review.' }
    ],
    compatibleTargets: ['windows']
  },
  {
    schemaVersion: '1.0',
    id: 'ai-claude-log-cleanup',
    name: 'Claude Code Log Cleanup',
    description:
      'Housekeeping companion for the scheduled Claude runs: delete run logs/digests older than a cutoff so they do not pile up. Read-nothing, deletes only matching files in one folder.',
    runtime: 'powershell',
    os: 'windows',
    category: 'cleanup',
    tags: ['ai', 'cli', 'agents', 'cleanup', 'logs'],
    icon: 'Trash2',
    trigger: sched('0 2 * * 0'),
    commandTemplate:
      "powershell.exe -NoProfile -Command \"Get-ChildItem -Path '{{logDir}}' -Filter '{{filter}}' -File | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-{{days}}) } | Remove-Item -Force\"",
    parameters: [
      { key: 'logDir', label: 'Log folder', type: 'path', default: 'C:\\logs', required: true, help: 'Folder holding the Claude run logs to prune.' },
      { key: 'filter', label: 'File filter', type: 'text', default: 'claude-*.log', required: true, help: 'Which files to consider, e.g. claude-*.log or *.md.' },
      { key: 'days', label: 'Keep for (days)', type: 'text', default: '14', required: true, help: 'Delete matching files older than this many days.' }
    ],
    compatibleTargets: ['windows']
  },
  {
    schemaVersion: '1.0',
    id: 'ai-codex-headless-run',
    name: 'Codex Headless Run',
    description:
      'Run Codex CLI non-interactively against a repo on a schedule with a fixed prompt. Uses `codex exec`, no approval prompts, an explicit sandbox, an ephemeral session, and captured output.',
    runtime: 'powershell',
    os: 'windows',
    category: 'ai-agent',
    tags: ['ai', 'llm', 'cli', 'agents', 'codex'],
    icon: 'Bot',
    trigger: sched('0 7 * * *'),
    commandTemplate:
      "powershell.exe -NoProfile -Command \"codex --ask-for-approval never exec --sandbox {{sandbox}} --ephemeral --color never -C '{{repoPath}}' -o '{{outputPath}}' '{{prompt}}' *> '{{logPath}}'\"",
    parameters: [
      P.repoPath,
      { key: 'prompt', label: 'Prompt', type: 'text', default: '', required: true, help: 'The instruction Codex runs each time. Avoid single quotes (they close the PowerShell string).' },
      { key: 'sandbox', label: 'Sandbox', type: 'select', options: ['read-only', 'workspace-write'], default: 'read-only', required: true, help: 'Least privilege for the run. read-only is safest; workspace-write allows Codex to edit files inside the repo.' },
      { key: 'outputPath', label: 'Final output path', type: 'path', default: 'C:\\reports\\codex-output.md', required: true, help: 'Where Codex writes the final agent message via --output-last-message.' },
      { key: 'logPath', label: 'Log file path', type: 'path', default: 'C:\\logs\\codex-run.log', required: true, help: 'Where the full non-interactive run stream is captured for review.' }
    ],
    compatibleTargets: ['windows']
  },
  {
    schemaVersion: '1.0',
    id: 'ai-codex-repo-digest',
    name: 'Codex Repo Digest',
    description:
      'A read-only Codex run that summarizes a repository into a Markdown digest on a schedule. The final digest and full run stream are captured separately.',
    runtime: 'powershell',
    os: 'windows',
    category: 'ai-agent',
    tags: ['ai', 'llm', 'cli', 'agents', 'codex', 'report'],
    icon: 'ScrollText',
    trigger: sched('0 7 * * 1'),
    commandTemplate:
      "powershell.exe -NoProfile -Command \"codex --ask-for-approval never exec --sandbox read-only --ephemeral --color never -C '{{repoPath}}' -o '{{reportPath}}' '{{prompt}}' *> '{{logPath}}'\"",
    parameters: [
      P.repoPath,
      { key: 'prompt', label: 'Digest prompt', type: 'text', default: 'Summarize the notable changes, open TODOs, and anything that looks risky in this repository into a concise Markdown digest.', required: true, help: 'What to summarize. This template runs Codex in a read-only sandbox. Avoid single quotes.' },
      { key: 'reportPath', label: 'Report file path', type: 'path', default: 'C:\\reports\\codex-repo-digest.md', required: true, help: 'Where the Markdown digest is written.' },
      { key: 'logPath', label: 'Log file path', type: 'path', default: 'C:\\logs\\codex-repo-digest.log', required: true, help: 'Where the full run stream is captured for review.' }
    ],
    compatibleTargets: ['windows']
  },
  {
    schemaVersion: '1.0',
    id: 'ai-codex-autofix-workspace',
    name: 'Codex Auto-Fix Workspace',
    description:
      'Higher-trust: let Codex edit a repository on a schedule. Runs non-interactively with no approval prompts but stays inside the workspace-write sandbox; review the diff and logs before pushing.',
    runtime: 'powershell',
    os: 'windows',
    category: 'ai-agent',
    tags: ['ai', 'llm', 'cli', 'agents', 'codex', 'git'],
    icon: 'GitPullRequestArrow',
    trigger: sched('0 3 * * *'),
    commandTemplate:
      "powershell.exe -NoProfile -Command \"codex --ask-for-approval never exec --sandbox workspace-write --ephemeral --color never -C '{{repoPath}}' -o '{{summaryPath}}' '{{prompt}}' *> '{{logPath}}'\"",
    parameters: [
      P.repoPath,
      { key: 'prompt', label: 'Prompt', type: 'text', default: 'Fix straightforward lint, formatting, or test failures in this repository. Keep changes small and summarize every file changed.', required: true, help: 'The task Codex performs. It may edit files inside the repo. Avoid single quotes.' },
      { key: 'summaryPath', label: 'Summary file path', type: 'path', default: 'C:\\reports\\codex-autofix-summary.md', required: true, help: 'Where Codex writes the final summary.' },
      { key: 'logPath', label: 'Log file path', type: 'path', default: 'C:\\logs\\codex-autofix.log', required: true, help: 'Where the full run stream is captured for review.' }
    ],
    compatibleTargets: ['windows']
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
    core: true,
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
    core: true,
    name: 'Webhook / HTTP Ping (Windows)',
    description: 'Call a URL on a schedule using Invoke-WebRequest.',
    runtime: 'http',
    os: 'windows',
    category: 'monitoring',
    tags: ['windows', 'http', 'monitoring', 'webhook'],
    icon: 'Globe',
    isStarter: true,
    trigger: sched('*/15 * * * *'),
    // -UseBasicParsing is mandatory, not stylistic: without it Windows PowerShell
    // 5.1 parses the response with the Internet Explorer engine, which Windows 11
    // no longer ships. The call then dies on a NullReferenceException — and under
    // Task Scheduler it hangs indefinitely instead of exiting, so the default
    // */15 trigger would strand a powershell.exe every 15 minutes. -NoProfile
    // keeps an unattended run independent of the user's profile.
    commandTemplate:
      'powershell.exe -NoProfile -Command "Invoke-WebRequest -Uri \'{{url}}\' -Method {{method}} -UseBasicParsing"',
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

// =====================================================================
// Extended Pack — gallery-only templates (2026-07-14)
// These are deliberately NOT `core`, so they are NOT auto-synced into a fresh
// install's DB; they live in the registry/gallery and a user imports the ones
// they want (see catalogSync core-only filter + ROADMAP "Template gallery site
// + selective-import distribution"). All are Windows-creatable — either a
// structured no-shell exec or an explicit `powershell.exe -Command "…"` /
// `cmd.exe /c` opt-in — honest about targets, and covered by the whole-catalog
// resolvability sweep. Every placeholder sits inside a quoted/composite token
// (never a bare multi-arg slot), so each value stays exactly one argument.
// =====================================================================
const extendedPack: RegistryTemplate[] = [
  {
    schemaVersion: '1.0',
    id: 'bkp-folder-zip',
    name: 'Backup Folder to Zip',
    description: 'Compress a folder into a .zip archive on a schedule.',
    runtime: 'powershell',
    os: 'windows',
    category: 'backup',
    tags: ['backup', 'windows', 'archive', 'zip'],
    icon: 'Archive',
    trigger: sched('0 2 * * *'),
    commandTemplate: 'powershell.exe -NoProfile -Command "Compress-Archive -Path \'{{sourcePath}}\' -DestinationPath \'{{destZip}}\' -Force"',
    parameters: [
      { key: 'sourcePath', label: 'Folder to back up', type: 'path', default: '', required: true, help: 'Folder (or glob) to compress. Avoid single quotes in the path.' },
      { key: 'destZip', label: 'Destination .zip', type: 'path', default: 'C:\\backups\\backup.zip', required: true, help: 'Where to write the archive. -Force overwrites an existing file.' }
    ],
    compatibleTargets: ['windows']
  },
  {
    schemaVersion: '1.0',
    id: 'bkp-robocopy-mirror',
    name: 'Mirror Folder (robocopy)',
    description: 'Mirror a directory to a backup location with robocopy /MIR.',
    runtime: 'executable',
    os: 'windows',
    category: 'backup',
    tags: ['backup', 'windows', 'robocopy', 'sync'],
    icon: 'FolderSync',
    trigger: sched('0 1 * * *'),
    commandTemplate: 'robocopy "{{sourceDir}}" "{{destDir}}" /MIR /R:2 /W:5',
    parameters: [
      { key: 'sourceDir', label: 'Source folder', type: 'path', default: '', required: true, help: 'The directory to mirror from.' },
      { key: 'destDir', label: 'Destination folder', type: 'path', default: 'C:\\backups\\mirror', required: true, help: 'The backup directory. /MIR makes it match the source exactly (deletes extras).' }
    ],
    compatibleTargets: ['windows']
  },
  {
    schemaVersion: '1.0',
    id: 'cln-old-files',
    name: 'Delete Files Older Than N Days',
    description: 'Prune files in a folder that are older than a cutoff, to reclaim disk.',
    runtime: 'powershell',
    os: 'windows',
    category: 'cleanup',
    tags: ['cleanup', 'windows', 'disk', 'logs'],
    icon: 'CalendarX',
    trigger: sched('0 4 * * *'),
    commandTemplate: 'powershell.exe -NoProfile -Command "Get-ChildItem -Path \'{{targetDir}}\' -Recurse -File | Where-Object LastWriteTime -lt (Get-Date).AddDays(-{{days}}) | Remove-Item -Force"',
    parameters: [
      { key: 'targetDir', label: 'Folder to prune', type: 'path', default: '', required: true, help: 'Directory whose old files are deleted (recursively).' },
      { key: 'days', label: 'Older than (days)', type: 'text', default: '30', required: true, help: 'Delete files last modified more than this many days ago.' }
    ],
    compatibleTargets: ['windows']
  },
  {
    schemaVersion: '1.0',
    id: 'cln-recycle-bin',
    name: 'Empty Recycle Bin',
    description: 'Empty the Windows Recycle Bin on a schedule.',
    runtime: 'powershell',
    os: 'windows',
    category: 'cleanup',
    tags: ['cleanup', 'windows', 'disk'],
    icon: 'Trash2',
    trigger: sched('0 5 * * 0'),
    commandTemplate: 'powershell.exe -NoProfile -Command "Clear-RecycleBin -Force -ErrorAction SilentlyContinue"',
    parameters: [],
    compatibleTargets: ['windows']
  },
  {
    schemaVersion: '1.0',
    id: 'sys-restart-service',
    name: 'Restart a Windows Service',
    description: 'Restart a Windows service on a schedule (e.g. to recover a flaky one).',
    runtime: 'powershell',
    os: 'windows',
    category: 'system',
    tags: ['system', 'windows', 'service'],
    icon: 'RefreshCw',
    trigger: sched('0 3 * * *'),
    commandTemplate: 'powershell.exe -NoProfile -Command "Restart-Service -Name \'{{serviceName}}\' -Force"',
    parameters: [
      { key: 'serviceName', label: 'Service name', type: 'text', default: '', required: true, help: 'The service short name (Get-Service to list). Runs elevated for most services.' }
    ],
    compatibleTargets: ['windows']
  },
  {
    schemaVersion: '1.0',
    id: 'sys-flush-dns',
    name: 'Flush DNS Cache',
    description: 'Clear the Windows DNS resolver cache.',
    runtime: 'executable',
    os: 'windows',
    category: 'system',
    tags: ['system', 'windows', 'network', 'dns'],
    icon: 'Network',
    trigger: sched('0 6 * * *'),
    commandTemplate: 'ipconfig /flushdns',
    parameters: [],
    compatibleTargets: ['windows']
  },
  {
    schemaVersion: '1.0',
    id: 'sys-update-scan',
    name: 'Trigger Windows Update Scan',
    description: 'Kick off a Windows Update detection scan on a schedule.',
    runtime: 'executable',
    os: 'windows',
    category: 'system',
    tags: ['system', 'windows', 'updates'],
    icon: 'DownloadCloud',
    trigger: sched('0 7 * * *'),
    commandTemplate: 'usoclient StartScan',
    parameters: [],
    compatibleTargets: ['windows']
  },
  {
    schemaVersion: '1.0',
    id: 'sys-battery-report',
    name: 'Generate Battery Report',
    description: 'Write a laptop battery health report to an HTML file.',
    runtime: 'executable',
    os: 'windows',
    category: 'system',
    tags: ['system', 'windows', 'power', 'report'],
    icon: 'BatteryCharging',
    trigger: sched('0 8 * * 1'),
    commandTemplate: 'powercfg /batteryreport /output "{{outFile}}"',
    parameters: [
      { key: 'outFile', label: 'Report output path', type: 'path', default: 'C:\\reports\\battery-report.html', required: true, help: 'Where to write the battery report (.html).' }
    ],
    compatibleTargets: ['windows']
  },
  {
    schemaVersion: '1.0',
    id: 'mon-disk-report',
    name: 'Log Disk Usage',
    description: 'Append free/used disk space for every drive to a log file.',
    runtime: 'powershell',
    os: 'windows',
    category: 'monitoring',
    tags: ['monitoring', 'windows', 'disk', 'report'],
    icon: 'HardDrive',
    trigger: sched('0 * * * *'),
    commandTemplate: 'powershell.exe -NoProfile -Command "Get-PSDrive -PSProvider FileSystem | Select-Object Name, Used, Free | Out-File -Append \'{{logPath}}\'"',
    parameters: [
      { key: 'logPath', label: 'Log file path', type: 'path', default: 'C:\\logs\\disk.log', required: true, help: 'Where to append the disk snapshot.' }
    ],
    compatibleTargets: ['windows']
  },
  {
    schemaVersion: '1.0',
    id: 'mon-ping-host',
    name: 'Ping Host & Log',
    description: 'Check whether a host is reachable and append the result to a log.',
    runtime: 'powershell',
    os: 'windows',
    category: 'monitoring',
    tags: ['monitoring', 'windows', 'network', 'uptime'],
    icon: 'Activity',
    trigger: sched('*/15 * * * *'),
    commandTemplate: 'powershell.exe -NoProfile -Command "Test-Connection -ComputerName \'{{host}}\' -Count 2 | Out-File -Append \'{{logPath}}\'"',
    parameters: [
      { key: 'host', label: 'Host / IP', type: 'text', default: '', required: true, help: 'The hostname or IP to ping.' },
      { key: 'logPath', label: 'Log file path', type: 'path', default: 'C:\\logs\\ping.log', required: true, help: 'Where to append the ping result.' }
    ],
    compatibleTargets: ['windows']
  },
  {
    schemaVersion: '1.0',
    id: 'mon-service-health',
    name: 'Log Service Status',
    description: 'Record whether a Windows service is running, on an interval.',
    runtime: 'powershell',
    os: 'windows',
    category: 'monitoring',
    tags: ['monitoring', 'windows', 'service', 'health'],
    icon: 'HeartPulse',
    trigger: sched('*/30 * * * *'),
    commandTemplate: 'powershell.exe -NoProfile -Command "Get-Service -Name \'{{serviceName}}\' | Format-Table -AutoSize | Out-File -Append \'{{logPath}}\'"',
    parameters: [
      { key: 'serviceName', label: 'Service name', type: 'text', default: '', required: true, help: 'The service short name to check.' },
      { key: 'logPath', label: 'Log file path', type: 'path', default: 'C:\\logs\\service.log', required: true, help: 'Where to append the status.' }
    ],
    compatibleTargets: ['windows']
  },
  {
    schemaVersion: '1.0',
    id: 'data-export-eventlog',
    name: 'Export Windows Event Log',
    description: 'Archive a Windows event log (System, Application, …) to an .evtx file.',
    runtime: 'executable',
    os: 'windows',
    category: 'data-sync',
    tags: ['data', 'windows', 'eventlog', 'archive'],
    icon: 'FileArchive',
    trigger: sched('0 0 * * 0'),
    commandTemplate: 'wevtutil epl "{{logName}}" "{{outFile}}" /ow:true',
    parameters: [
      { key: 'logName', label: 'Event log', type: 'text', default: 'System', required: true, help: 'Log channel to export (System, Application, Security, …).' },
      { key: 'outFile', label: 'Output .evtx path', type: 'path', default: 'C:\\logs\\System.evtx', required: true, help: 'Where to write the exported log. /ow:true overwrites.' }
    ],
    compatibleTargets: ['windows']
  },
  {
    schemaVersion: '1.0',
    id: 'data-rclone-sync',
    name: 'Sync Folder to Cloud (rclone)',
    description: 'Sync a local folder to a configured rclone remote (S3, Drive, B2, …).',
    runtime: 'executable',
    os: 'cross-platform',
    category: 'data-sync',
    tags: ['data', 'sync', 'cloud', 'rclone', 'backup'],
    icon: 'CloudUpload',
    trigger: sched('0 23 * * *'),
    commandTemplate: 'rclone sync "{{source}}" "{{dest}}" --log-file "{{logFile}}"',
    parameters: [
      { key: 'source', label: 'Local source', type: 'text', default: '', required: true, help: 'Local path to sync from. Requires rclone installed + a configured remote.' },
      { key: 'dest', label: 'Remote destination', type: 'text', default: '', required: true, help: 'rclone remote target, e.g. mydrive:backups/photos.' },
      { key: 'logFile', label: 'Log file path', type: 'path', default: 'C:\\logs\\rclone.log', required: true, help: 'Where rclone writes its run log.' }
    ],
    compatibleTargets: ['windows', 'macos']
  },
  {
    schemaVersion: '1.0',
    id: 'ntf-discord-heartbeat',
    name: 'Discord Webhook Message',
    description: 'Post a scheduled message to a Discord channel via a webhook.',
    runtime: 'powershell',
    os: 'windows',
    category: 'notification',
    tags: ['notification', 'windows', 'discord', 'webhook'],
    icon: 'Bell',
    trigger: sched('0 9 * * *'),
    commandTemplate: 'powershell.exe -NoProfile -Command "Invoke-RestMethod -Uri \'{{webhookUrl}}\' -Method Post -ContentType \'application/json\' -Body (@{ content = \'{{message}}\' } | ConvertTo-Json)"',
    parameters: [
      { key: 'webhookUrl', label: 'Discord webhook URL', type: 'url', default: '', required: true, help: 'Channel → Integrations → Webhooks → Copy URL.' },
      { key: 'message', label: 'Message', type: 'text', default: 'Cronsole scheduled heartbeat', required: true, help: 'The text to post. Avoid single quotes (they close the PowerShell string).' }
    ],
    compatibleTargets: ['windows']
  },
  {
    schemaVersion: '1.0',
    id: 'ntf-log-heartbeat',
    name: 'Heartbeat to Log File',
    description: 'Append a timestamped line to a log — a simple "am I still scheduled?" check.',
    runtime: 'powershell',
    os: 'windows',
    category: 'notification',
    tags: ['notification', 'windows', 'heartbeat', 'logs'],
    icon: 'FileClock',
    trigger: sched('*/10 * * * *'),
    commandTemplate: 'powershell.exe -NoProfile -Command "Add-Content -Path \'{{logPath}}\' -Value (Get-Date)"',
    parameters: [
      { key: 'logPath', label: 'Log file path', type: 'path', default: 'C:\\logs\\heartbeat.log', required: true, help: 'Where to append the heartbeat timestamp.' }
    ],
    compatibleTargets: ['windows']
  }
];

/** The full bundled catalog: core (auto-synced) + extended (gallery/import-only), Registry v1 shape. */
export const bundledCatalog: RegistryTemplate[] = [
  ...patterns,
  ...devPack,
  ...aiPack,
  ...starters,
  ...extendedPack
];
