import { docLink, uiGuide, sourcesGuide, GUIDES } from './docs';

/**
 * **Per-control help.** Each topic is what one `?` button says.
 *
 * Three rules hold this together, and all three exist because in-app help is a
 * mirror surface — it *describes* the app rather than implementing it, so when
 * it drifts nothing breaks and everything keeps rendering.
 *
 * **1. A topic is a summary of a doc section, never a second copy of it.** The
 * `doc` field is required. If a topic has nothing to link to, the thing it
 * explains is undocumented, and the fix is a doc — not a longer popover that
 * quietly becomes the only place a rule is written down.
 *
 * **2. Points are the surprises, not the description.** Anyone can see what the
 * button says; what they cannot see is that renaming a Windows task renames
 * nothing on the machine, or that a manual run's "success" only means the agent
 * accepted the start. That is what earns the space.
 *
 * **3. Every link is checked.** `__tests__/docsLinks.test.ts` resolves each URL
 * back to a real file and a real heading in this repo, because the failure mode
 * of a stale doc anchor is that GitHub silently serves the top of the page —
 * indistinguishable from a link that worked.
 */

export interface HelpPoint {
  /** The claim, in a few words — rendered bold, scannable on its own. */
  label: string;
  body: string;
}

export interface HelpTopic {
  id: string;
  title: string;
  /** The one-line answer to "what is this?" */
  summary: string;
  points: HelpPoint[];
  /** The doc section this topic summarises. Required — see rule 1 above. */
  doc: { label: string; url: string };
  /** Further reading: a second guide, a troubleshooting entry, an external ref. */
  more?: { label: string; url: string }[];
}

/* ── The general one: the dashboard as a whole ───────────────────────────── */

const dashboard: HelpTopic = {
  id: 'dashboard',
  title: 'The dashboard',
  summary:
    'One list of every scheduled task Cronsole can see, from every system it is connected to. ' +
    'It is organised in layers: source, then view, then filters, each narrower than the last.',
  points: [
    {
      label: 'Source is the outer lens',
      body:
        'The top row picks which system tasks come from. It stays lit while you change views, ' +
        'because "failing Windows tasks" is two constraints and both are on screen.'
    },
    {
      label: 'A view is a named set of filters',
      body:
        'Failures, Due today, Disabled and the rest are one click instead of four filters ' +
        'rebuilt by hand. Save your own; every view is a bookmarkable URL.'
    },
    {
      label: 'What is hidden is never hidden',
      body:
        'Two defaults hold rows back — Windows\' own tasks, and disabled ones. Both say so on ' +
        'the toolbar with a count, and the label is also the button that undoes it.'
    },
    {
      label: 'The health strip is one line',
      body:
        'Under the title: whether platforms are reachable, when Cronsole last really synced, ' +
        'and the last command it sent. "Connected" and "synced" are different facts.'
    }
  ],
  doc: { label: 'UI User Guide › The Dashboard', url: uiGuide('1-the-dashboard') },
  more: [{ label: 'Sources Guide', url: sourcesGuide() }]
};

/* ── Sources ─────────────────────────────────────────────────────────────── */

const sources: HelpTopic = {
  id: 'sources',
  title: 'Where tasks come from',
  summary:
    'A source is the system a task lives on. It is the first thing you ask about a task, so it ' +
    'gets the outermost control — above the saved views, not inside the Filters drawer.',
  points: [
    {
      label: 'A source is finer than a platform',
      body:
        'Cronsole-native holds two genuinely different kinds of task, so this bar splits ' +
        'Cronsole (HTTP) from Cronsole (Scripts). The Platforms tab does not — they are one ' +
        'connector with identical capabilities.'
    },
    {
      label: 'It composes with views',
      body:
        'Picking a source does not reset the view bar. Select Windows and click Failures and ' +
        'both stay lit, because both constraints are visible at once.'
    },
    {
      label: 'The counts are what you would see',
      body:
        'Each number is taken under every other lens still in force — so with a source ' +
        'selected, "My jobs 1" means one, not 88 across everything.'
    },
    {
      label: 'A source may read 0',
      body:
        'That means you have tasks from it but none survive the current view. The button stays ' +
        'so you can click back out. It vanishes only when you have none from that source at all.'
    }
  ],
  doc: { label: 'Sources Guide › What a source is', url: sourcesGuide('what-a-source-is') },
  more: [{ label: 'UI User Guide › Source bar', url: uiGuide('source--where-a-task-comes-from') }]
};

