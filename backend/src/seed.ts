import {
  PrismaClient,
  PlatformType,
  ScriptType,
  OsTarget,
  TemplateCategory,
  Prisma
} from '@prisma/client';

const prisma = new PrismaClient();

// --- Reusable parameter definitions (see docs/resources/Templates.md §5) ---
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
} as const;

type SeedTemplate = Omit<Prisma.TemplateCreateInput, 'user'> & { id: string };

// =====================================================================
// Tier B — Use-Case Patterns (the original four, backfilled with metadata)
// =====================================================================
const patterns: SeedTemplate[] = [
  {
    id: 'tpl_daily_database_backup',
    name: 'Daily Database Backup',
    description: 'Backs up a PostgreSQL database every night at 3 AM.',
    sourcePlatform: PlatformType.WINDOWS_TASK_SCHEDULER,
    targetPlatforms: [PlatformType.WINDOWS_TASK_SCHEDULER, PlatformType.CLAUDE_CODE],
    scheduleExpression: '0 3 * * *',
    // Redirection needs a shell, so name it explicitly (the agent no longer wraps
    // commands in an implicit cmd.exe /c — see utils/commandParser.ts).
    command: 'cmd.exe /c "pg_dump -U postgres my_db > backup.sql"',
    scriptType: ScriptType.EXECUTABLE,
    os: OsTarget.WINDOWS,
    category: TemplateCategory.BACKUP,
    icon: 'Database',
    upvotes: 42
  },
  {
    id: 'tpl_morning_news_digest',
    name: 'Morning News Digest',
    description: 'Summarizes top news stories from specified RSS feeds.',
    sourcePlatform: PlatformType.CLAUDE_CODE,
    targetPlatforms: [PlatformType.CLAUDE_CODE, PlatformType.CHATGPT],
    scheduleExpression: '0 7 * * *',
    command: 'Fetch and summarize news',
    scriptType: ScriptType.AI_PROMPT,
    os: OsTarget.CROSS_PLATFORM,
    category: TemplateCategory.AI_AGENT,
    icon: 'Newspaper',
    upvotes: 128
  },
  {
    id: 'tpl_weekly_system_cleanup',
    name: 'Weekly System Cleanup',
    description: 'Cleans up temporary files and logs every Sunday.',
    sourcePlatform: PlatformType.WINDOWS_TASK_SCHEDULER,
    targetPlatforms: [PlatformType.WINDOWS_TASK_SCHEDULER],
    scheduleExpression: '0 0 * * 0',
    // `del` is a cmd builtin and %temp% needs cmd expansion, so invoke cmd
    // explicitly rather than relying on an implicit shell wrapper.
    command: 'cmd.exe /c "del /q /s %temp%\\*"',
    scriptType: ScriptType.BATCH,
    os: OsTarget.WINDOWS,
    category: TemplateCategory.CLEANUP,
    icon: 'Trash2',
    upvotes: 15
  },
  {
    id: 'tpl_github_pr_triage',
    name: 'GitHub PR Triage',
    description: 'Triage new pull requests and label them based on content.',
    sourcePlatform: PlatformType.CLAUDE_CODE,
    targetPlatforms: [PlatformType.CLAUDE_CODE],
    scheduleExpression: '*/30 * * * *',
    command: 'Triage PRs',
    scriptType: ScriptType.AI_PROMPT,
    os: OsTarget.CROSS_PLATFORM,
    category: TemplateCategory.DEV_WORKFLOW,
    icon: 'GitPullRequest',
    upvotes: 89
  }
];

// =====================================================================
// Tier A — Script Starters (curated, isStarter = true)
// commandTemplate holds {{placeholders}}; command mirrors it until the
// Apply modal substitutes real values (see docs/resources/Templates.md §3).
// =====================================================================
const winTask = [PlatformType.WINDOWS_TASK_SCHEDULER];
const macTask = [PlatformType.MACOS_LAUNCHD];
const crossTask = [PlatformType.WINDOWS_TASK_SCHEDULER, PlatformType.MACOS_LAUNCHD];

