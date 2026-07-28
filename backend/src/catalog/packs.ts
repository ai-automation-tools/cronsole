/**
 * Template packs — curated sets of templates a user can import in one go.
 *
 * ## Why membership is declared, not derived
 *
 * The gallery used to define these as JavaScript predicates (`tags.includes('dev')`,
 * `category === 'monitoring'`). That reads fine until someone tags an unrelated
 * template `dev` and the "Developer Pack" silently gains a member — a change
 * nothing reports, nothing tests, and no diff shows. Once a pack is a
 * **downloadable artifact**, that is no longer a cosmetic problem: it changes
 * what lands in someone's catalog.
 *
 * So a pack lists its `templateIds` explicitly. Adding a template to a pack is a
 * reviewable line in a diff, and `buildRegistry` **fails the build** on an id
 * that doesn't exist — the failure mode moves from silent drift to a broken
 * build, which is the trade this project makes everywhere else.
 *
 * ## Packs are curation, not shipping batches
 *
 * `bundled.ts` groups templates by the batch they shipped in (`devPack`,
 * `aiPack`, `extendedPack`). Those are release history. A pack is what a *user*
 * would want in one download, so packs deliberately cross-cut those arrays —
 * "Backup & Cleanup" draws from three of them.
 *
 * **Overlap is expected and fine.** `dev-docker-prune` is legitimately both a
 * developer tool and a cleanup job; a template may appear in several packs.
 *
 * ## Presentation lives in the gallery, not here
 *
 * Icons and colors stay in the site, keyed by pack id, with a default for
 * unknown ids — so adding a pack here needs no site change.
 */

export interface BundledPack {
  /** Stable kebab-case id. Also the bundle filename: `packs/<id>.json`. */
  id: string;
  name: string;
  description: string;
  /**
   * Explicit membership. Every id must exist in the catalog or the registry
   * build throws — see buildRegistry.
   */
  templateIds: string[];
}

export const bundledPacks: BundledPack[] = [
  {
    id: 'starters',
    name: 'Script Starters',
    description:
      'Blank-slate primitives for PowerShell, Bash, Python, Node, executables and HTTP — the fastest way to schedule any command.',
    templateIds: [
      'tpl_starter_powershell_script',
      'tpl_starter_powershell_inline',
      'tpl_starter_batch_script',
      'tpl_starter_python_windows',
      'tpl_starter_node_windows',
      'tpl_starter_run_exe',
      'tpl_starter_webhook_windows',
      'tpl_starter_vbscript',
      'tpl_starter_zsh_script',
      'tpl_starter_bash_script',
      'tpl_starter_python_macos',
      'tpl_starter_node_macos',
      'tpl_starter_applescript',
      'tpl_starter_shell_inline_macos',
      'tpl_starter_webhook_macos',
      'tpl_starter_python_cross',
      'tpl_starter_node_cross',
      'tpl_starter_git_sync',
      'tpl_starter_claude_routine',
      'tpl_starter_chatgpt_link'
    ]
  },
  {
    id: 'developer',
    name: 'Developer Pack',
    description:
      'Keep repos fresh and toolchains healthy: git hygiene, npm checks, builds, tests, Docker upkeep.',
    templateIds: [
      'dev-git-fetch-prune',
      'dev-git-maintenance',
      'dev-git-autocommit-push',
      'dev-npm-outdated-check',
      'dev-npm-nightly-build',
      'dev-npm-test-run',
      'dev-dotnet-build',
      'dev-docker-prune',
      'dev-docker-compose-up',
      'tpl_github_pr_triage',
      'tpl_starter_git_sync'
    ]
  },
  {
    id: 'ai-agents',
    name: 'AI & Agents',
    description:
      'Run Claude Code and Codex unattended — headless prompts, repo digests, autofix — plus AI prompt patterns.',
    templateIds: [
      'ai-claude-headless-run',
      'ai-claude-repo-digest',
      'ai-claude-autofix-commit',
      'ai-claude-log-cleanup',
      'ai-codex-headless-run',
      'ai-codex-repo-digest',
      'ai-codex-autofix-workspace',
      'tpl_morning_news_digest',
      'tpl_github_pr_triage',
      'tpl_starter_claude_routine',
      'tpl_starter_chatgpt_link'
    ]
  },
  {
    id: 'backup-cleanup',
    name: 'Backup & Cleanup',
    description:
      'Protect data and reclaim disk: scheduled database backups, folder mirrors, temp-file sweeps, and log rotation.',
    templateIds: [
      'tpl_daily_database_backup',
      'tpl_weekly_system_cleanup',
      'bkp-folder-zip',
      'bkp-robocopy-mirror',
      'cln-old-files',
      'cln-recycle-bin',
      'dev-docker-prune',
      'ai-claude-log-cleanup'
    ]
  },
  {
    id: 'monitoring',
    name: 'Monitoring',
    description:
      'Watch what matters — health checks, webhooks, disk reports, and status pings on a schedule.',
    templateIds: [
      'mon-disk-report',
      'mon-ping-host',
      'mon-service-health',
      'dev-docker-compose-up',
      'tpl_starter_webhook_windows',
      'tpl_starter_webhook_macos'
    ]
  },
  {
    /**
     * Added when packs became first-class (2026-07-28). Without it these eight
     * templates belonged to **no** pack, so "download every pack" would quietly
     * be less than the catalog — the kind of silent shortfall the pack bundles
     * exist to avoid.
     */
    id: 'system-utilities',
    name: 'System & Utilities',
    description:
      'Windows housekeeping and plumbing: service restarts, DNS flushes, update scans, battery and event-log reports, cloud sync, and heartbeats.',
    templateIds: [
      'sys-restart-service',
      'sys-flush-dns',
      'sys-update-scan',
      'sys-battery-report',
      'data-export-eventlog',
      'data-rclone-sync',
      'ntf-discord-heartbeat',
      'ntf-log-heartbeat'
    ]
  }
];