const sourceWindows: HelpTopic = {
  id: 'source:WINDOWS_TASK_SCHEDULER',
  title: 'Windows Task Scheduler',
  summary:
    'Your machine\'s own scheduler, reached through the local Cronsole agent. These are real ' +
    'Task Scheduler entries: they exist without Cronsole and keep running when it is off.',
  points: [
    {
      label: 'Everything here needs the agent',
      body:
        'The agent is the only thing that can touch Task Scheduler. Offline, Cronsole can still ' +
        'show and re-label these tasks but cannot run, create, edit or delete one.'
    },
    {
      label: 'A folder is a category',
      body:
        'The category is the task\'s top-level Task Scheduler folder. Re-label it in Cronsole and ' +
        'it stays re-labelled — but nothing moves on the machine, and the two have then forked.'
    },
    {
      label: '"Ran successfully" means "the agent accepted the start"',
      body:
        'Cronsole fires the task and Windows takes over. The real outcome is Windows\' own ' +
        'result code, which is what Task health reads — use that, not Run History, to ask ' +
        'whether it worked.'
    },
    {
      label: 'A scheduled run leaves no row',
      body:
        'Run history covers runs Cronsole performed. A task firing at 3am on its own is not ' +
        'recorded, so an empty history means Cronsole triggered nothing — not that nothing ran.'
    },
    {
      label: 'Cronsole creates only \\Cronsole',
      body:
        'The agent runs elevated, so a folder it creates can only be deleted by an administrator. ' +
        'Make the folder in Task Scheduler yourself and it appears in the picker. \\Microsoft\\ is ' +
        'refused outright.'
    }
  ],
  doc: { label: 'Sources Guide › Windows Task Scheduler', url: sourcesGuide('windows-task-scheduler') },
  more: [{ label: 'Windows Agent Setup Guide', url: docLink(`${GUIDES}/Agent_Setup_Guide.md`) }]
};

const sourceNativeHttp: HelpTopic = {
  id: 'source:TASKHUB_NATIVE:HTTP',
  title: 'Cronsole (HTTP)',
  summary:
    'Call a URL on a schedule — webhooks, health checks, deploy hooks. Cronsole makes the ' +
    'request itself: no Windows entry, no agent, and the database row is the task.',
  points: [
    {
      label: 'It runs while the backend runs',
      body:
        'No agent needed, so these keep working when the agent is offline — and stop when ' +
        'Cronsole is down. Use a Windows task for anything that must survive that.'
    },
    {
      label: 'The URL is editable',
      body:
        'Edit on the Action panel rewrites the whole job — URL, method, headers, body. Headers ' +
        'take "Name: value" lines or JSON. This used to need deleting the task and starting over.'
    },
    {
      label: 'The run history is real',
      body:
        'Cronsole performed the request, so the status and duration describe the actual call — ' +
        'unlike a Windows manual run, which times a handshake.'
    },
    {
      label: 'Daylight saving shifts these by an hour',
      body:
        'Cronsole evaluates the stored UTC schedule directly. A Windows task keeps its local ' +
        'clock time instead — the two genuinely differ, and the app says so where you edit.'
    }
  ],
  doc: { label: 'Sources Guide › Cronsole (HTTP)', url: sourcesGuide('cronsole-http') },
  more: [{ label: 'UI User Guide › Creating a native task', url: uiGuide('creating-a-cronsole-native-task') }]
};

