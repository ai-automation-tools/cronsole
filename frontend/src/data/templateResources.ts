/**
 * Curated links surfaced by the Templates-tab "Resources" menu. Kept as data
 * (not inline JSX) so the catalog is maintainable outside the React component —
 * mirrors the docs under `docs/resources/websites/` + `docs/resources/repos/`
 * and the template spec at `docs/reports/templates/Templates.md`. Add entries
 * here as the ecosystem grows.
 */
export interface ResourceLink {
  label: string;
  url: string;
  description?: string;
}

export interface ResourceSection {
  title: string;
  links: ResourceLink[];
}

const REPO = 'https://github.com/michaelschecht/taskhub/blob/main';

export const TEMPLATE_RESOURCES: ResourceSection[] = [
  {
    title: 'Cronsole docs',
    links: [
      {
        label: 'Template catalog spec',
        url: `${REPO}/docs/reports/templates/Templates.md`,
        description: 'How templates, parameters, and placeholders work.'
      },
      {
        label: 'UI User Guide',
        url: `${REPO}/docs/user-guides/guides/UI_User_Guide.md`,
        description: 'Using the dashboard, templates, and platforms tabs.'
      },
      {
        label: 'Example template payloads',
        url: `${REPO}/docs/reports/examples/templates.json`,
        description: 'The JSON shape behind list / apply — basis for import/export.'
      }
    ]
  },
  {
    title: 'Scheduler references',
    links: [
      {
        label: 'crontab.guru',
        url: 'https://crontab.guru/',
        description: 'Sanity-check 5-field cron expressions (Cronsole stores UTC cron).'
      },
      {
        label: 'Windows Task Scheduler docs',
        url: 'https://learn.microsoft.com/en-us/windows/win32/taskschd/task-scheduler-start-page',
        description: 'Reference for the platform the Windows agent wraps.'
      }
    ]
  },
  {
    title: 'AI / agent workflows',
    links: [
      {
        label: 'Claude Routines',
        url: 'https://claude.ai/code/routines',
        description: 'Scheduled Claude Code runs — the experimental connector target.'
      },
      { label: 'ChatGPT Schedules', url: 'https://chatgpt.com/schedules' },
      { label: 'Gemini Scheduled', url: 'https://gemini.google.com/scheduled' }
    ]
  },
  {
    title: 'Template repositories',
    links: [
      {
        label: 'michaelschecht/taskhub',
        url: 'https://github.com/michaelschecht/taskhub',
        description: 'This project — seed catalog lives in backend/src/seed.ts.'
      },
      {
        label: 'TaskScheduler (.NET wrapper)',
        url: 'https://github.com/dahall/TaskScheduler',
        description: 'The library the Windows agent uses under the hood.'
      }
    ]
  }
];
