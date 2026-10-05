<a id="n8n-top"></a>

<h1 align="center">🔀 n8n</h1>

<p align="center">
  <em>The workflows on your n8n instance that run on a schedule — read, never written, with real run outcomes.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/shape-observer-2ea44f?style=for-the-badge" alt="Observer">
  <img src="https://img.shields.io/badge/run_history-yes-2ea44f?style=for-the-badge" alt="Run history">
  <a href="README.md"><img src="https://img.shields.io/badge/↩-source_guides-6B7280?style=for-the-badge" alt="Source guides"></a>
</p>

---

Cronsole reads every workflow on your n8n instance that has a **Schedule Trigger**, converts its
schedule to UTC, and reads its executions — so you get a real health score and each run's steps on
the same dashboard as everything else.

**Read-only is the design**, like [GitHub Actions](GitHub_Actions.md) and
[Vercel Cron](Vercel_Cron.md). Unlike Vercel, n8n publishes how every run went.

## 🔌 Connecting

1. **Create an API key** in n8n: *Settings › n8n API*. A scoped key needs `workflow:read` and
   `execution:read`.
2. Sources tab → **n8n** → **Connect**. Paste the address you open n8n at (a pasted `/api/v1` or
   `/home/workflows` is trimmed off) and the key. Cronsole verifies both before storing them.
3. **Set the instance time zone** — see below. The panel offers your browser's zone as a one-click
   fill, but a cloud instance often runs in a zone that is not yours.
4. **Sync.**

Self-hosted and n8n Cloud both work. One key reaches one instance, so there is nothing to pick:
every scheduled workflow lands under a single **n8n** category.

> [!TIP]
> **A `401` on connect almost always means the key was not copied in full.** n8n keys are long and
> shown once; generate a new one and use n8n's copy button. Cronsole's error says whether n8n
> rejected the key (`unauthorized`) or never received it (`header required` — a proxy in the way).

## 🕒 The time zone, and why Cronsole asks for it

n8n runs a Schedule Trigger in the instance's time zone (`GENERIC_TIMEZONE`, or the workflow's own
*Timezone* setting if it has one). **Its API reports the workflow setting but not the instance
default.** A weekly trigger at "6am" is stored by n8n as an hour and nothing else.

Cronsole stores every schedule as a 5-field cron in UTC, so it needs the zone to convert. Without it,
the schedule is shown as **unavailable, with that reason** — never read as 06:00 UTC, which would put
it hours off with nothing on screen to say so. Changing the zone takes effect on the next sync.