const sourceNativeExec: HelpTopic = {
  id: 'source:TASKHUB_NATIVE:EXEC',
  title: 'Cronsole (Scripts)',
  summary:
    'Run a program on a schedule, with its exit code, duration and output recorded. Same ' +
    'platform as Cronsole (HTTP) — separated here because they are different things to look at.',
  points: [
    {
      label: 'There is no shell',
      body:
        'The command is split into a program and its arguments, so && | and > are ordinary ' +
        'characters. Name the shell yourself — cmd.exe /c "…" or /bin/sh -c "…" — if you need them.'
    },
    {
      label: 'It runs wherever the backend runs',
      body:
        'Usually your machine. On a Dockerized stack it runs inside the container, against a ' +
        'filesystem that is not yours — a path you can see in Explorer fails as "executable not ' +
        'found". The form states which before you click.'
    },
    {
      label: 'It does not inherit Cronsole\'s environment',
      body:
        'The program gets OS essentials plus whatever you set explicitly — not Cronsole\'s own ' +
        'variables, which include the key encrypting your stored platform credentials.'
    },
    {
      label: 'Use a Windows task to run as your user',
      body:
        'The agent is the thing that unambiguously means "your machine". The backend is not.'
    }
  ],
  doc: { label: 'Sources Guide › Cronsole (Scripts)', url: sourcesGuide('cronsole-scripts') },
  more: [{ label: 'UI User Guide › Creating a native task', url: uiGuide('creating-a-cronsole-native-task') }]
};

const sourceNative: HelpTopic = {
  ...sourceNativeHttp,
  id: 'source:TASKHUB_NATIVE',
  title: 'Cronsole-native',
  summary:
    'Scheduled and executed by Cronsole itself — nothing in Windows Task Scheduler, no agent ' +
    'involved. Two kinds: an HTTP request, or a program to run.',
  doc: { label: 'Sources Guide › Cronsole (HTTP)', url: sourcesGuide('cronsole-http') },
  more: [{ label: 'Sources Guide › Cronsole (Scripts)', url: sourcesGuide('cronsole-scripts') }]
};

const sourceClaude: HelpTopic = {
  id: 'source:CLAUDE_CODE',
  title: 'Claude Code routines',
  summary:
    'Fire a routine that already exists at claude.ai. Anthropic exposes one routines endpoint ' +
    'and calling it runs the routine — everything about this source follows from that.',
  points: [
    {
      label: 'Connect, not create',
      body:
        'There is no create endpoint, so the New Task form is titled "Connect a routine" for ' +
        'this option and asks for an id and a token instead of a schedule.'
    },
    {
      label: 'Your list is your own declaration',
      body:
        'Nothing can enumerate routines, so "sync" returns what you typed in. The registry is ' +
        'the platform.'
    },
    {
      label: 'The token is shown once, by claude.ai',
      body:
        'Cronsole stores it encrypted and never displays it again — there is no reveal button, ' +
        'because claude.ai cannot re-display it either. Mistyped the id? Edit keeps the token.'
    },
    {
      label: 'Remove from Cronsole is refused — use Disconnect routine',
      body:
        'Removing the row alone left the declaration behind, so the next sync brought the task ' +
        'straight back. Disconnect removes both — and forgets the token, which is why it is a ' +
        'separate button rather than folded into the safe-sounding one.'
    },
    {
      label: 'The card shows no schedule, and that is honest',
      body:
        'The cadence lives at claude.ai and is unreadable from here, so Cronsole shows what it ' +
        'knows rather than a guess. Run now works regardless. Pausing also stays at claude.ai.'
    }
  ],
  doc: { label: 'Sources Guide › Claude Code routines', url: sourcesGuide('claude-code-routines') },
  more: [
    {
      label: 'Troubleshooting #47 — a Claude task keeps coming back',
      url: docLink(
        'docs/troubleshooting/README.md',
        '47-a-claude-task-keeps-coming-back-after-remove-from-cronsole'
      )
    }
  ]
};

/* ── Creating a task ─────────────────────────────────────────────────────── */

