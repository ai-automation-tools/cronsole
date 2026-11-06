<a id="n8n-top"></a>

<h1 align="center">🔀 n8n Prompts</h1>

<p align="center">
  <em>Read your n8n workflows beside everything else, see how each run went, and start one by
  asking.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-n8n-8B5CF6?style=for-the-badge" alt="n8n">
  <img src="https://img.shields.io/badge/access-controller_·_Run_now_only-2ea44f?style=for-the-badge" alt="Controller, Run now only">
  <a href="README.md"><img src="https://img.shields.io/badge/↩-MCP_prompts-6B7280?style=for-the-badge" alt="MCP prompts"></a>
</p>

---

Cronsole reads every workflow on your n8n instance that has an enabled trigger. A Schedule Trigger
gives it a schedule; a form, webhook, chat or manual trigger makes it an **on-demand** task with no
schedule at all. n8n reports how every run went, so health and run history are real.

It can change exactly one thing: **Run now**. Pausing, creating and editing are refused, and the
reasons are below. Connecting the instance happens in the app (*Sources › n8n*), not over MCP. Start
by checking what Cronsole can do on yours:

```text
Using Cronsole, tell me about my n8n source: is it connected and healthy, is
it a controller or an observer, and which verbs are verified on this install
versus only declared? In particular, can Run now work here yet?
```

> [!IMPORTANT]
> **Run now needs a second credential.** It goes through n8n's own MCP server (n8n 1.121 or newer),
> so the connection needs an MCP access token on top of the API key, and each workflow has to be
> marked *Available in MCP* in n8n. Without the token, `run_task` refuses and names the setup.
> [Using n8n › Run now](../../docs/user-guides/sources/n8n.md#run-now) has the steps.

## 📋 What you have

```text
Using Cronsole, list my n8n workflows. Split them into scheduled and
on-demand, and for each scheduled one give me its schedule in my local time
as well as UTC.
```

```text
Using Cronsole, which of my n8n tasks have no schedule, and why? For each one,
tell me whether it's on demand by design or a schedule Cronsole couldn't
read, and quote the reason Cronsole gives.
```

> [!TIP]
> **A null schedule is two different facts.** An on-demand workflow has none by design, and its
> metadata says *Runs on demand — started by …*. A schedule Cronsole could not read carries a
> `scheduleUnavailableReason` instead: no instance time zone on the connection, a rule with no cron
> equivalent (every 2 days, every 5 hours, seconds), or unpublished edits hiding the live version.
> Ask which, rather than reading every blank as broken.

```text
Using Cronsole, refresh my n8n workflows and tell me what the sync read: how
many workflows it saw, how many it kept as scheduled or on demand, and
anything it warned about.
```

A refresh needs no categories. One API key reaches one instance, so the sync already reads
everything the connection covers, and its **notes** say how much that was.

## ▶️ Running one

```text
Using Cronsole, run my n8n workflow "<name>" now. Then show me the run n8n
recorded for it, with the nodes that ran and how long it took.
```

```text
Using Cronsole, which of my n8n workflows can actually be started with Run
now? Leave out any whose trigger needs input, like a form or webhook, and
say why each one is left out.
```

Run now starts the **published** workflow through its own Schedule Trigger, which is the same run
n8n would make on schedule, not a webhook lookalike. A workflow whose only trigger is manual runs its
current version, the way the editor's button does. A form, webhook or chat workflow cannot be
started this way, because its trigger needs input; n8n says so and Cronsole passes that on.

## 🩺 Health and failures

```text
Using Cronsole, check the health of my n8n workflows. Which are failing,
which have never run, and which are fine? For any that failed, show me where
the last failed run stopped and n8n's error message.
```

```text
Using Cronsole, my n8n workflow "<name>" failed. List its recent runs on n8n,
open the latest failed one, and tell me which node failed and why.
```

Ask for the **platform's** runs. Cronsole's own run log holds only runs Cronsole started, so on n8n it
is nearly empty however busy the workflow is. Opening a run shows the nodes that ran, in order, and
n8n's error, never the data each node produced; that stays in n8n, one click away.

## 🚫 What it refuses

| Verb | Why it is refused |
|:---|:---|
| **Pause / resume** | n8n can only publish or unpublish a **whole workflow**, which takes its webhooks, forms and chat triggers down with its schedule. A per-task switch would be a control n8n does not have. |
| **Edit the schedule or the steps** | n8n's update replaces the entire workflow and collides with its draft/publish model. Change it in n8n, publish, and refresh. |
| **Create** | A workflow is a graph of nodes and credentials. Build it in n8n with a Schedule Trigger, publish it, and refresh. |
| **Rename** | The name belongs to n8n, and sync writes it back on every pass. Rename the workflow in n8n. |

## 🧹 Getting one off the dashboard

```text
Using Cronsole, stop tracking my n8n workflow "<name>". Don't change
anything in n8n.
```

Removing a task from Cronsole changes nothing in n8n. To hide every on-demand workflow at once, turn
**Include on-demand workflows** off on the n8n card in the app, which deletes those rows right away.

## ⚠️ Gotchas

| Symptom | What's going on |
|:---|:---|
| Every schedule is blank | No instance time zone on the connection. n8n's API does not report it, so Cronsole asks rather than guess. ([#97](../../docs/troubleshooting/README.md#97-one-n8n-workflow-shows-no-schedule-while-the-others-convert-fine)) |
| `run_task` says what to set up | No MCP access token on the connection, or the workflow is not marked *Available in MCP*. |
| No next-run time | n8n does not publish one, and a time computed from the cron would disagree with n8n's scheduler. |
| A schedule is an hour off after a clock change | The UTC cron uses today's offset and corrects itself on the next refresh. |
| Workflows sit flat under n8n, not in your folders | n8n's API does not report folders. The app can read them from a self-hosted instance's database; see [Folders](../../docs/user-guides/sources/n8n.md#folders). |

## 🔗 Related

| Resource | Why |
|:---|:---|
| [**📘 Using n8n**](../../docs/user-guides/sources/n8n.md) | Connecting, the time zone, Run now setup, folders, and what becomes a task. |
| [**📡 Observer sources**](observers.md) | GitHub Actions and Vercel Cron, which share n8n's read-mostly shape but refuse Run now too. |
| [**🔎 Inspect & audit**](inspect-and-audit.md) | Cross-source reporting, where n8n's real run outcomes count. |

---

<p align="center">
  <a href="README.md">← MCP Prompts</a> ·
  <a href="gemini-triggers.md">Gemini Triggers</a> ·
  <a href="observers.md">Observer Sources</a>
</p>

<p align="right">(<a href="#n8n-top">back to top</a>)</p>
