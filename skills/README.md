<a id="skills-top"></a>

<h1 align="center">🧠 Skills</h1>

<p align="center">
  <em>Portable, versioned expertise about Cronsole — for any Claude Code session that works on it.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/format-Agent_Skill-8B5CF6?style=for-the-badge" alt="Agent Skill">
  <a href="../docs/README.md"><img src="https://img.shields.io/badge/↩-docs_home-6B7280?style=for-the-badge" alt="Docs Home"></a>
</p>

---

This folder is the **source of truth** for Cronsole's Agent Skills — tracked, reviewable, and
versioned alongside the code they describe. Skills are how an AI agent gets Cronsole's mental
model, invariants, and hard-won traps **before** it starts editing.

## 📦 What's here

| Skill | What it gives an agent |
|:---|:---|
| [**🗓️ cronsole/**](cronsole/SKILL.md) | The whole system: architecture, the agent protocol, the template registry, testing layers, and the traps. Routes to canonical docs rather than duplicating them. |
| [**🩺 source-doctor/**](source-doctor/SKILL.md) | A full test-and-fix session across every connected source, using the live `cronsole` MCP tools — classifies a "failed" task against known false signals before proposing a fix. |

## 🌍 More Cronsole skills, in the skills repo

Two further skills live outside this repo, in the org's skill library —
**[`agent-skills` › `Skills/Projects/cronsole/`](https://github.com/ai-automation-tools/agent-skills/tree/main/Skills/Projects/cronsole)**.
They are an **overlay**, not a replacement: nothing here is duplicated there, and nothing there
replaces a skill in this folder.

| Skill | What it gives an agent |
|:---|:---|
| [**🪟 cronsole-windows-jobs**](https://github.com/ai-automation-tools/agent-skills/tree/main/Skills/Projects/cronsole/cronsole-windows-jobs) | The four archetypes a Windows Task Scheduler job turns out to be — an unattended agent CLI run, a wrapped maintenance script, a service watchdog, a plain command — plus a runnable wrapper and registrar, and how to verify a job actually works rather than merely reports that it did. |
| [**☁️ cronsole-claude-routines**](https://github.com/ai-automation-tools/agent-skills/tree/main/Skills/Projects/cronsole/cronsole-claude-routines) | Scheduled agent routines in the cloud: the four routine types, the prompt contract an unattended prompt needs, and Cronsole's dual-mode `CLAUDE_CODE` connector. |

**The split is deliberate.** The skills *here* teach an agent to work on **Cronsole's codebase**;
those teach it to **design the jobs Cronsole schedules**. Different audience, different lifecycle —
and the `cronsole` skill already covers the mechanics of *creating* a task once you know what you
want, which is why they start one step earlier, at which shape the job should be.

**To install them**, clone the skills repo and run its installer against this clone:

```powershell
pwsh scripts/install-skills.ps1 -Project cronsole -Destination <path-to-cronsole>/.claude/skills
```

They land flat as `.claude/skills/<name>/`, so give each one a `/.claude/skills/<name>/` line in
this repo's `.gitignore` — same rule as the junctions below, and for the same reason.

## ⚙️ Installing it — run one script

Claude Code loads skills from **`.claude/skills/`**, not from this folder. The setup script
creates a per-machine **junction** (Windows) / **symlink** (POSIX) at
`.claude/skills/<name>` pointing back here — so the agent reads the tracked source directly
and **there is no second copy to drift**.

```powershell
pwsh scripts/setup-skill-links.ps1     # Windows
```

```bash
./scripts/setup-skill-links.sh          # Linux / macOS
```

**Run once per fresh clone.** Idempotent — safe to re-run any time, and re-run after adding a
new skill. Then **restart Claude Code** and confirm it activates by asking something in-scope,
e.g. *"why is the Windows agent showing OFFLINE?"* or *"how do I add a template?"*

The script:
- Uses **junctions on Windows — no admin rights or Developer Mode needed**.
- Links **only folders containing a `SKILL.md`**, so `references/` and stray dirs are skipped.
- **Refuses to clobber a real directory** — if `.claude/skills/<name>` is a genuine folder it
  warns and skips, rather than deleting your work.
- Leaves the other skills committed under `.claude/skills/` **untouched**.
- **Verifies each link is gitignored** and warns loudly if not (see below).

> [!WARNING]
> **Every new skill needs a `.gitignore` line.** Unlike sibling repos that ignore their whole
> CLI tree, cronsole **tracks** `.claude/skills/` — so git follows the junction and would commit
> the skill content **twice**: once under `skills/`, again under `.claude/skills/`. The
> `.gitignore` carries `/.claude/skills/cronsole/` for exactly this reason. Add a line per new
> skill; the setup script will tell you if you forget.

**Always edit the copy here**, never through the link.

## 🧭 Design rules

These keep the skill useful instead of becoming stale weight:

1. **Don't duplicate the docs.** The repo's docs are extensive and living. A skill that copies
   them rots — and a *confidently wrong* skill is worse than no skill. Encode the **mental
   model, invariants, traps, and routing**; point at `docs/` for the rest.
2. **The repo wins.** When the skill and a doc disagree, the doc is right — fix the skill.
3. **Progressive disclosure.** `SKILL.md` is the entry point and stays scannable; detail lives
   in `references/*.md`, loaded only when relevant.
4. **Favor the durable over the current.** "Agent always dials out" and "no implicit shell"
   will be true next year. Exact counts and file lists won't — keep those in the docs, or
   accept they need maintenance.
5. **Traps earn their place.** Anything that cost real hours belongs here *and* in
   [`docs/troubleshooting/`](../docs/troubleshooting/README.md).

## 🔗 Related

| Location | What's inside |
|:---|:---|
| [**🤖 CLAUDE.md**](../CLAUDE.md) | Project conventions — loaded automatically, always in context |
| [**📚 docs/**](../docs/README.md) | The canonical documentation the skill routes to |
| `.claude/skills/` | Where Claude Code actually loads project skills from |
| [**🧩 mcp-server/**](../mcp-server) | The *other* AI surface — drives Cronsole at runtime, rather than teaching an agent about the codebase |
| [**💬 Prompt library**](../docs/prompts/README.md) | Ready-to-use prompts for both surfaces — [skill prompts](../docs/prompts/skills/README.md) for codebase work, [MCP prompts](../docs/prompts/mcp-server/README.md) for running tasks |

> [!NOTE]
> **Skill vs. MCP server** — easy to conflate. The **skill** teaches an agent how to *work on*
> Cronsole's codebase. The **MCP server** lets an agent *use* a running Cronsole (list, run, and
> create tasks). Different audiences, different lifecycles.

<p align="right">(<a href="#skills-top">back to top</a>)</p>

---

<p align="center">
  <a href="../README.md">Repository Root</a> ·
  <a href="../docs/README.md">Documentation</a> ·
  <a href="cronsole/SKILL.md">Cronsole Skill</a>
</p>