const schedule: HelpTopic = {
  id: 'schedule',
  title: 'Schedules and timezones',
  summary:
    'Five-field cron — minute, hour, day, month, weekday — typed in your schedule timezone and ' +
    'stored in UTC. The stored form is printed under the field so the two can never disagree.',
  points: [
    {
      label: 'You type in your zone, not UTC',
      body:
        '"0 8" means 8am where you are. The zone is Settings › Behavior › Schedule timezone, ' +
        'Pacific by default, and every clock time in the app follows it.'
    },
    {
      label: 'UTC is what gets stored',
      body:
        'That is what the API, the MCP tools and Windows Task Scheduler see — so each cron ' +
        'field prints the stored expression beside it rather than hiding the conversion.'
    },
    {
      label: 'Daylight saving is not symmetric',
      body:
        'A Windows task keeps its local clock time across a change; a Cronsole-native task ' +
        'shifts by an hour, because Cronsole runs the stored UTC expression directly.'
    },
    {
      label: 'Windows triggers are previewed before you commit',
      body:
        'Not every cron maps cleanly onto a native Windows trigger. Warnings appear under the ' +
        'field as you type, rather than after the task exists.'
    }
  ],
  doc: { label: 'UI User Guide › Task Details', url: uiGuide('2-task-details') },
  more: [{ label: 'crontab.guru — cron expression tester', url: 'https://crontab.guru' }]
};

const nativeJobType: HelpTopic = {
  id: 'native-job-type',
  title: 'HTTP request or Run a program',
  summary:
    'What a Cronsole-native task does. Both are scheduled and executed by the Cronsole backend; ' +
    'they differ in what happens when the schedule fires.',
  points: [
    {
      label: 'HTTP request',
      body:
        'Cronsole calls a URL — method, headers and body are yours to set. Good for webhooks, ' +
        'health checks and anything with an endpoint.'
    },
    {
      label: 'Run a program',
      body:
        'Cronsole starts an executable and records its exit code, duration and output. No shell: ' +
        'the command is split into a program and arguments.'
    },
    {
      label: 'You can switch later, but not merge',
      body:
        'Editing a task can convert one into the other. The job is replaced — the old type\'s ' +
        'fields are discarded, and the form names them before you click. Name, schedule, category ' +
        'and run history all survive.'
    }
  ],
  doc: { label: 'UI User Guide › Creating a native task', url: uiGuide('creating-a-cronsole-native-task') },
  more: [{ label: 'Sources Guide › Cronsole (Scripts)', url: sourcesGuide('cronsole-scripts') }]
};

const command: HelpTopic = {
  id: 'command',
  title: 'What the task runs',
  summary:
    'A command line — the program, then its arguments. Cronsole splits it and starts the ' +
    'program directly; nothing is handed to a shell.',
  points: [
    {
      label: 'No shell means no operators',
      body:
        '&& | > and friends are ordinary characters here. If you want them, name the shell ' +
        'yourself: cmd.exe /c "…" or /bin/sh -c "…". Implicit shells are how a task name becomes ' +
        'a command injection.'
    },
    {
      label: 'Quote paths containing spaces',
      body:
        '"C:\\Program Files\\node.exe" --version parses as one program and one argument. ' +
        'Unquoted, it would be three.'
    },
    {
      label: 'Where it runs depends on the source',
      body:
        'A Windows task runs on your machine as your user. A Cronsole script runs wherever the ' +
        'backend runs — inside the container on a Dockerized stack. The form states which.'
    }
  ],
  doc: { label: 'UI User Guide › Creating a native task', url: uiGuide('creating-a-cronsole-native-task') },
  more: [{ label: 'Sources Guide › Cronsole (Scripts)', url: sourcesGuide('cronsole-scripts') }]
};

/* ── Managing a task ─────────────────────────────────────────────────────── */

