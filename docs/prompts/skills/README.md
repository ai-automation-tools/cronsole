<a id="skill-prompts-top"></a>

<h1 align="center">🧠 Skill Prompts</h1>

<p align="center">
  <em>Work on Cronsole's codebase with the <code>cronsole</code> Agent Skill loaded.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/surface-cronsole_skill-8B5CF6?style=for-the-badge" alt="cronsole skill">
  <img src="https://img.shields.io/badge/audience-builders-F97316?style=for-the-badge" alt="Builders">
</p>

---

These prompts are for an assistant working **inside the Cronsole repo** with the `cronsole`
Agent Skill available. The skill carries the mental model, the non-negotiable invariants, the
traps that have cost real hours, and a routing table to the canonical docs — so an agent knows
the system *before* it edits it.

> [!NOTE]
> The skill usually **surfaces itself** when you work in the repo. You can also invoke it
> explicitly with `/cronsole`. It lives canonically at
> [`skills/cronsole/`](../../../skills/README.md) and is teaching material, **not** a way to
> operate a running instance — for that, use [**mcp-server/**](../mcp-server/README.md).

Unlike the MCP prompts, these don't call tools — they ask the assistant to **read, reason
about, and change code** the right way. The value is that the skill steers it away from the
known traps.

---

## 📖 Understand the system

```text
Using the cronsole skill, give me the architecture in a paragraph: the four
long-running processes, who dials out to whom, and why the agent can't be
containerized.
```

```text
Using the cronsole skill, explain how a created Windows task's cron schedule
becomes a real Task Scheduler trigger, and where that conversion can go lossy.
```

```text
Using the cronsole skill, what are the non-negotiable invariants I have to
respect if I touch the agent command-signing path?
```

```text
Using the cronsole skill, walk me through the "two AI surfaces" — the MCP server
vs. the skill — and which one owns what.
```

## 🧩 Work on the template catalog

```text
Using the cronsole skill, add a new template that runs a weekly `npm audit` and
writes the report to a file. Follow the catalog workflow — edit bundled.ts,
rebuild the registry, and tell me what I still need to publish.
```

```text
Using the cronsole skill, explain the core vs. extended tiers and what I flip to
promote a template into the built-in set. What must NOT reach the database?
```

```text
Using the cronsole skill, one of my templates fails to resolve through the Apply
pipeline. Walk the resolvability path and find what's wrong with its
commandTemplate.
```

## 🔌 Work on the MCP server

```text
Using the cronsole skill, I want to add an MCP tool that lists a task's next few
run times. Where does the logic belong, what must I NOT put in mcp-server/, and
what mirror surfaces do I have to update in the same change?
```

```text
Using the cronsole skill, I changed the response shape of GET /api/tasks. What in
the MCP server and its tests could now be silently lying, and how do I verify
the wrapper still agrees with the API?
```

## 🔗 Work on a connector or a platform

```text
Using the cronsole skill, I want to add a connector for a scheduler that can only
be read, never controlled. Is a read-only connector a finished thing or a stalled
one, and what does the capability matrix have to say about it?
```

```text
Using the cronsole skill, explain the two Claude Code API modes and why
unsupportedVerbs is a getter rather than a fixed array. What does that mean for
any test I write against Claude's capabilities?
```

```text
Using the cronsole skill, I'm adding a verb a platform can't support. Walk me
through declared vs. unsupported, which status code each produces, and why
getting it wrong is worse than leaving the verb out.
```

```text
Using the cronsole skill, why can't a health check just probe the platform? Show
me where the verdict comes from instead, and what a timestamp is allowed to mean.
```

## 🐛 Debug a trap

The skill's whole point is catching these before you burn an afternoon:

```text
Using the cronsole skill, my agent shows OFFLINE in the dashboard even though
it's clearly running. What's the likely cause and the fix?
```

```text
Using the cronsole skill, I added a new backend route but a live request 404s
while the tests pass. What's going on?
```

```text
Using the cronsole skill, a new agent command 502s with "Agent timeout" after
~15 seconds, but DB-only routes work fine. Diagnose it.
```

```text
Using the cronsole skill, my .ps1 parses fine in pwsh 7 but throws "Unexpected
token" under PowerShell 5.1. What's the trap and how do I fix it?
```

## ✅ Do it right (process)

```text
Using the cronsole skill, I'm about to commit a change that adds a backend route
and an MCP tool. Which records and mirror surfaces must I update in the SAME
change, per the repo's rules?
```

```text
Using the cronsole skill, I just solved a confusing setup failure that cost me an
hour. Where should it be documented, and in what form?
```

## 🔗 Related

| Resource | Why |
|:---|:---|
| [**🧠 The `cronsole` skill**](../../../skills/README.md) | What the skill knows, how it's installed (the per-machine junction). |
| [**🧯 Troubleshooting**](../../troubleshooting/README.md) | The canonical symptom → cause → fix log the skill routes to. |
| [**🗺️ Roadmap**](../../ROADMAP.md) | The plan of record — a material change updates it first. |
| [**🤖 CLAUDE.md**](../../../CLAUDE.md) | Project conventions the skill enforces. |

---

<p align="center">
  <a href="../README.md">← Prompt Library</a> ·
  <a href="../mcp-server/README.md">MCP Server</a> ·
  <a href="../rest-api/README.md">REST API</a>
</p>

<p align="right">(<a href="#skill-prompts-top">back to top</a>)</p>
