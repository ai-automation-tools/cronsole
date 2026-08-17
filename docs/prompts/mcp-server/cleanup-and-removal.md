<h1 align="center">🧹 Cleanup &amp; Removal Prompts</h1>

<p align="center">
  <em>Four different ways to make a task go away, and the one question that picks between them.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/blast_radius-varies-F59E0B?style=for-the-badge" alt="Blast radius varies">
  <img src="https://img.shields.io/badge/delete-gated_&_native--only-e74c3c?style=for-the-badge" alt="Delete is gated and native-only">
</p>

---

"Get rid of it" means four different things depending on what you want left behind. Ask this
first: **does the scheduled task keep running after you're done?**

| Verb | Cronsole's row | The real task | Reversible? |
|:---|:---|:---|:---|
| **Disable** | Stays | Stays, does nothing | One prompt |
| **Untrack** | Gone | Keeps running | Re-import the category |
| **Disconnect** (Claude) | Gone, with the declaration | Keeps running at claude.ai | The token is not — it's spent |
| **Delete** | Gone | Destroyed | From the archive, by hand |

Most of the time the answer is **untrack**. It's the one that gets a task off your dashboard
without touching your machine, and it's ungated for exactly that reason.

## 🙈 Untrack — get it off the dashboard

```text
Using Cronsole, I imported the whole \Microsoft\ folder by mistake. Stop tracking
those in Cronsole — but do NOT delete any of them, they're Windows' own tasks.
```

```text
Using Cronsole, remove "SoftLandingDeferralTask" from my dashboard. I don't care
about it, but leave the scheduled task alone.
```

```text
Using Cronsole, my dashboard is full of vendor updater tasks I'll never touch.
List them, then untrack the ones I confirm — one at a time, and tell me each time
that the task itself is unaffected.
```

Untracking drops Cronsole's row and its Cronsole-side run history, records that you don't want
it back, and leaves the scheduled task running on the machine. Future syncs won't re-import it.
To undo, re-import that category in the dashboard.

It **refuses** on two platforms, and both refusals are the honest answer rather than a gap:

- **Cronsole-native** — the row *is* the task, so there's nothing to leave behind. You want
  delete.
- **Claude routines** — with no list endpoint, your declaration is the platform. Untracking
  would fence your own config off from itself and the next import would bring it straight back.
  You want disconnect.

## 🔌 Disconnect — a Claude routine

```text
Using Cronsole, disconnect the routine "Morning digest" — take it off my
dashboard. I understand the routine keeps running at claude.ai and that the
stored token is gone for good.
```

```text
Using Cronsole, before I disconnect "Issue triage", tell me how many tracked
tasks point at it and what disconnecting will strand.
```

The reason this isn't folded into untrack: claude.ai shows a routine's token **once**. A control
labelled "Remove from Cronsole" that silently spent a credential you'd have to regenerate at
Anthropic would be spending something its label never mentioned. Disconnect says so in its own
confirmation.

Full detail on [**Claude routines**](claude-routines.md).

## 🗑️ Delete — Cronsole-native only

```text
Using Cronsole, delete the native task "MCP Test - Webhook Ping". It was a
one-off check.
```

```text
Using Cronsole, delete my three test native tasks. Confirm each one is archived
before it's destroyed, and tell me where I can read the archives back.
```

Two properties are doing real work here.

**It can't reach your machine.** The MCP delete wraps the native-only route and refuses every
other platform with a 400. That's a boundary of the route rather than of the platform — Windows
deletes perfectly well, which is precisely why it isn't allowed on this surface. The whole-surface
property that buys: **no MCP tool can destroy an artifact on your machine.** Windows removal over
MCP means untrack, and the task keeps running.

**The archive is a precondition, not a courtesy.** The route writes the task definition and its
last 20 runs to an archive *before* deleting, and refuses the delete if that write fails — the
task is left untouched. A backup that quietly no-ops is worse than none, because you'd carry on
believing the task was recoverable.

```text
Using Cronsole, list my deleted-task archives and show me the full definition of
the one I removed this morning.
```

**And the archive can now be spent.** Until 2026-08-17 the archive was write-only — the guarantee
on offer was "we kept a copy", with no verb that turned one back into a task. `restore_task_archive`
is that verb.

```text
Using Cronsole, I deleted a task called "Nightly digest" by mistake. Find it in
my deleted-task archives and bring it back.
```

What comes back is a **new** task: new id, the schedule it had, running. The archived run history
is *not* reattached — those runs belong to a task that no longer exists — and the archive itself is
kept, so asking twice would give you two tasks. Ask the assistant to say the new id back to you.

Only Cronsole-native archives can be restored. A Windows archive records the task's identity but
never held its definition (that lives on the machine as Task Scheduler XML, and reaching it needs
the agent online, which can't be a precondition of a delete), so each row says whether it is
restorable **and why not** when it isn't.

> [!NOTE]
> If `delete_task` isn't enabled, the assistant won't see the tool at all — it's absent from the
> tool list rather than present and erroring — and will offer to disable or untrack instead.
> Turning it on is `CRONSOLE_MCP_ALLOW_DESTRUCTIVE=true` in the environment the MCP host was
> launched from. It's an env var and not a `confirm: true` parameter on purpose: a parameter is
> filled in by the model, which is the model assuring itself it's sure.

## 🪟 Deleting a real Windows task

This one is deliberately not on the MCP surface. The dashboard's task modal has **Delete from
Windows** sitting next to **Remove from Cronsole**, per task, which is where that pairing has
always lived.

```text
Using Cronsole, I want to permanently delete the Windows task "Old Backup Job"
from Task Scheduler. Tell me why you can't do that from here and exactly where in
the dashboard to do it.
```

An admin-ACL'd task refuses with an honest "needs elevation" rather than a silent failure, and
Cronsole's database row only goes after the platform confirms the removal.

## 🧯 Tidying at scale

```text
Using Cronsole, I've got 254 tracked tasks and I only care about about 20. Show
me what I'd be removing, then point me at the Mass Actions console — I understand
bulk untrack isn't an MCP operation.
```

Bulk verbs live in the dashboard because friction should scale with blast radius. Past 25 tasks
the confirmation asks you to **type the count**, which is the smallest gesture muscle memory
can't produce — and a tool call has no equivalent of it. That's an omission by design, not a
missing feature.

## 🔗 Related

| Resource | Why |
|:---|:---|
| [**⚙️ Manage tasks**](manage-tasks.md) | Disable — the reversible option you usually want first. |
| [**🧠 Claude routines**](claude-routines.md) | Disconnect in its own context. |
| [**🖥️ Cronsole-native tasks**](native-tasks.md) | Where delete is allowed, and why nothing is orphaned. |
| [**🧯 Troubleshooting #47**](../../troubleshooting/README.md) | The Claude task that kept coming back. |

---

<p align="center">
  <a href="README.md">← MCP prompts</a> ·
  <a href="manage-tasks.md">Manage tasks</a> ·
  <a href="../rest-api/README.md">Next: REST API →</a>
</p>