const taskActions: HelpTopic = {
  id: 'task-actions',
  title: 'Managing a task',
  summary:
    'Everything in this modal acts on one task. The buttons differ by source, because what is ' +
    'possible differs by source — and two of them look similar and are not.',
  points: [
    {
      label: 'Rename changes a Cronsole label only',
      body:
        'Nothing is renamed on your machine. A Windows task\'s real name is the last part of its ' +
        'Task Scheduler path, and that path is how every command addresses it — so once the two ' +
        'differ, the modal keeps showing the real one.'
    },
    {
      label: 'Edit means two different things',
      body:
        'For a Windows task, Cronsole asks the agent to rewrite the real entry and records ' +
        'nothing until Windows confirms. For a native task the row is the task, so the write is ' +
        'the change — no agent, nothing that can refuse.'
    },
    {
      label: 'Remove from Cronsole is the safe one',
      body:
        'It stops tracking the task here; the scheduled task keeps running on the machine, and ' +
        'sync will not pull it back. Import re-adds it.'
    },
    {
      label: 'Delete from Windows is not reversible',
      body:
        'The real Task Scheduler entry goes first, via the agent; Cronsole\'s record only goes ' +
        'once Windows confirms. If the agent is offline, the delete is refused rather than faked.'
    },
    {
      label: 'A Claude routine gets Disconnect instead',
      body:
        'It removes the declaration and the tracked task together, and forgets the stored API ' +
        'token — which claude.ai shows only once. The routine itself keeps running there.'
    }
  ],
  doc: {
    label: 'UI User Guide › Removing a task',
    url: uiGuide('removing-a-task--two-very-different-buttons')
  },
  more: [
    { label: 'UI User Guide › Renaming a task', url: uiGuide('renaming-a-task') },
    { label: 'UI User Guide › Editing what a task runs', url: uiGuide('editing-what-a-task-runs') }
  ]
};

/* ── Dashboard controls ──────────────────────────────────────────────────── */

const views: HelpTopic = {
  id: 'views',
  title: 'Saved views',
  summary:
    'A view is a named set of filters, so the question you actually ask — "what is failing?", ' +
    '"what runs today?" — is one click rather than four filters rebuilt from scratch.',
  points: [
    {
      label: 'Six ship built in',
      body:
        'All, Favorites, My jobs, Failures, Due today, Disabled and System. Disabled isolates ' +
        'parked tasks; that is not the same as the Status filter merely including them.'
    },
    {
      label: 'Changing any filter drops you to Custom',
      body:
        'On purpose. Narrow "Failures" to one category and the list is no longer what that label ' +
        'says it is. Source is the exception — it has its own visible bar.'
    },
    {
      label: 'Every view is a link',
      body:
        'The URL carries the view or the raw filters, so you can bookmark one or paste it to ' +
        'another machine.'
    },
    {
      label: 'Failures shows – until the scan lands',
      body:
        'Not 0. With no health data every task is unknown and the list renders empty — and an ' +
        'empty list would claim nothing is failing before the app had looked.'
    }
  ],
  doc: { label: 'UI User Guide › Saved views', url: uiGuide('saved-views') }
};

const filters: HelpTopic = {
  id: 'filters',
  title: 'Filters',
  summary:
    'Status, ownership and category. Platform is not in here — it graduated to the Source bar ' +
    'above. The number on the button is how many filters are set.',
  points: [
    {
      label: 'Two defaults are hiding rows right now',
      body:
        'Windows\' own tasks, and disabled ones. Neither is a choice you made today, so both are ' +
        'printed on the toolbar with a count — and the label is the button that undoes it.'
    },
    {
      label: 'Isolating is not including',
      body:
        '"Disabled only" shows you less, not more. An isolated state gets its own pill outside ' +
        'the menu so it cannot be mistaken for a normal view.'
    },
    {
      label: 'The counts are faceted',
      body:
        'Each option shows what you would see after clicking, under the filters already applied. ' +
        'Options with nothing under them drop out rather than showing a zero.'
    }
  ],
  doc: { label: 'UI User Guide › Views, Search & Filters', url: uiGuide('views-search--filters') }
};