**Don't know your instance's zone?** Read it off a run. A workflow with no Timezone setting of its
own, scheduled for Friday 9:00, whose executions start at `14:00Z` in October is running at UTC−5 —
`America/Chicago`. ([Troubleshooting #97](../../troubleshooting/README.md#97-one-n8n-workflow-shows-no-schedule-while-the-others-convert-fine))

## 🚫 The three refusals

- **Run now** — n8n's public API has no endpoint that starts a workflow. Calling one of its webhooks
  would start a *different* run than the scheduled one, and n8n would record it as a webhook run.
  Use *Execute workflow* in n8n.
- **Enable / disable** — publishing and unpublishing switch a **whole workflow**: its webhooks,
  forms and chat triggers go dark with its schedule. A per-task toggle that silently took down a form
  somebody shares would be a control n8n does not have.
- **Create** — a workflow is a graph of nodes and credentials. Build it in n8n with a Schedule
  Trigger, publish it, and sync.

Editing a schedule is absent too: n8n's update replaces the whole workflow and collides with its
draft/publish model, so it is not a safe edit to make from outside.

## 📋 What becomes a task

Every workflow that is not archived and has an **enabled trigger** becomes a task:

- **Scheduled** — an enabled `Schedule Trigger` (or the legacy `Cron` node). Its schedule is
  converted to UTC.
- **On demand** — started by a form, webhook, chat, another workflow, an error, or by hand in the
  editor. It has no schedule (the card says *On demand (form)*), no place on the calendar, and the
  same run history and health score as a scheduled one. A never-used on-demand workflow is not
  flagged as unhealthy.

Turn **Include on-demand workflows** off on the n8n card to track scheduled workflows only. Turning
it off removes the on-demand rows from the dashboard right away (nothing changes in n8n). Workflows
with no trigger at all are skipped. The sync note says what it read — *"read 89 workflows, 24 with a
schedule and 65 on demand"*.

- **Published** → Active. **Unpublished** → Disabled, since it fires nothing — except a workflow
  whose only trigger is manual: n8n cannot publish one, and it runs from the editor either way, so
  it stays Active.
- Cronsole reads the **published** version. If you have unpublished edits and n8n does not return the
  published version, the schedule is shown as unavailable rather than read off a draft that may not
  be live.

### Schedules with no cron

These are kept on the task (the rules, in n8n's own zone) and shown as unavailable with the reason:

| n8n rule | Why there is no cron |
|:---|:---|
| Every *N* seconds | Cron's smallest unit is a minute. |
| Every *N* days / weeks / months, *N* > 1 | n8n counts from the previous run, not the calendar — when it fires depends on when the workflow was published. |
| Every *N* hours where *N* does not divide 24 | Same counting; *every 5 hours* skips the midnight run a cron would report. |
| Several rules, or several Schedule Triggers | Cronsole stores one cron per task. |
| A value set by an expression (`={{ … }}`) | Evaluated by n8n at publish time; Cronsole cannot know it. |
| The legacy Cron node | Not read yet — n8n recommends replacing it with a Schedule Trigger. |

A Custom (Cron) rule with a seconds field is read with the seconds dropped when they are a single
value — they only move the run within its minute.

**Every 2, 3, 4, 6, 8 or 12 hours does convert.** Its UTC form lists the hours — *every 6 hours*
in New York is stored as `0 4,10,16,22 * * *` — and the card still reads *Every 6 hours*.

<a id="folders"></a>

## 🗂️ Folders

**By default, workflows nest under n8n by how they start** — *Scheduled*, *Forms*, *Webhooks*,
*Manual*, *Error handlers*… — because that is readable on every instance. Change it with **Group in
the sidebar** on the n8n card (*Not grouped* puts them all directly under n8n). Your real n8n folders
replace it whenever they can be read, as below.

**n8n's public API does not say which folder a workflow is in**: a workflow's `parentFolderId` is write-only, `/workflows` takes no folder filter,
and the package export that does carry folders needs a licensed feature. The editor's internal API
carries it but refuses API keys.
([Troubleshooting #96](../../troubleshooting/README.md#96-your-n8n-folders-do-not-appear-in-cronsole))

**On a self-hosted instance, Cronsole can read folders from n8n's Postgres database instead.** It
is optional, and it needs less access than the API key: a role that can read five columns and
nothing else — no workflow nodes, no credentials, no executions.

1. On the n8n database, create the role (pick your own password):

   ```sql
   CREATE ROLE cronsole_reader LOGIN PASSWORD 'change-me';
   GRANT CONNECT ON DATABASE n8n TO cronsole_reader;
   GRANT USAGE ON SCHEMA public TO cronsole_reader;
   GRANT SELECT (id, "parentFolderId") ON workflow_entity TO cronsole_reader;
   GRANT SELECT (id, name, "parentFolderId") ON folder TO cronsole_reader;
   ```

2. Make Postgres reachable from the machine Cronsole runs on (a published port, a VPN such as
   Tailscale, or an SSH tunnel). Prefer not to expose it to the internet.
3. Sources tab → **n8n** → **Folders (optional)**: paste
   `postgresql://cronsole_reader:change-me@host:5432/n8n` and **Verify and save**. Cronsole runs the
   real folder query before storing anything, and says how many workflows it found in a folder.
4. **Sync.** Workflows nest under **n8n** in the sidebar by folder, e.g. *n8n › AI-Library › News*.

The URL is encrypted like the API key and never shown again — the panel shows only `host:port/db`.

- **The folder is refreshed on every sync**, so moving a workflow in n8n moves it in Cronsole — its
  id, history and favorites stay put.
- **A failed folder read never fails the sync.** The tasks still arrive, without their folders,
  and the sync says why.
- **Not on n8n Cloud** — its database is not reachable. An instance with `DB_TABLE_PREFIX` set is
  not supported yet.

## 📈 Health and run history

Each sync reads the workflow's recent executions. The health score uses n8n's own words: `success`
is clean; `error` and `crashed` are failures; `canceled` is a warning; `running` and `waiting` are not
outcomes yet. Three failed runs in a row is critical.

**Run History → Runs on the platform** lists the executions live. Opening one shows:

- the nodes that ran, in order,
- how it was started (*Schedule or other trigger*, *Manual run in the editor*, *Webhook*, …), how long
  it took, and where a failed run stopped,
- n8n's error message, and a link to the execution's page in n8n.

**The data each node produced is not shown** — it stays in n8n, one click away. An instance prunes
old executions, so an old run can age out of the list while the workflow is perfectly healthy.

## ⚠️ Things that surprise people

- **There is no next-run time.** n8n does not report one, and a time computed from the cron would
  disagree with n8n's own scheduler.
- **The UTC schedule uses today's offset.** Across a daylight-saving change the stored cron is an
  hour out until the next sync — the same as Gemini.
- **Health comes from your syncs, not a probe.** `getHealth` runs every 45 seconds per open tab;
  probing would load your instance to answer a question sync already answers.
- **Disconnecting removes the tracked rows and changes nothing in n8n.**

---

<p align="center"><a href="#n8n-top">↑ Back to top</a> · <a href="README.md">Source guides</a> · <a href="../guides/Sources_Guide.md#n8n">Sources Guide › n8n</a></p>
