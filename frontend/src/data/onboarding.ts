/**
 * Onboarding content surfaced in the Help Center (and the first-run banner).
 *
 * Kept as data (not inlined in the modal) so the getting-started walkthrough and
 * the guide links stay easy to edit. The walkthrough is self-contained in-app;
 * the guide links deep-link to the fuller docs in the repo.
 *
 * The per-control `?` topics live in `help.ts` alongside these; both build their
 * URLs from `docs.ts`, which is also where the note about these links being a
 * checked mirror surface lives.
 */

import { DOCS_BASE } from './docs';

export interface OnboardingStep {
  /** Emoji shown as the step marker. */
  icon: string;
  title: string;
  body: string;
  /** Optional "read more" deep-link for this step. */
  link?: { label: string; url: string };
}

/** The 4-step getting-started walkthrough: connect → import → manage → templates. */
export const GETTING_STARTED_STEPS: OnboardingStep[] = [
  {
    icon: '🔌',
    title: 'Connect the Windows Agent',
    body:
      "Cronsole reads and runs your Windows tasks through a small agent on your machine. " +
      "The sidebar shows its connection status — if it reads Offline, start the agent. " +
      "First time? Follow the setup guide.",
    link: { label: 'Windows Agent Setup Guide', url: `${DOCS_BASE}/docs/user-guides/guides/Agent_Setup_Guide.md` }
  },
  {
    icon: '📥',
    title: 'Import & categorize your tasks',
    body:
      "Click Import to discover your existing Windows Task Scheduler tasks and pick which to bring in. " +
      "Cronsole infers a category from each task's folder path (a task under \\Monitoring\\ becomes \"Monitoring\"); " +
      "rename a category anytime by clicking its label on a card."
  },
  {
    icon: '▶️',
    title: 'Run & manage',
    body:
      "Open any task to Run Now, edit its schedule or command, enable/disable it, or delete it — " +
      "all from Cronsole, no Task Scheduler needed. Failed runs are flagged on the card, and Run History shows the log."
  },
  {
    icon: '🧩',
    title: 'Use & grow templates',
    body:
      "The Templates tab has ready-to-use starters — fill in the blanks and Cronsole creates a real scheduled task. " +
      "Save a real task as a template, or import/export template JSON to share. New templates also arrive from the hosted registry automatically.",
    link: { label: 'Template catalog guide', url: `${DOCS_BASE}/docs/reports/templates/Templates.md` }
  }
];

export interface HelpLink {
  label: string;
  description: string;
  url: string;
}

/** Full guides + reference docs, linked from the Help Center. */
export const HELP_GUIDES: HelpLink[] = [
  {
    label: 'UI User Guide',
    description: 'Dashboard, task details, categorizing, templates, connections',
    url: `${DOCS_BASE}/docs/user-guides/guides/UI_User_Guide.md`
  },
  {
    label: 'Sources Guide',
    description: 'Windows, Cronsole HTTP, Cronsole scripts, Claude — one at a time',
    url: `${DOCS_BASE}/docs/user-guides/guides/Sources_Guide.md`
  },
  {
    label: 'Windows Agent Setup Guide',
    description: 'Install, verify, and troubleshoot the local agent',
    url: `${DOCS_BASE}/docs/user-guides/guides/Agent_Setup_Guide.md`
  },
  {
    label: 'Template Catalog',
    description: 'How templates work + the parameter model',
    url: `${DOCS_BASE}/docs/reports/templates/Templates.md`
  },
  {
    label: 'Template Registry',
    description: 'The public catalog Cronsole fetches — browse or contribute',
    url: 'https://github.com/michaelschecht/cronsole-registry'
  }
];