const importSync: HelpTopic = {
  id: 'import',
  title: 'Import vs. Sync',
  summary:
    'Import discovers tasks and adds them. Sync refreshes the ones you already track. They are ' +
    'not interchangeable, and mistaking one for the other is the most expensive confusion here.',
  points: [
    {
      label: 'Sync cannot discover anything',
      body:
        'It re-pulls status and schedules for folders you already track. A folder you have never ' +
        'imported stays invisible however many times you sync — and every sync still reports success.'
    },
    {
      label: 'Sync says what it left behind',
      body:
        '"26 tasks in 2 folders aren\'t imported" — Windows\' own tasks excluded, so the number ' +
        'means yours. That message is the only prompt that Import exists.'
    },
    {
      label: 'Import brings removed tasks back',
      body:
        'A category holding tasks you removed shows an amber +N badge, so you see the number ' +
        'before committing.'
    },
    {
      label: 'A category is a folder',
      body:
        'For Windows, importing a category imports a real Task Scheduler folder. That is also ' +
        'why re-importing is how you undo a removal.'
    }
  ],
  doc: { label: 'UI User Guide › System Status & Connections', url: uiGuide('7-system-status--connections') }
};

/* ── Tabs ────────────────────────────────────────────────────────────────── */

const templates: HelpTopic = {
  id: 'templates',
  title: 'Templates',
  summary:
    'A catalog of automation patterns you fill in and apply. Applying one creates a real ' +
    'scheduled task — on your machine via the agent, or in Cronsole itself.',
  points: [
    {
      label: 'Starters vs. patterns',
      body:
        'Starters are parameterized building blocks (run a script, ping a URL). Patterns are ' +
        'ready-made jobs. Both ask for the blanks and validate as you go.'
    },
    {
      label: 'Built-in vs. import',
      body:
        'A small curated set ships with Cronsole; the rest of the catalog is a click away in the ' +
        'gallery. New ones arrive from the hosted registry without updating the app.'
    },
    {
      label: 'A compatible target is not a compiled one',
      body:
        'A template can list a platform Cronsole has no compiler for. That is the honest ' +
        '"copy this and set it up yourself" path, not a silent failure.'
    },
    {
      label: 'You can grow the catalog',
      body:
        'Save any real task as a template, or import and export template JSON to share one.'
    }
  ],
  doc: { label: 'UI User Guide › Templates', url: uiGuide('4-templates') },
  more: [{ label: 'Template catalog reference', url: docLink('docs/reports/templates/Templates.md') }]
};

const platforms: HelpTopic = {
  id: 'platforms',
  title: 'What Cronsole can do here',
  summary:
    'One row per platform, answering "what happens if I click this?" — in three states, each ' +
    'about this install rather than about the code.',
  points: [
    {
      label: 'Verified means it worked here',
      body:
        'On this machine, with the timestamp that proved it. Not a claim from a spec table.'
    },
    {
      label: 'Declared is not a promise',
      body:
        'Cronsole will attempt it; nothing has been observed to succeed yet. A fresh install is ' +
        'almost all Declared, and that is correct rather than pessimistic — nothing has been tried.'
    },
    {
      label: 'Unsupported is a boundary, not a gap',
      body:
        'The request would be refused because no such API exists. Waiting for it to turn ' +
        'Verified would be waiting for evidence that can never arrive.'
    },
    {
      label: 'Connected is not synced',
      body:
        'The row shows both. An agent can be reachable while its task list is a day old, so the ' +
        'two facts are never collapsed into one.'
    }
  ],
  doc: { label: 'UI User Guide › Platforms', url: uiGuide('6-platforms--what-cronsole-can-actually-do') },
  more: [{ label: 'Sources Guide', url: sourcesGuide() }]
};

/* ── Tools ───────────────────────────────────────────────────────────────── */

