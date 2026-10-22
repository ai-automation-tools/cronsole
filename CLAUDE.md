@AGENTS.md

# Cronsole: Claude Code notes

[`AGENTS.md`](AGENTS.md) is the project's instruction file, imported above. This file holds only what
is specific to Claude Code. Section numbers match the ones `AGENTS.md` and the docs cite.

## 8. Commands

- **`/doctor`**: stale processes, agent connectivity, `CRONSOLE_TOKEN`. Run it before debugging your
  own code.
- **`/sync-surfaces`**: the §11a drift check, mechanized. Run it before committing anything
  non-trivial.

Both live in [`.claude/commands/`](.claude/commands/), alongside the three in-repo subagents in
`.claude/agents/` and the `api-architect` and `release-engineering` skills in `.claude/skills/`.

### 8a. Project-local `.claude/`

Only `agents/`, `commands/`, and `skills/` are tracked — `.gitignore` denies `/.claude/*` and
re-includes those three, so per-machine noise (`settings.local.json`, `temp/`, IDE state) can never be
committed by accident. `.claude/skills/cronsole` is a per-machine **junction** to the tracked
[`skills/cronsole/`](skills/README.md), created by `scripts/setup-skill-links.ps1` (run once per fresh
clone). **Always edit `skills/cronsole/`, never through the link**, and give each linked skill a
`/.claude/skills/<name>/` line in `.gitignore` or git follows the junction and commits the content
twice. **A dangling junction is not an error, it is an absence** — Claude Code loads no skill and says
nothing.
