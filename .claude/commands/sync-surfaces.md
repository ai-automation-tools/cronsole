---
allowed-tools: Read, Edit, Bash, Grep, Glob
argument-hint: (no args = working tree) | <git-ref> | --staged | --fix
description: Check whether a change leaves the MCP server, the taskhub skill, or the docs describing something that is no longer true — and fix what drifted
---

# Sync the mirror surfaces

Run **before committing** any non-trivial change, and before declaring work done.

## Why this exists

`mcp-server/` and `skills/taskhub/` both **describe** TaskHub rather than implement it. So
when they drift, **nothing fails**. The suite stays green, CI is happy, and the drift
surfaces weeks later as an agent — or a user — confidently doing the wrong thing.

That is the *confident lie*, the failure mode `CLAUDE.md` §9 ranks as the worst there is,
aimed squarely at your future self. These surfaces do not get a follow-up pass. **They ship
in the same change that obsoletes them.**

This has already bitten: the skill went months with **zero** MCP-server coverage while
`mcp-server/` shipped, and two READMEs asserted the server was not wired into `.mcp.json`
long after it was — which actively misdirected a live debugging session.

## Instructions

### 1. Get the changed files

```bash
git diff --name-only              # working tree (default)
git diff --name-only --staged     # --staged
git diff --name-only <ref>        # explicit ref
```

### 2. Map each change to the surfaces it obligates

| If the change touched… | Then verify / update |
|:---|:---|
| `backend/src/routes/tasks.ts` or `templates.ts` — specifically `GET /api/tasks`, `POST /api/tasks/:id/run`, `GET /api/templates`, `POST /api/templates/:id/apply`, `POST /api/tasks/preview` | `mcp-server/src/tools.ts` + `client.ts`; the tool tables in `mcp-server/README.md` **and** `docs/user-guides/guides/MCP_Server_Guide.md` |
| `mcp-server/src/tools.ts` — a tool added, removed, renamed, or its params changed | Both tool tables above, **and** the tool list in `skills/taskhub/SKILL.md` › "The two AI surfaces" |
| `mcp-server/src/client.ts` — env vars or how they are read | `mcp-server/.env.example` + the config table in **both** READMEs |
| A new architectural rule or invariant | `CLAUDE.md` §9 + the invariants table in `SKILL.md` |
| A new trap that cost real hours | `docs/troubleshooting/README.md` **and** the traps table in `SKILL.md` |
| `backend/src/connectors/` or `backend/src/catalog/` | `CLAUDE.md` §9 + `SKILL.md` + `skills/taskhub/references/*.md` |
| Anything shipped, or scope moved | `docs/ROADMAP.md`, dated |
| `agent/` — a new `task:*` command or a `SignableCommand` variant | The agent protocol section in `references/architecture.md`; confirm backend and agent ship **together** |

### 3. Check the surfaces are not merely present, but *true*

Presence is not correctness. For each surface the table flagged, **open it and read the
claim**, then verify the claim against the source:

- Does a documented route still have that shape and status code?
- Does a tool table list the tools that actually exist in `tools.ts`?
- Does a config table match what `configFromEnv()` actually reads?
- Does the skill's traps table still name the *real* cause, or an older one?

A stale sentence that reads plausibly is worse than a missing one. Grep for the specific
claim rather than trusting that a section exists.

### 4. Verify the mechanics

```bash
cd backend && npm test            # registry drift test lives here
cd ../mcp-server && npm run build # dist/ is what the host runs; unbuilt = invisible
```

Validate any touched skill frontmatter with a **real YAML parser**, not a regex. Confirming
`---` delimiters exist does not prove the YAML parses — a plain scalar containing `": "`
silently breaks, and that shipped once already.

## Report format

For each obligated surface: **in sync** / **DRIFTED** with the specific claim that is now
false and where. Then the single sentence that answers the whole question:

> **Would an agent reading only the skill now be wrong? Does the wrapper still describe the
> API it wraps?**

If nothing drifted, say so plainly — that is a real result.

## Two asymmetries to hold onto

- **The repo wins.** When the skill and a doc disagree, the doc is right — fix the skill.
  The skill routes; it must never become a second, staler copy of the docs.
- **`mcp-server/` owns no logic.** If syncing it tempts you to add behavior there, the
  behavior belongs in a **backend route** — that is what keeps owner scoping, no-shell
  `exec`, signed agent commands, and cron→trigger conversion in one tested place. A wrapper
  that grows logic stops being a wrapper, and the guarantees quietly fork.

## Arguments

- *(none)* — check the working tree
- `<git-ref>` — check against a ref (e.g. `main`, `HEAD~3`)
- `--staged` — check only staged changes
- `--fix` — apply the updates rather than only reporting them

$ARGUMENTS