const massActions: HelpTopic = {
  id: 'mass-actions',
  title: 'Mass actions',
  summary:
    'The one place Cronsole changes many tasks at once. Action first, then scope — so you can ' +
    'see exactly which tasks would change before anything happens.',
  points: [
    {
      label: 'Scope is stated in words',
      body:
        '"Scope: the Backups category" — because "254 selected" is not something you can check, ' +
        'and a scope you can name is.'
    },
    {
      label: 'Past 25 tasks you have to type the count',
      body:
        'A dialog dismissed by the same click in the same place stops being a decision once you ' +
        'have seen it a few times. Friction has to scale with blast radius.'
    },
    {
      label: 'The count is what would change',
      body:
        'Not the scope size. 80 tasks where 70 already run gives you "Enable 10 — 80 in scope, ' +
        '70 need no change".'
    },
    {
      label: 'It reports per task, not per batch',
      body:
        'Updated, unchanged, refused, failed, skipped. If the agent disappears partway the run ' +
        'stops and the remainder is listed as not attempted, rather than silently dropped.'
    },
    {
      label: 'Enable and disable can be undone',
      body:
        'One click puts back exactly what changed. Removing is undone by re-importing; ' +
        'recategorizing cannot be undone, and the card says so instead of offering a button that ' +
        'would not work.'
    }
  ],
  doc: { label: 'UI User Guide › Mass actions', url: uiGuide('mass-actions') }
};

const taskHealth: HelpTopic = {
  id: 'task-health',
  title: 'Task health',
  summary:
    'Which of your tasks need attention — the question a few hundred rows cannot answer by ' +
    'scrolling. It always gives an answer, including when the answer is "nothing".',
  points: [
    {
      label: 'Four tiers, and the third one matters',
      body:
        'Critical, Attention, Unknown, Healthy. Unknown means Cronsole has no evidence — most ' +
        'often an agent predating run-result reporting. It is deliberately not shown as healthy.'
    },
    {
      label: 'Every signal names its source',
      body:
        '"Windows recorded exit code 2 for the run at …". The score ranks the list; it is not a ' +
        'grade, and it never appears without the signals that produced it.'
    },
    {
      label: 'Disabled is not unhealthy',
      body:
        'Parking a task is a normal thing to do. The card says so rather than nagging about a ' +
        'task you switched off on purpose.'
    },
    {
      label: 'This is where Windows outcomes live',
      body:
        'It reads Windows\' own result code, not Cronsole\'s run log — which is why it can judge ' +
        'tasks Cronsole has never triggered.'
    }
  ],
  doc: { label: 'UI User Guide › Task health', url: uiGuide('task-health') }
};

/* ── The catalog ─────────────────────────────────────────────────────────── */

const TOPIC_LIST: HelpTopic[] = [
  dashboard,
  sources,
  sourceWindows,
  sourceNative,
  sourceNativeHttp,
  sourceNativeExec,
  sourceClaude,
  schedule,
  nativeJobType,
  command,
  taskActions,
  views,
  filters,
  importSync,
  templates,
  platforms,
  massActions,
  taskHealth
];

export const HELP_TOPICS: Record<string, HelpTopic> = Object.fromEntries(
  TOPIC_LIST.map(t => [t.id, t])
);

/** Every topic, in the order the Help Center's index lists them. */
export const helpTopics = (): HelpTopic[] => TOPIC_LIST;

export const helpTopic = (id: string): HelpTopic | undefined => HELP_TOPICS[id];

/**
 * The topic id for a **source key** (`WINDOWS_TASK_SCHEDULER`,
 * `TASKHUB_NATIVE:EXEC`, …).
 *
 * Falls back from the full key to the bare platform to the general `sources`
 * topic, mirroring how `sourceLabel` degrades: a source added server-side before
 * it is written up here still opens something true rather than nothing at all.
 */
export const sourceTopicId = (key: string): string => {
  if (HELP_TOPICS[`source:${key}`]) return `source:${key}`;
  const platform = key.split(':')[0];
  if (HELP_TOPICS[`source:${platform}`]) return `source:${platform}`;
  return 'sources';
};
