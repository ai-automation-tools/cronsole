import { docLink, uiGuide, sourcesGuide, GUIDES } from './docs';
import { sourcePlatform } from '../platform';

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
    'It is organised in layers: the rail on the left says WHERE, a view says WHICH SLICE, and ' +
    'the filters narrow it further.',
  points: [
    {
      label: 'The rail is where a task lives',
      body:
        'Left side: each system you are connected to, opening to that system’s own grouping — ' +
        'Task Scheduler folders for Windows, job type for Cronsole. Moving around it never ' +
        'changes which view you are in, because navigating is not filtering.'
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
    },
    {
      label: '"Not checked" is not a warning',
      body:
        'It means there is no current evidence — usually a platform nothing has asked anything ' +
        'of in a while, since Cronsole does not poll your agent in the background. Press Sync ' +
        'for a real answer; restarting clears it whether or not anything was wrong.'
    }
  ],
  doc: { label: 'UI User Guide › The Dashboard', url: uiGuide('1-the-dashboard') },
  more: [
    { label: 'Sources Guide', url: sourcesGuide() },
    { label: 'UI User Guide › System Status & Connections', url: uiGuide('7-system-status--connections') }
  ]
};

/* ── Sources ─────────────────────────────────────────────────────────────── */

const sources: HelpTopic = {
  id: 'sources',
  title: 'Where tasks come from',
  summary:
    'A source is the system a task lives on. It is the first thing you ask about a task, so it ' +
    'is the rail down the left — navigation, not a filter buried in a drawer.',
  points: [
    {
      label: 'Each source opens to its own grouping',
      body:
        'Windows opens to your real Task Scheduler folders. Cronsole-native opens to its job ' +
        'type — HTTP jobs and Scripts — which are the same connector with identical ' +
        'capabilities, so the Sources tab does not split them.'
    },
    {
      label: 'It composes with views',
      body:
        'Moving around the rail does not reset the view bar. Select Windows, then a folder, ' +
        'then click Failures — all of it stays lit, because every constraint is visible at once.'
    },
    {
      label: 'Favorites is a row here too',
      body:
        'Second from the top, under All sources. It narrows to your starred tasks and leaves ' +
        'your view alone, so Failures + Favorites is your failing starred tasks.'
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
        'That means none of its tasks survive the current view — or you are connected to it and ' +
        'have imported nothing yet. The row stays either way, so you can always click into it.'
    },
    {
      label: 'A fresh install lists two sources',
      body:
        'Windows Task Scheduler and Cronsole-native — the two that need no credential. Everything ' +
        'else is added from Explore sources, below the tree. A sidebar of empty rows waiting on ' +
        'tokens nobody has yet is how a first run teaches you that most of the product is broken.'
    },
    {
      label: 'Explore and Manage are under the tree',
      body:
        'Explore sources shows everything Cronsole can connect to, including what you have not ' +
        'added. Manage sources is where you connect, disconnect, and choose which sources this ' +
        'sidebar lists. A source holding tasks can never be hidden, and connecting one shows it.'
    }
  ],
  doc: { label: 'Sources Guide › What a source is', url: sourcesGuide('what-a-source-is') },
  more: [
    { label: 'Sources Guide › Choosing which sources you see', url: sourcesGuide('choosing-which-sources-you-see') },
    { label: 'UI User Guide › The source rail', url: uiGuide('source--where-a-task-comes-from') }
  ]
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

const sourceNativeScript: HelpTopic = {
  id: 'source:TASKHUB_NATIVE:SCRIPT',
  title: 'Cronsole (Scripts)',
  summary:
    'Write the script here and Cronsole runs it on your schedule under an interpreter you pick. ' +
    'Nothing has to exist on disk first.',
  points: [
    {
      label: 'The script lives in Cronsole, not on a disk somewhere',
      body:
        'It is written to a temporary file at run time and deleted afterwards. That means you can ' +
        'read and edit it here, it is included when you export or delete the task, and it works on ' +
        'a fresh install — none of which is true of a program that just points at a path.'
    },
    {
      label: 'This is the one place a shell is expected',
      body:
        'You picked the interpreter and wrote the body, so pipes, && and redirection all work ' +
        'normally. The interpreter itself is a fixed list — it is never a path you type.'
    },
    {
      label: 'The interpreter has to exist where the backend runs',
      body:
        'Node always does; Cronsole itself runs on it. PowerShell and Python may not, especially ' +
        'inside a container — the run log says so by name rather than reporting a missing file.'
    },
    {
      label: 'It does not inherit Cronsole\'s environment',
      body:
        'The script gets OS essentials plus whatever you set explicitly — not Cronsole\'s own ' +
        'variables, which include the key encrypting your stored platform credentials.'
    }
  ],
  doc: { label: 'Sources Guide › Cronsole (Scripts)', url: sourcesGuide('cronsole-scripts') },
  more: [{ label: 'UI User Guide › Creating a native task', url: uiGuide('creating-a-cronsole-native-task') }]
};

const sourceNativeCheck: HelpTopic = {
  id: 'source:TASKHUB_NATIVE:CHECK',
  title: 'Cronsole (Checks)',
  summary:
    'Measure something on a schedule and compare it to what you expect — an endpoint, a port, a ' +
    'file that should still be fresh, or free disk space.',
  points: [
    {
      label: 'A failure here is a fact about your system',
      body:
        'That is what separates a check from every other job type. A failed script is usually a bug ' +
        'in the script; a failed check is the thing you wanted to know about — which is why these ' +
        'are the runs worth wiring failure notifications to.'
    },
    {
      label: 'A 200 is not the same as healthy',
      body:
        'An endpoint check can require the body to contain something, or a JSON field to have a ' +
        'given value. An HTTP *job* only asks whether the request was accepted — that is the right ' +
        'test for firing a webhook and the wrong one for monitoring.'
    },
    {
      label: 'File and disk checks measure the backend\'s machine',
      body:
        'Not the machine you are browsing from. On a Dockerized stack that is the container\'s ' +
        'filesystem — a check that passes against the wrong disk is worse than no check, so the ' +
        'form names the host before you save.'
    },
    {
      label: 'A missing file fails the freshness check',
      body:
        'Deliberately. This check exists to notice that a backup stopped being written, and a ' +
        'backup that was never written is the same problem in its worst form.'
    }
  ],
  doc: { label: 'Sources Guide › Cronsole (Checks)', url: sourcesGuide('cronsole-checks') },
  more: [{ label: 'UI User Guide › Creating a native task', url: uiGuide('creating-a-cronsole-native-task') }]
};

const sourceNativeExecPrograms: HelpTopic = {
  ...sourceNativeExec,
  id: 'source:TASKHUB_NATIVE:EXEC',
  title: 'Cronsole (Programs)',
  summary:
    'Run a program that already exists on the machine the backend runs on, with its exit code, ' +
    'duration and output recorded. To write the script itself here instead, use Scripts.'
};

const sourceNative: HelpTopic = {
  ...sourceNativeHttp,
  id: 'source:TASKHUB_NATIVE',
  title: 'Cronsole-native',
  summary:
    'Scheduled and executed by Cronsole itself — nothing in Windows Task Scheduler, no agent ' +
    'involved. Four kinds: call a URL, run a program, run a script you write here, or check ' +
    'that something is as it should be.',
  doc: { label: 'Sources Guide › Cronsole (HTTP)', url: sourcesGuide('cronsole-http') },
  more: [
    { label: 'Sources Guide › Cronsole (Scripts)', url: sourcesGuide('cronsole-scripts') },
    { label: 'Sources Guide › Cronsole (Checks)', url: sourcesGuide('cronsole-checks') }
  ]
};

const sourceGitHub: HelpTopic = {
  id: 'source:GITHUB_ACTIONS',
  title: 'GitHub Actions',
  summary:
    'Scheduled workflows in the repositories you watch. Read-only: Cronsole shows their crons and ' +
    'how their last runs actually went, and changes nothing.',
  points: [
    {
      label: 'Read-only is the whole shape, not a first version',
      body:
        'Every mutating capability reads Unsupported on the Sources tab and that is deliberate — ' +
        'the row is labelled Observer for that reason. Running, pausing and editing a workflow ' +
        'happen on GitHub: Cronsole will not commit to your repository, and a workflow_dispatch ' +
        'run is not the scheduled run you came to check. Of the three, only Enable/disable is a ' +
        'candidate to unlock later, and it would arrive with its own scope and its own confirmation.'
    },
    {
      label: 'These crons are already UTC, so nothing is converted',
      body:
        'GitHub documents on: schedule as UTC with no timezone support, which is exactly how ' +
        'Cronsole stores every schedule. This is the one source with no conversion layer and none ' +
        'of the DST asymmetry a Windows trigger carries.'
    },
    {
      label: 'The run outcomes here are real outcomes',
      body:
        'GitHub reports whether the run succeeded, failed, timed out or was cancelled — the result ' +
        'of the work. A Windows task can only tell Cronsole that the agent accepted a start, so ' +
        'health scoring is better founded here than on the platform Cronsole controls most.'
    },
    {
      label: 'GitHub disables scheduled workflows after 60 days of quiet',
      body:
        'It does this silently on a repository with no activity. Cronsole surfaces it as its own ' +
        'health signal with GitHub\'s reason attached, which is usually the first anyone hears ' +
        'that a nightly workflow stopped two months ago.'
    },
    {
      label: 'You watch a repository, not a workflow',
      body:
        'The repository is the category, so adding one brings in every scheduled workflow it has ' +
        'and stopping brings them all out. To drop a single workflow while keeping the rest, use ' +
        'Remove from Cronsole on that task.'
    },
    {
      label: 'A private repository that 404s is usually a scope, not a typo',
      body:
        'GitHub answers 404 rather than 403 for anything a token cannot see, so "not found" is the ' +
        'expected symptom of a token missing the repo scope. Cronsole says so in the error rather ' +
        'than sending you to check the spelling.'
    },
    {
      label: 'No next-run time, and that is honest',
      body:
        'GitHub queues scheduled runs on a best-effort basis and delays them under load. A time ' +
        'computed from the cron would disagree with what actually happens, with nothing on screen ' +
        'to say which was right — so Cronsole shows the cron and no prediction.'
    }
  ],
  doc: { label: 'Sources Guide › GitHub Actions', url: sourcesGuide('github-actions') }
};

const sourceVercel: HelpTopic = {
  id: 'source:VERCEL_CRON',
  title: 'Vercel Cron',
  summary:
    'Cron jobs declared by the Vercel projects you watch. Read-only, and Vercel publishes no run ' +
    'history for them — Cronsole shows their schedules, never how they went.',
  points: [
    {
      label: 'Health here is always unknown, and that is the honest answer',
      body:
        'Vercel publishes no run history for a cron job — invocations appear only in the project\'s ' +
        'function logs, behind no API. So Cronsole has nothing to score with and says so. Reporting ' +
        '"enabled, therefore healthy" instead would be a lie: configured and working are different ' +
        'claims, and only the first is knowable here.'
    },
    {
      label: 'Read-only is the whole shape, not a first version',
      body:
        'Every mutating capability reads Unsupported on the Sources tab and the row is labelled ' +
        'Observer for that reason. Creating one means editing your vercel.json; enabling one is ' +
        'impossible per cron because Vercel turns them on and off for a whole project; and Run now ' +
        'is refused even though a cron path is an ordinary HTTP endpoint — calling it yourself ' +
        'bypasses your CRON_SECRET and is not the scheduled invocation.'
    },
    {
      label: 'These crons are already UTC, so nothing is converted',
      body:
        'Vercel documents cron expressions as UTC with no timezone support, which is exactly how ' +
        'Cronsole stores every schedule. Like GitHub Actions, this source has no conversion layer ' +
        'and none of the DST asymmetry a Windows trigger carries.'
    },
    {
      label: 'You watch a project, not a cron job',
      body:
        'The project name is the category, so adding one brings in every cron it declares and ' +
        'stopping brings them all out. To drop a single cron while keeping the rest, use Remove ' +
        'from Cronsole on that task.'
    },
    {
      label: 'Disabled is a fact about the project, not the cron',
      body:
        'Vercel turns cron jobs on and off for a whole project at once, so when they are off every ' +
        'cron in that project shows as Disabled with that reason attached. There is no per-cron ' +
        'switch to offer.'
    },
    {
      label: 'A team project looked up by name will 404',
      body:
        'A bare project name resolves against your personal account, so one owned by a team is ' +
        'genuinely not there. Paste the dashboard URL instead — it carries the team — or pick the ' +
        'project from the list, which already knows which account it is in.'
    },
    {
      label: 'Renaming the project on Vercel re-keys its tasks',
      body:
        'The project name is part of each cron\'s identity, so a rename retires the old tasks and ' +
        'brings in new ones. Cronsole warns on the sync that first sees it — re-add the project to ' +
        'follow the rename.'
    },
    {
      label: 'No next-run time, and that is honest',
      body:
        'Vercel queues cron invocations on a best-effort basis — on Hobby, within the hour of the ' +
        'scheduled time. A time computed from the cron would disagree with what actually happens, ' +
        'with nothing on screen to say which was right.'
    }
  ],
  doc: { label: 'Sources Guide \u203a Vercel Cron', url: sourcesGuide('vercel-cron') }
};

const sourceGemini: HelpTopic = {
  id: 'source:GEMINI_TRIGGERS',
  title: 'Gemini API Triggers',
  summary:
    'Scheduled prompts Google runs on its own agents in the cloud. The first hosted source Cronsole ' +
    'can act on rather than only read.',
  points: [
    {
      label: 'Run now is the real thing here, unlike the two read-only sources',
      body:
        'GitHub Actions and Vercel Cron both refuse Run now, because the endpoint they would call ' +
        'produces something that only resembles the scheduled run. Gemini runs the trigger\'s own ' +
        'agent, prompt and sandbox, and the run lands on the same execution list the scheduled ones ' +
        'do. Google documents that pausing stops scheduled executions without affecting manual ones ' +
        '— which is the platform saying the two are one mechanism.'
    },
    {
      label: 'A trigger that keeps failing gets paused by Google, not by you',
      body:
        'After a number of consecutive failures — five by default — Gemini disables the trigger ' +
        'itself. Cronsole shows that as its own health warning rather than the ordinary "disabled" ' +
        'note, because nobody chose it: a nightly agent dead for a week otherwise looks exactly ' +
        'like one somebody parked. Resuming clears the pause and not the cause.'
    },
    {
      label: 'One API key, and nothing to pick',
      body:
        'A Gemini API key is scoped to one Google Cloud project and sees every trigger in it, so ' +
        'there are no repositories or projects to name — unlike GitHub Actions and Vercel Cron. ' +
        'Every trigger lands under a single Gemini category.'
    },
    {
      label: 'Gemini stores a time zone; Cronsole stores UTC',
      body:
        'A trigger carries a cron and an IANA zone. Anything Cronsole creates is written as UTC, ' +
        'so the round trip is exact. A trigger made elsewhere in a real zone is ' +
        'converted on the way in, with the platform\'s original pair shown beside it — and where ' +
        'the conversion has no honest answer, the schedule reads as unavailable with the reason, ' +
        'never as a guess.'
    },
    {
      label: 'Creating one asks for a prompt, not a command',
      body:
        'The unit of work here is a sentence for an agent, so the action field is the prompt. The ' +
        'agent id comes from the connection panel and is a preview string with a date in it — if ' +
        'creates start failing, that field is the first thing to check.'
    },
    {
      label: 'A trigger Cronsole creates can reach nothing outside its sandbox',
      body:
        'Gemini lets a trigger declare a network allowlist, including domains carrying credentials. ' +
        'Cronsole creates the plainest environment the API accepts and never guesses one, because ' +
        'widening what an autonomous agent may reach is not a default a task manager should pick ' +
        'for you. Add domains in Google AI Studio.'
    },
    {
      label: 'Run History has two lists, and the platform one is where the runs are',
      body:
        'Runs Cronsole performed are usually just your own Run now clicks. Below them, Runs on the ' +
        'platform is read live from Gemini and includes every scheduled run Cronsole never ' +
        'triggered. Click one for the output, what it cost, and what it actually did — the ' +
        'tools it used, in order. Read that list: a run can finish cleanly having skipped the part ' +
        'you wanted, because its sandbox could not do it.'
    },
    {
      label: 'There is no Google web page for these triggers',
      body:
        'Gemini API Triggers are managed entirely through the API — Google documents no ' +
        'console or dashboard for them, and the Gemini app’s scheduled actions are a ' +
        'different product with no API at all. This dashboard is where you see them.'
    },
    {
      label: 'A trigger is fixed once it exists — schedule and prompt both',
      body:
        'Edit schedule and Edit action both read Unsupported here, and that is the preview API\'s ' +
        'boundary rather than a missing feature: its update endpoint takes a trigger\'s status and ' +
        'display name and rejects the schedule outright. Change either in Google AI Studio, or ' +
        'delete and recreate — a new trigger gets a new id, so Cronsole files it as a new task. ' +
        'Run, pause, resume, create and delete all work from here.'
    }
  ],
  doc: { label: 'Sources Guide › Gemini API Triggers', url: sourcesGuide('gemini-api-triggers') }
};

const sourceClaude: HelpTopic = {
  id: 'source:CLAUDE_CODE',
  title: 'Claude Code routines',
  summary:
    'Prompts Anthropic runs on a schedule, in the cloud, against the repositories you attach. ' +
    'What Cronsole can do here depends on this install — see below.',
  points: [
    {
      label: 'Signed in to the Claude Code CLI here? Cronsole can do everything',
      body:
        'With a readable Claude Code session on the machine running Cronsole, it lists your real ' +
        'routines, creates them (including from a template), reschedules, pauses and runs them ' +
        'with no per-routine token. Without one, it can fire routines you connected by token.'
    },
    {
      label: 'Without a session, your list is your own declaration',
      body:
        'Nothing is fetched, so "sync" returns the routines you typed in, and one deleted at ' +
        'claude.ai still lists until its next run fails. The registry is the platform.'
    },
    {
      label: 'Deleting a routine is impossible from here',
      body:
        'Neither Claude API exposes a delete. Cronsole can pause a routine and forget it; ' +
        'removing it happens at claude.ai.'
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
    'A picker, or five-field cron — minute, hour, day, month, weekday. Either way you author in ' +
    'your schedule timezone and Cronsole stores UTC, printed under the field so the two can ' +
    'never disagree.',
  points: [
    {
      label: 'Simple builds the cron; Cron is the same schedule, spelled out',
      body:
        'Pick a frequency, a time and the weekdays; the expression it compiles to is printed ' +
        'underneath. Switching tabs changes nothing on its own. An expression the picker cannot ' +
        'hold — a range, a list, a specific month — leaves Simple disabled rather than being ' +
        'snapped to the nearest shape it can.'
    },
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
  title: 'What a Cronsole task does',
  summary:
    'Four kinds, all scheduled and executed by the Cronsole backend. They differ in what happens ' +
    'when the schedule fires — and in what counts as success.',
  points: [
    {
      label: 'Call a URL',
      body:
        'Cronsole makes the request — method, headers and body are yours to set. Success means the ' +
        'endpoint accepted it, which is the right test for firing a webhook.'
    },
    {
      label: 'Run a program',
      body:
        'Starts an executable that already exists on the machine the backend runs on, and records ' +
        'its exit code, duration and output. No shell: the command is split into a program and ' +
        'arguments.'
    },
    {
      label: 'Write a script',
      body:
        'You write the body here and pick an interpreter; Cronsole stores it, writes it to a ' +
        'temporary file at run time and runs it. Nothing needs to exist on disk first, and the ' +
        'script travels with the task.'
    },
    {
      label: 'Check something',
      body:
        'Measures an endpoint, a port, a file\'s age or free disk space and compares it to what you ' +
        'expect. Use this rather than "Call a URL" when you want a 200 that serves an error page ' +
        'to fail.'
    },
    {
      label: 'You can switch later, but not merge',
      body:
        'Editing a task converts it. The job is replaced — the old type\'s fields are discarded, ' +
        'and the form names them before you click. Name, schedule, category and run history all ' +
        'survive.'
    }
  ],
  doc: { label: 'UI User Guide › Creating a native task', url: uiGuide('creating-a-cronsole-native-task') },
  more: [
    { label: 'Sources Guide › Cronsole (Scripts)', url: sourcesGuide('cronsole-scripts') },
    { label: 'Sources Guide › Cronsole (Checks)', url: sourcesGuide('cronsole-checks') }
  ]
};

const jobEnv: HelpTopic = {
  id: 'job-env',
  title: 'Environment',
  summary:
    'Extra variables handed to the program or script when it starts. One NAME=value per line, or ' +
    'JSON.',
  points: [
    {
      label: 'Added to a minimal environment, not to Cronsole\'s',
      body:
        'The child does not inherit the backend\'s own variables — that process holds the key ' +
        'encrypting every platform credential you have stored. What you write here, plus a small ' +
        'base, is everything it gets.'
    },
    {
      label: 'A value may be a secret; a name may not',
      body:
        '${secret.NAME} in a value is substituted at run time and taken back out of the run log. ' +
        'In a variable *name* it is refused — that would hide which variable was set without ' +
        'protecting anything.'
    },
    {
      label: 'Everything after the first = is the value',
      body:
        'CONN=host=db;port=5432 is one variable, not three. Blank lines and # lines are ignored, ' +
        'so a block pasted out of a .env file works.'
    },
    {
      label: 'It survives a switch between program and script',
      body:
        'Those two kinds mean the same thing by it, so converting between them keeps it. Every ' +
        'other conversion drops it, and the warning above says which you are doing.'
    },
    {
      label: 'Unreadable blocks the save',
      body:
        'Something that cannot be parsed stops the save and says so, rather than being sent as no ' +
        'environment — which would leave the job running without the credential it was written to use.'
    }
  ],
  doc: { label: 'UI User Guide › Environment variables', url: uiGuide('environment-variables') },
  more: [
    { label: 'UI User Guide › Secrets', url: uiGuide('secrets') },
    { label: 'ADR 0003 — Per-job secrets', url: docLink('docs/adr/0003-per-job-secrets.md') }
  ]
};

const taskSecrets: HelpTopic = {
  id: 'task-secrets',
  title: 'Secrets',
  summary:
    'A credential a native job needs, stored encrypted and referred to by name. Write ' +
    '${secret.NAME} where the value belongs and Cronsole substitutes it when the task runs.',
  points: [
    {
      label: 'The value is never shown again',
      body:
        'No screen and no API returns a stored secret. To change one you replace it — there is ' +
        'nothing that reads it back.'
    },
    {
      label: 'It is taken back out of the run log',
      body:
        'If the job prints its token, the history shows ${secret.NAME} where the value was. That ' +
        'works by matching the stored value, so it is a safety net rather than a guarantee — a ' +
        'script that encodes its token before printing defeats it.'
    },
    {
      label: 'Not everywhere — a closed list',
      body:
        'Legal in a URL, a header value, a request body, a program argument and an environment ' +
        "value. Refused in a program's executable, a script's interpreter and a check's " +
        'assertions: a secret hiding which program runs protects nothing and makes the log unreadable.'
    },
    {
      label: 'A missing one stops the task rather than blanking it',
      body:
        'A reference with nothing behind it makes the run refuse to start, by name. Firing a ' +
        'request with an empty credential would come back as a 401 that reads like an expired token.'
    },
    {
      label: 'They stay on this machine',
      body:
        'An export carries the ${secret.…} references and none of the values, and so does the ' +
        'archive written before a delete. Deleting the task destroys its secrets; editing what it ' +
        'runs never touches them.'
    }
  ],
  doc: { label: 'UI User Guide › Secrets', url: uiGuide('secrets') },
  more: [
    { label: 'ADR 0003 — Per-job secrets', url: docLink('docs/adr/0003-per-job-secrets.md') }
  ]
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
      label: 'Edit opens everything editable, in one form',
      body:
        'Name, category, schedule and what the task runs. It is never disabled — the labels can ' +
        'be changed on every source — and anything this task cannot change says why, in the form.'
    },
    {
      label: 'Save reports each part separately',
      body:
        'Behind the one form are three different writes. Only what you changed is sent, and if ' +
        'the agent refuses one part the others still land — the form says which, and keeps the ' +
        'failed part filled in so Save retries just that.'
    },
    {
      label: 'Renaming changes a Cronsole label only',
      body:
        'Nothing is renamed on your machine. A Windows task\'s real name is the last part of its ' +
        'Task Scheduler path, and that path is how every command addresses it — so once the two ' +
        'differ, the modal keeps showing the real one. Changing the category does not move it ' +
        'between Task Scheduler folders either.'
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
    { label: 'UI User Guide › Editing a task', url: uiGuide('editing-a-task') },
    { label: 'UI User Guide › What it runs', url: uiGuide('what-it-runs') }
  ]
};

/* ── Dashboard controls ──────────────────────────────────────────────────── */

const collections: HelpTopic = {
  id: 'collections',
  title: 'Collections',
  summary:
    'A set of tasks you pick by hand and name. Unlike a view, it is not a filter — it can hold ' +
    'tasks from different platforms that have nothing else in common.',
  points: [
    {
      label: 'Declared, not matched',
      body:
        'A view stores conditions and shows whatever matches them now. A collection stores the ' +
        'tasks themselves, which is the only way to group a Claude routine and two Windows ' +
        'tasks that share no property to filter on.'
    },
    {
      label: 'Add from the bookmark button',
      body:
        'Next to the star wherever a task appears — every card, row, Kanban and Schedule entry, ' +
        'and the detail modal. It opens a checklist — a task can be in any number of collections ' +
        '— and you can create a new one from there with the task already in it. The button shows ' +
        'a number once the task is in something.'
    },
    {
      label: 'It composes with your view',
      body:
        'Failures + your collection is the failing tasks in it. Picking one does clear any ' +
        'source, folder or starred scope, because a collection spans systems rather than ' +
        'sitting inside one.'
    },
    {
      label: 'Deleting one never deletes tasks',
      body:
        'It removes the grouping only; the tasks stay in Cronsole and keep running. Removing a ' +
        'task from Cronsole does take it out of any collection — the same rule as the star.'
    },
    {
      label: 'Pinned is a separate section',
      body:
        'Hover a folder in the source rail and click + to park it in Pinned, the band just below ' +
        'this one. A pin is not a collection: it keeps tracking the folder, so a task added there ' +
        'tomorrow is counted the same day. It always prints the same number as the folder in the ' +
        'tree, and it stays — reading 0 — if the folder empties, so you can still click it to ' +
        'remove it. Pinned appears only once you have pinned something.'
    },
    {
      label: 'Fold any section',
      body:
        'Collections, Pinned and Sources each have a heading with a chevron, and each folds ' +
        'independently. A folded section keeps its count, so folding never hides how much is in ' +
        'there. Manage collections sits at the foot of the Collections section itself. The button ' +
        'at the top of the sidebar is different — it narrows the whole rail to icons.'
    }
  ],
  doc: { label: 'UI User Guide › Collections', url: uiGuide('collections') }
};

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
        'All, My jobs, Failures, Due today, Disabled and System. Disabled isolates ' +
        'parked tasks; that is not the same as the Status filter merely including them.'
    },
    {
      label: 'Changing a filter drops you to Custom',
      body:
        'On purpose: narrow "Failures" by a lens you cannot see and the label stops describing ' +
        'the list. The rail is the exception — picking a source or a folder keeps the view lit, ' +
        'because both are on screen in the rail, the heading and the breadcrumb.'
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
    'Status and ownership. Source and folder are not in here — they are the rail on the left. ' +
    'The number on the button is how many filters are set.',
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
    'Import takes a file. Sync reads this machine — both refreshing what you track and adding ' +
    'folders you do not. The two used to share one word, and mistaking either for the other is ' +
    'the most expensive confusion here.',
  points: [
    {
      label: 'Import means a file',
      body:
        'A Cronsole task .json is rebuilt as a new task. A Windows backup — .xml, or the .zip an ' +
        'export produced — opens in Tools › Restore instead, because putting a Windows task back ' +
        'writes to your machine and has to show you the plan first.'
    },
    {
      label: 'Sync means this machine, and it has two gestures',
      body:
        'The button refreshes status and schedules for the folders you already track, and adds ' +
        'nothing new. The menu beside it opens Add tasks from this machine, which is the only ' +
        'thing that can start tracking a folder you have never picked.'
    },
    {
      label: 'A plain refresh cannot discover anything',
      body:
        'A folder you have never added stays invisible however many times you sync — and every ' +
        'sync still reports success. That is deliberate: a refresh must never widen what Cronsole ' +
        'tracks without being asked.'
    },
    {
      label: 'Sync says what it left behind',
      body:
        '"26 tasks in 2 folders aren\'t imported" — Windows\' own tasks excluded, so the number ' +
        'means yours. That message carries the button that adds them.'
    },
    {
      label: 'Adding a folder brings removed tasks back',
      body:
        'A category holding tasks you removed shows an amber +N badge, so you see the number ' +
        'before committing. Asking for the folder is asking for what is in it — which is also why ' +
        'a plain refresh deliberately does not do it.'
    },
    {
      label: 'A category is a folder',
      body:
        'For Windows, adding a category adds a real Task Scheduler folder. That is also why ' +
        'adding it again is how you undo a removal.'
    }
  ],
  doc: { label: 'UI User Guide › System Status & Connections', url: uiGuide('7-system-status--connections') },
  more: [
    { label: 'UI User Guide › Import a task', url: uiGuide('import-a-task') }
  ]
};

/* ── Tabs ────────────────────────────────────────────────────────────────── */

const preferenceSync: HelpTopic = {
  id: 'preference-sync',
  title: 'Preference sync',
  summary:
    'Your pins, saved views and settings are stored against your account, so they are the same ' +
    'at every address this install answers on — localhost, the proxy, the Tailscale name.',
  points: [
    {
      label: 'Because a second URL is a second store',
      body:
        'Browsers scope local storage to one origin, so reaching Cronsole at a new address used ' +
        'to hand you an empty sidebar. Collections and favorites always crossed over — they are ' +
        'rows — which is why the gap looked like a bug rather than a boundary.'
    },
    {
      label: 'A new browser adopts, it does not overwrite',
      body:
        'Signing in reads your account before it ever writes to it, and a browser where nothing ' +
        'has been changed will not seed. Opening the dashboard once on a phone cannot flatten ' +
        'the desktop you have been curating.'
    },
    {
      label: 'Two devices at once resolve by recency',
      body:
        'The later write wins the whole set, not field by field. Reorganising your sidebar in ' +
        'two places in the same minute can lose one side of it.'
    },
    {
      label: 'Theme and the API origin stay local',
      body:
        'Both describe the device rather than you: the theme is read before you sign in, and the ' +
        'API-origin override names an address whose whole point is to differ per machine.'
    },
    {
      label: 'Not synced means held, not lost',
      body:
        'If the account cannot be reached, changes stay in this browser and are retried on your ' +
        'next change. Nothing is written to the account until it has been read once.'
    }
  ],
  doc: {
    label: 'Remote Access Guide › What follows you to the second address',
    url: docLink(
      `${GUIDES}/Remote_Access_Guide.md`,
      'what-follows-you-to-the-second-address-and-what-doesnt'
    )
  }
};

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
      label: 'Filter by target, not by OS',
      body:
        'Target is which system the task gets created on — Windows, Cronsole itself, or a Claude ' +
        'Code routine. Most templates are "cross-platform", so the OS row cannot answer it.'
    },
    {
      label: 'A compatible target is not a compiled one',
      body:
        'A template can list a platform Cronsole has no compiler for. That is the honest ' +
        '"copy this and set it up yourself" path, not a silent failure. What is greyed out is ' +
        'about this install: a Claude routine needs you signed in to the Claude Code CLI here.'
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

/**
 * The **Sources tab**'s topic. The id stays `platforms` on purpose: `sources` is
 * already the rail's topic, and these answer different questions — *where do I
 * navigate* versus *what can Cronsole do here*. Renaming the id to match the tab
 * would collide with a topic that is not going anywhere.
 */
const platforms: HelpTopic = {
  id: 'platforms',
  title: 'What Cronsole can do here',
  summary:
    'One row per source, answering "what happens if I click this?" — in three states, each ' +
    'about this install rather than about the code. Plus what you are not watching yet.',
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
    },
    {
      label: 'Controller and Observer are different things',
      body:
        'A controller can change scheduled work here; an observer only reads it. The badge is ' +
        'declared by the connector rather than counted from its cells, so a read-only source ' +
        'reads as finished rather than as one somebody stopped halfway through.'
    },
    {
      label: 'The tabs split on connected, the switch on listed',
      body:
        'Connected holds sources with a working connection; Available holds everything else. ' +
        'The eye switch on each card is a different question — whether the sidebar lists it — ' +
        'and a source can be listed with nothing connected behind it. Available shows those ' +
        'first, with what would actually connect them.'
    },
    {
      label: 'Available is what you are not watching yet',
      body:
        'A fresh install lists Windows and Cronsole-native; the rest are added from here. Adding ' +
        'one lists it in the sidebar and gives it somewhere to be set up from — it connects ' +
        'nothing on its own.'
    },
    {
      label: 'Quick links are bookmarks, not sources',
      body:
        'Schedulers with no connector, kept in their own view for that reason. Nothing is read ' +
        'or written through them, and no task from one appears in your dashboard.'
    }
  ],
  doc: { label: 'UI User Guide › Sources', url: uiGuide('6-sources--what-cronsole-can-actually-do') },
  more: [
    { label: 'Sources Guide', url: sourcesGuide() },
    { label: 'Sources Guide › Adding a source', url: sourcesGuide('adding-a-source') }
  ]
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

const diagnostics: HelpTopic = {
  id: 'diagnostics',
  title: 'System diagnostics',
  summary:
    'Is Cronsole itself working? A different question from "are my tasks working", and the one ' +
    'that has to be answered first — a wedged agent makes every Windows task look unhealthy.',
  points: [
    {
      label: 'Every check shows its evidence',
      body:
        '"Windows offline" is one sentence covering four different situations. The panel shows ' +
        'which: whether a socket exists, when the agent last said anything, and when a request ' +
        'last timed out — naming the verb. A timeout two minutes ago and one from last night ' +
        'look identical on the status line and mean opposite things.'
    },
    {
      label: '"Not measured" is not "OK"',
      body:
        'A check that could not run says so, and the overall verdict ranks it above passing. A ' +
        'panel reporting "all clear" over something it never measured is worse than one that ' +
        'admits the gap.'
    },
    {
      label: 'It names the machine it measured',
      body:
        'On a Dockerized stack the backend measures the container — its clock, its filesystem — ' +
        'not yours. That qualifies every line, so it is stated once at the top.'
    },
    {
      label: 'Nothing here repairs anything',
      body:
        'Every check is a read. That is deliberate: past "the agent is down" alarms turned out ' +
        'to be the status readout being wrong, and a repair button would have restarted a ' +
        'healthy agent while looking like it worked.'
    },
    {
      label: 'It cannot help if the backend is down',
      body:
        'These checks are served by the backend, so they say nothing about a backend, database ' +
        'or Docker engine that is not running. That case is what the Cronsole-Stack startup ' +
        'tasks are for — they run from Windows Task Scheduler, outside the stack.'
    }
  ],
  doc: { label: 'UI User Guide › System diagnostics', url: uiGuide('system-diagnostics') },
  more: [
    { label: 'UI User Guide › The health strip', url: uiGuide('the-health-strip') },
    { label: 'Troubleshooting', url: docLink('docs/troubleshooting/README.md') }
  ]
};

const taskImport: HelpTopic = {
  id: 'task-import',
  title: 'Import a task',
  summary:
    'Turn a saved definition back into a running task — a .json file you exported, or one of the ' +
    'tasks Cronsole archived when you deleted it.',
  points: [
    {
      label: 'It always creates a NEW task',
      body:
        'Nothing is matched up or overwritten, so importing the same file twice leaves you with ' +
        'two tasks. Matching on name would silently replace one you had edited since.'
    },
    {
      label: 'A restored task does not bring its history',
      body:
        'It runs the same job on the same schedule, with a new id — but the old run records stay ' +
        'in the archive. They happened to a task that no longer exists, so attaching them would ' +
        'make the history claim a continuity Cronsole cannot vouch for.'
    },
    {
      label: 'The archive survives the restore',
      body:
        'It is the record that the deletion happened, so restoring does not clear it. Clicking ' +
        'Restore twice therefore gives you two tasks.'
    },
    {
      label: 'Cronsole-native only, and that is about where a definition lives',
      body:
        'A native task exists entirely inside Cronsole, so its file holds everything needed to ' +
        'rebuild it. A Windows task\'s real definition is in Task Scheduler on your machine and ' +
        'comes back as .xml — pick one in Import and it opens in Tools › Restore, which plans ' +
        'the write before making it. Files from other platforms are refused by name.'
    },
    {
      label: 'A deleted Windows task is not here',
      body:
        'Cronsole cannot archive one: its definition lives on the machine, and reading it needs ' +
        'the agent online — which cannot be a condition of deleting. Back those up ahead of time ' +
        'with Back up scheduled tasks.'
    }
  ],
  doc: { label: 'UI User Guide › Import a task', url: uiGuide('import-a-task') },
  more: [
    { label: 'UI User Guide › Restore tasks from a backup', url: uiGuide('restore-tasks-from-a-backup') },
    { label: 'UI User Guide › Removing a task', url: uiGuide('removing-a-task--two-very-different-buttons') }
  ]
};

const taskExport: HelpTopic = {
  id: 'task-export',
  title: 'Exporting a task',
  summary:
    'Download this task\'s definition — either the platform\'s own, which restores it exactly, or a ' +
    'portable template, which recreates it anywhere.',
  points: [
    {
      label: 'Two formats because there are two questions',
      body:
        'Native puts this exact task back on this platform. Portable recreates what it does on any ' +
        'install. No single file does both — one carries platform settings, the other must drop them.'
    },
    {
      label: 'Portable is lossy on purpose',
      body:
        'It leaves out the account the task runs as, its run level and any extra actions, because ' +
        'no other platform can honour them. Treat it as a recipe, not a backup.'
    },
    {
      label: 'Portable works where native cannot',
      body:
        'With the Windows agent offline there is nothing to read the real definition from, and a ' +
        'Claude routine has none Cronsole can fetch. The template still describes what runs.'
    },
    {
      label: 'Neither touches your template library',
      body:
        'Getting a portable file used to mean Save as template first, which left a template behind. ' +
        'Export writes nothing.'
    },
    {
      label: 'Some tasks cannot be templated',
      body:
        'A boot or logon trigger is not a cron expression, and a task with several actions has no ' +
        'single command. The refusal names which of the two stopped it.'
    }
  ],
  doc: { label: 'UI User Guide › Exporting one task', url: uiGuide('exporting-one-task') },
  more: [
    { label: 'UI User Guide › Import a task', url: uiGuide('import-a-task') },
    { label: 'UI User Guide › Restore tasks from a backup', url: uiGuide('restore-tasks-from-a-backup') }
  ]
};

/* ── The catalog ─────────────────────────────────────────────────────────── */

const TOPIC_LIST: HelpTopic[] = [
  dashboard,
  sources,
  sourceWindows,
  sourceNative,
  sourceNativeHttp,
  sourceNativeExecPrograms,
  sourceNativeScript,
  sourceNativeCheck,
  sourceClaude,
  sourceGitHub,
  sourceVercel,
  sourceGemini,
  schedule,
  nativeJobType,
  jobEnv,
  taskSecrets,
  command,
  taskActions,
  views,
  collections,
  filters,
  importSync,
  templates,
  platforms,
  massActions,
  taskImport,
  taskExport,
  diagnostics,
  taskHealth,
  preferenceSync
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
  // `sourcePlatform` rather than a bare split, for the reason its own comment
  // gives: these keys come out of a JSON payload, so the type says `string` and
  // the value may still be missing. A `?` button is the last thing that should
  // be able to blank the page it sits on.
  const platform = sourcePlatform(key);
  if (HELP_TOPICS[`source:${platform}`]) return `source:${platform}`;
  return 'sources';
};
