<h1 align="center">📄 Template Prompts</h1>

<p align="center">
  <em>Find a catalog recipe, fill in the blanks, and get a real scheduled task —
  when you know the use case but not the command.</em>
</p>

<p align="center">
  <a href="https://cronsole.ai-automation-tools.dev"><img src="https://img.shields.io/badge/catalog-browse_the_gallery-2ea44f?style=for-the-badge" alt="Browse the catalog"></a>
  <img src="https://img.shields.io/badge/tiers-core_+_extended-8B5CF6?style=for-the-badge" alt="Core and extended tiers">
</p>

---

A template is a parameterized command with a suggested schedule — `{{repoPath}}`,
`{{scriptPath}}`, `{{url}}` — compiled to a real task when you apply it. Reach for one when you
know *what you want done* and would rather not work out the exact command line. If you already
know the command, [create the task directly](windows-tasks.md); the catalog isn't a gate.

Your install ships **7 built-in** templates and can import the rest. The other 59 live in the
hosted registry and in the [public gallery](https://mikesailab.com/cronsole-registry), grouped
into 8 downloadable packs.

## 🔎 Find one

```text
Using Cronsole, list the templates for database backups and tell me what
parameters each one needs.
```

```text
Using Cronsole, what templates do I have for monitoring a URL? Show me their
schedules and which platform each targets.
```

```text
Using Cronsole, search the catalog for anything to do with git. For each hit,
tell me whether it runs on Windows, on the Cronsole backend, or as a Claude
routine.
```

```text
Using Cronsole, I want to clean up old files on a schedule but I don't know what
exists. Show me the cleanup templates and recommend one, with your reasoning.
```

Templates target three platforms today — Windows, Cronsole-native, and Claude routines — and a
few carry a `macos` or `chatgpt` target that has no compiler yet. Those are the honest
"copy it and set it up by hand" path rather than a button that silently fails.

## ⚙️ Apply one

```text
Using Cronsole, apply the daily database backup template. I run Postgres locally,
the dump should land in D:\backups, and I want it at 2am Pacific. Check the
schedule conversion before you create it.
```

```text
Using Cronsole, apply the PowerShell script starter to D:\jobs\weekly-report.ps1,
weekly on Monday at 8am Pacific, in the \Cronsole folder.
```

```text
Using Cronsole, apply the uptime check template against
https://my-service.example.com/health as a Cronsole-native task, every five
minutes. No agent needed for this one, right? Confirm before creating.
```

```text
Using Cronsole, list the template parameters for the Claude Code Repo Digest
first, then apply it — I want to see what I'm filling in before I commit to
values.
```

> [!TIP]
> Ask for the parameters **before** the apply. A template's defaults are sensible starting
> points, not your paths, and an assistant filling in `C:\logs\claude-run.log` because it was
> the default is how three jobs end up writing to the same file.

## 📦 Packs

Packs are curated sets, and membership is declared rather than inferred from tags — downloading
one gives you exactly what it lists.

| Pack | What's in it |
|:---|:---|
| **Starters** | The broad basics: scripts, webhooks, backups, cleanup |
| **Developer** | Git hygiene, npm audit and build, .NET build, Docker prune |
| **AI & Agents** | Headless Claude Code and Codex runs, digests, autofix, routine patterns |
| **Backup & Cleanup** | Database dumps, folder archives, log pruning |
| **Monitoring** | Uptime checks, heartbeats, disk and service watches |
| **Cronsole-native** | HTTP jobs and script jobs run by the backend, no agent |
| **Claude routines** | Issue triage, dependency review, CI digests, docs drift |
| **System utilities** | Windows housekeeping that doesn't fit elsewhere |

```text
Using Cronsole, what's in the Developer pack? I want git and dependency hygiene
jobs, and I'd rather import a set than pick one at a time.
```

Importing a pack is a REST operation, not an MCP one — see
[**REST API prompts**](../rest-api/README.md#-import--export-the-rest-only-operations), or use
the Import button in the Templates tab.

## 🔁 Grow the catalog

Two ways to add to it without touching the repo, both REST-only:

```text
Using the Cronsole REST API, turn my existing task <task-id> into a reusable
template named "Nightly Repo Sync" (POST /api/tasks/:id/save-as-template).
```

```text
Using the Cronsole REST API, import the template JSON in ./my-template.json and
tell me whether it validated. Then list my templates to confirm it landed.
```

Saved and imported templates are yours — the boot-time catalog sync never prunes them. Only the
built-in set is managed, which is how an install converges on the current core without eating
anything you made.

## 🔗 Related

| Resource | Why |
|:---|:---|
| [**🤖 AI agent jobs**](ai-agent-jobs.md) | The AI & Agents pack in use, with its fencing explained. |
| [**🖥️ Cronsole-native tasks**](native-tasks.md) | Where the native pack's templates end up. |
| [**🌐 REST API prompts**](../rest-api/README.md) | Import, export, and save-as-template. |
| [**📦 Template catalog spec**](../../reports/templates/README.md) | How templates are defined, tiered, and published. |
| [**🌍 Public gallery**](https://mikesailab.com/cronsole-registry) | Browse all 66 in a browser and download packs. |

---

<p align="center">
  <a href="README.md">← MCP prompts</a> ·
  <a href="native-tasks.md">Cronsole-native</a> ·
  <a href="inspect-and-audit.md">Next: Inspect & audit →</a>
</p>