const starters: SeedTemplate[] = [
  // ---- Windows ----
  {
    id: 'tpl_starter_powershell_script',
    name: 'PowerShell Script',
    description: 'Run a .ps1 PowerShell script file on a schedule.',
    sourcePlatform: PlatformType.WINDOWS_TASK_SCHEDULER,
    targetPlatforms: winTask,
    scheduleExpression: '0 9 * * *',
    commandTemplate: 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "{{scriptPath}}"',
    command: 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "{{scriptPath}}"',
    parameters: [P.scriptPath],
    scriptType: ScriptType.POWERSHELL,
    os: OsTarget.WINDOWS,
    category: TemplateCategory.OTHER,
    icon: 'Terminal',
    isStarter: true
  },
  {
    id: 'tpl_starter_powershell_inline',
    name: 'PowerShell Inline Command',
    description: 'Run an inline PowerShell command without a script file.',
    sourcePlatform: PlatformType.WINDOWS_TASK_SCHEDULER,
    targetPlatforms: winTask,
    scheduleExpression: '0 * * * *',
    commandTemplate: 'powershell.exe -NoProfile -Command "{{command}}"',
    command: 'powershell.exe -NoProfile -Command "{{command}}"',
    parameters: [P.inlineCommand],
    scriptType: ScriptType.POWERSHELL,
    os: OsTarget.WINDOWS,
    category: TemplateCategory.OTHER,
    icon: 'Terminal',
    isStarter: true
  },
  {
    id: 'tpl_starter_batch_script',
    name: 'Batch / CMD Script',
    description: 'Run a .bat or .cmd batch file via cmd.exe.',
    sourcePlatform: PlatformType.WINDOWS_TASK_SCHEDULER,
    targetPlatforms: winTask,
    scheduleExpression: '0 0 * * *',
    commandTemplate: 'cmd.exe /c "{{scriptPath}}"',
    command: 'cmd.exe /c "{{scriptPath}}"',
    parameters: [P.scriptPath],
    scriptType: ScriptType.BATCH,
    os: OsTarget.WINDOWS,
    category: TemplateCategory.OTHER,
    icon: 'SquareTerminal',
    isStarter: true
  },
  {
    id: 'tpl_starter_python_windows',
    name: 'Python Script (Windows)',
    description: 'Run a Python script with the Windows python interpreter.',
    sourcePlatform: PlatformType.WINDOWS_TASK_SCHEDULER,
    targetPlatforms: winTask,
    scheduleExpression: '0 8 * * *',
    commandTemplate: 'python "{{scriptPath}}" {{args}}',
    command: 'python "{{scriptPath}}" {{args}}',
    parameters: [P.scriptPath, P.args],
    scriptType: ScriptType.PYTHON,
    os: OsTarget.WINDOWS,
    category: TemplateCategory.OTHER,
    icon: 'FileCode',
    isStarter: true
  },
  {
    id: 'tpl_starter_node_windows',
    name: 'Node.js Script (Windows)',
    description: 'Run a Node.js script with node on Windows.',
    sourcePlatform: PlatformType.WINDOWS_TASK_SCHEDULER,
    targetPlatforms: winTask,
    scheduleExpression: '*/30 * * * *',
    commandTemplate: 'node "{{scriptPath}}" {{args}}',
    command: 'node "{{scriptPath}}" {{args}}',
    parameters: [P.scriptPath, P.args],
    scriptType: ScriptType.NODE,
    os: OsTarget.WINDOWS,
    category: TemplateCategory.OTHER,
    icon: 'Hexagon',
    isStarter: true
  },
  {
    id: 'tpl_starter_run_exe',
    name: 'Run a Program / .exe',
    description: 'Launch an executable or binary directly on a schedule.',
    sourcePlatform: PlatformType.WINDOWS_TASK_SCHEDULER,
    targetPlatforms: winTask,
    scheduleExpression: '0 7 * * 1',
    commandTemplate: '"{{exePath}}" {{args}}',
    command: '"{{exePath}}" {{args}}',
    parameters: [P.exePath, P.args],
    scriptType: ScriptType.EXECUTABLE,
    os: OsTarget.WINDOWS,
    category: TemplateCategory.OTHER,
    icon: 'AppWindow',
    isStarter: true
  },
  {
    id: 'tpl_starter_webhook_windows',
    name: 'Webhook / HTTP Ping (Windows)',
    description: 'Call a URL on a schedule using Invoke-WebRequest.',
    sourcePlatform: PlatformType.WINDOWS_TASK_SCHEDULER,
    targetPlatforms: winTask,
    scheduleExpression: '*/15 * * * *',
    commandTemplate: 'powershell.exe -Command "Invoke-WebRequest -Uri \'{{url}}\' -Method {{method}}"',
    command: 'powershell.exe -Command "Invoke-WebRequest -Uri \'{{url}}\' -Method {{method}}"',
    parameters: [P.url, P.method],
    scriptType: ScriptType.HTTP,
    os: OsTarget.WINDOWS,
    category: TemplateCategory.MONITORING,
    icon: 'Globe',
    isStarter: true
  },
  {
    id: 'tpl_starter_vbscript',
    name: 'VBScript (legacy)',
    description: 'Run a legacy .vbs script via cscript.',
    sourcePlatform: PlatformType.WINDOWS_TASK_SCHEDULER,
    targetPlatforms: winTask,
    scheduleExpression: '0 6 * * *',
    commandTemplate: 'cscript //nologo "{{scriptPath}}"',
    command: 'cscript //nologo "{{scriptPath}}"',
    parameters: [P.scriptPath],
    scriptType: ScriptType.VBSCRIPT,
    os: OsTarget.WINDOWS,
    category: TemplateCategory.OTHER,
    icon: 'FileCode',
    isStarter: true
  },

  // ---- macOS (catalog-only until the macOS agent ships) ----
  {
    id: 'tpl_starter_zsh_script',
    name: 'Shell Script (zsh)',
    description: 'Run a shell script with zsh, the macOS default shell.',
    sourcePlatform: PlatformType.MACOS_LAUNCHD,
    targetPlatforms: macTask,
    scheduleExpression: '0 9 * * *',
    commandTemplate: '/bin/zsh "{{scriptPath}}" {{args}}',
    command: '/bin/zsh "{{scriptPath}}" {{args}}',
    parameters: [P.scriptPath, P.args],
    scriptType: ScriptType.ZSH,
    os: OsTarget.MACOS,
    category: TemplateCategory.OTHER,
    icon: 'Terminal',
    isStarter: true
  },
  {
    id: 'tpl_starter_bash_script',
    name: 'Shell Script (bash)',
    description: 'Run a shell script with bash on macOS or Linux.',
    sourcePlatform: PlatformType.MACOS_LAUNCHD,
    targetPlatforms: macTask,
    scheduleExpression: '0 9 * * *',
    commandTemplate: '/bin/bash "{{scriptPath}}" {{args}}',
    command: '/bin/bash "{{scriptPath}}" {{args}}',
    parameters: [P.scriptPath, P.args],
    scriptType: ScriptType.BASH,
    os: OsTarget.MACOS,
    category: TemplateCategory.OTHER,
    icon: 'Terminal',
    isStarter: true
  },
  {
    id: 'tpl_starter_python_macos',
    name: 'Python Script (macOS)',
    description: 'Run a Python script with python3 on macOS.',
    sourcePlatform: PlatformType.MACOS_LAUNCHD,
    targetPlatforms: macTask,
    scheduleExpression: '0 8 * * *',
    commandTemplate: 'python3 "{{scriptPath}}" {{args}}',
    command: 'python3 "{{scriptPath}}" {{args}}',
    parameters: [P.scriptPath, P.args],
    scriptType: ScriptType.PYTHON,
    os: OsTarget.MACOS,
    category: TemplateCategory.OTHER,
    icon: 'FileCode',
    isStarter: true
  },
  {
    id: 'tpl_starter_node_macos',
    name: 'Node.js Script (macOS)',
    description: 'Run a Node.js script with node on macOS.',
    sourcePlatform: PlatformType.MACOS_LAUNCHD,
    targetPlatforms: macTask,
    scheduleExpression: '*/30 * * * *',
    commandTemplate: 'node "{{scriptPath}}" {{args}}',
    command: 'node "{{scriptPath}}" {{args}}',
    parameters: [P.scriptPath, P.args],
    scriptType: ScriptType.NODE,
    os: OsTarget.MACOS,
    category: TemplateCategory.OTHER,
    icon: 'Hexagon',
    isStarter: true
  },
  {
    id: 'tpl_starter_applescript',
    name: 'AppleScript',
    description: 'Run an AppleScript file via osascript.',
    sourcePlatform: PlatformType.MACOS_LAUNCHD,
    targetPlatforms: macTask,
    scheduleExpression: '0 18 * * *',
    commandTemplate: 'osascript "{{scriptPath}}"',
    command: 'osascript "{{scriptPath}}"',
    parameters: [P.scriptPath],
    scriptType: ScriptType.APPLESCRIPT,
    os: OsTarget.MACOS,
    category: TemplateCategory.OTHER,
    icon: 'Apple',
    isStarter: true
  },
  {
    id: 'tpl_starter_shell_inline_macos',
    name: 'Inline Shell Command (macOS)',
    description: 'Run an inline shell command via zsh.',
    sourcePlatform: PlatformType.MACOS_LAUNCHD,
    targetPlatforms: macTask,
    scheduleExpression: '0 * * * *',
    commandTemplate: '/bin/zsh -c "{{command}}"',
    command: '/bin/zsh -c "{{command}}"',
    parameters: [P.inlineCommand],
    scriptType: ScriptType.ZSH,
    os: OsTarget.MACOS,
    category: TemplateCategory.OTHER,
    icon: 'Terminal',
    isStarter: true
  },
  {
    id: 'tpl_starter_webhook_macos',
    name: 'Webhook / HTTP Ping (macOS)',
    description: 'Call a URL on a schedule using curl.',
    sourcePlatform: PlatformType.MACOS_LAUNCHD,
    targetPlatforms: macTask,
    scheduleExpression: '*/15 * * * *',
    commandTemplate: 'curl -fsS -X {{method}} "{{url}}"',
    command: 'curl -fsS -X {{method}} "{{url}}"',
    parameters: [P.method, P.url],
    scriptType: ScriptType.HTTP,
    os: OsTarget.MACOS,
    category: TemplateCategory.MONITORING,
    icon: 'Globe',
    isStarter: true
  },

  // ---- Cross-platform / platform-native ----
  {
    id: 'tpl_starter_python_cross',
    name: 'Python Script (cross-platform)',
    description: 'Run a Python script on Windows or macOS (interpreter resolved at apply-time).',
    sourcePlatform: PlatformType.WINDOWS_TASK_SCHEDULER,
    targetPlatforms: crossTask,
    scheduleExpression: '0 8 * * *',
    commandTemplate: 'python "{{scriptPath}}" {{args}}',
    command: 'python "{{scriptPath}}" {{args}}',
    parameters: [P.scriptPath, P.args],
    scriptType: ScriptType.PYTHON,
    os: OsTarget.CROSS_PLATFORM,
    category: TemplateCategory.OTHER,
    icon: 'FileCode',
    isStarter: true
  },
  {
    id: 'tpl_starter_node_cross',
    name: 'Node.js Script (cross-platform)',
    description: 'Run a Node.js script on Windows or macOS.',
    sourcePlatform: PlatformType.WINDOWS_TASK_SCHEDULER,
    targetPlatforms: crossTask,
    scheduleExpression: '0 8 * * *',
    commandTemplate: 'node "{{scriptPath}}" {{args}}',
    command: 'node "{{scriptPath}}" {{args}}',
    parameters: [P.scriptPath, P.args],
    scriptType: ScriptType.NODE,
    os: OsTarget.CROSS_PLATFORM,
    category: TemplateCategory.OTHER,
    icon: 'Hexagon',
    isStarter: true
  },
  {
    id: 'tpl_starter_git_sync',
    name: 'Git Pull / Repo Sync',
    description: 'Pull the latest commits for a local git repository on a schedule.',
    sourcePlatform: PlatformType.WINDOWS_TASK_SCHEDULER,
    targetPlatforms: crossTask,
    scheduleExpression: '0 */6 * * *',
    commandTemplate: 'git -C "{{repoPath}}" pull',
    command: 'git -C "{{repoPath}}" pull',
    parameters: [P.repoPath],
    scriptType: ScriptType.BASH,
    os: OsTarget.CROSS_PLATFORM,
    category: TemplateCategory.DEV_WORKFLOW,
    icon: 'GitBranch',
    isStarter: true
  },
  {
    id: 'tpl_starter_claude_routine',
    name: 'Claude Code Routine',
    description: 'Run a natural-language Claude Code routine on a schedule.',
    sourcePlatform: PlatformType.CLAUDE_CODE,
    targetPlatforms: [PlatformType.CLAUDE_CODE],
    scheduleExpression: '0 7 * * *',
    commandTemplate: '{{prompt}}',
    command: '{{prompt}}',
    parameters: [P.prompt],
    scriptType: ScriptType.AI_PROMPT,
    os: OsTarget.CROSS_PLATFORM,
    category: TemplateCategory.AI_AGENT,
    icon: 'Sparkles',
    isStarter: true
  },
  {
    id: 'tpl_starter_chatgpt_link',
    name: 'ChatGPT Automation (link)',
    description: 'Quick-link to create a ChatGPT automation (no public API — opens native UI).',
    sourcePlatform: PlatformType.CHATGPT,
    targetPlatforms: [PlatformType.CHATGPT],
    scheduleExpression: '0 9 * * *',
    commandTemplate: '{{prompt}}',
    command: '{{prompt}}',
    parameters: [P.prompt],
    scriptType: ScriptType.AI_PROMPT,
    os: OsTarget.CROSS_PLATFORM,
    category: TemplateCategory.AI_AGENT,
    icon: 'MessageSquare',
    isStarter: true
  }
];

async function main() {
  console.log('Seeding data...');

  const user = await prisma.user.upsert({
    where: { email: 'mike@example.com' },
    update: {},
    create: {
      id: 'cli_user_placeholder',
      email: 'mike@example.com',
      name: 'Mike'
    }
  });

  const allTemplates: SeedTemplate[] = [...patterns, ...starters];

  for (const { id, ...data } of allTemplates) {
    await prisma.template.upsert({
      where: { id },
      update: data,
      create: { id, user: { connect: { id: user.id } }, ...data }
    });
  }

  console.log(`Seeding complete. ${allTemplates.length} templates upserted ` +
    `(${patterns.length} patterns, ${starters.length} starters).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
