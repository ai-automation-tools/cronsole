---
name: taskhub
description: 'Expert knowledge of TaskHub, the unified scheduled-task management system — its architecture, the Windows .NET agent protocol, the template registry/catalog, the MCP server, the testing layers, and the traps that waste hours. Use when working anywhere in the TaskHub repo — adding or debugging templates, touching the agent WebSocket protocol or Windows Task Scheduler integration, editing the catalog (bundled.ts, registry/, catalogSync, normalize.ts), changing the MCP server or its tools (mcp-server/, list_tasks, run_task, create_task_from_template, convert_schedule) or wiring it into an MCP host, running or writing tests, publishing the registry or landing sites, or diagnosing setup and runtime failures (403 invalid token, unexpanded TASKHUB_TOKEN, missing taskhub MCP tools, agent OFFLINE, stale backend code, 502 agent timeouts, PowerShell parse errors).'
---

# TaskHub

TaskHub is a **single pane of glass** for scheduled tasks across Windows Task Scheduler,
Claude Code Routines, and TaskHub-native HTTP jobs. It is **local-first by design** — the
frontend, backend, and agent all run on the user's own machine. There is no hosted/SaaS
instance; the Hetzner control-plane plan was dropped 2026-07-13.

**Read this first, then read the canonical doc for the area you're touching.** This skill is
a mental model, a set of invariants, and a routing table — **not** a copy of the docs. When
this skill and a repo doc disagree, **the repo wins**; fix the skill.

## The one thing to understand

TaskHub is a **reliability control plane**. Its entire value is that the state it shows is
*true* and the actions you take *actually happen*. That reframes what counts as a bug:

> **A confident lie is the worst possible failure.** A dashboard that reports success for a
> run that never happened is worse than an error, worse than a crash, worse than no dashboard
> at all. When you must choose between a graceful degradation and an honest refusal, **choose
> the honest refusal.**

This is why `task:delete` only removes the DB row *after* the platform confirms; why an
admin-ACL'd task returns "needs elevation" instead of a fake success; why lossy schedule
conversion surfaces a warning instead of quietly degrading; and why a declared-but-uncompiled
target offers "copy to set up manually" rather than silently no-op'ing.

## Architecture at a glance

Four long-running processes plus Redis, and an on-demand `mcp-server` your AI host launches.
The **agent always dials out** — the server never connects in.

```
┌─ Frontend ──┐  REST/JWT + Socket.io   ┌─ Backend ──┐   Prisma    ┌──────────┐
│  React 19   │ ──────────────────────► │  Express 5 │ ──────────► │ Postgres │
│  :5173      │                         │  :3000     │             │  :5432   │
└─────────────┘                         └──────┬─────┘             └──────────┘
                                        ▲  ▲   │  HTTP (sha256-verified)
┌─ MCP host ──┐  MCP/  ┌────────────┐   │  │   └──────────────► Registry / Webhooks
│ Claude/Codex│ stdio  │ mcp-server │   │  │
│   Cursor    │ ─────► │ REST+Bearer│ ──┘  │
└─────────────┘        └────────────┘      │ WS + HMAC (outbound only)
                                    ┌──────┴─────┐   COM    ┌──────────────────┐
                                    │ .NET Agent │ ───────► │ Win Task Sched.  │
                                    │ host .exe  │          └──────────────────┘
                                    └────────────┘
```

The agent is a **client, not a server** — it never binds `0.0.0.0`. It can't be
containerized because it needs Task Scheduler COM access, which is why it's a host process
and why it **never hot-reloads** (see Traps).

The **`mcp-server` is a peer of the frontend, not a layer of its own** — another REST client
holding a bearer token. That's the whole design: it owns **no logic**, so every guarantee
(owner scoping, no-shell `exec`, signed agent commands, cron→trigger conversion) stays in the
backend where it's already tested. A tool that needs new behavior needs a **backend route**,
not cleverness in `mcp-server/`.

Details: [references/architecture.md](references/architecture.md)

## The two AI surfaces — don't conflate them

TaskHub has two, with different audiences and lifecycles. Most confusion here starts with
mixing them up:

| | **This skill** (`skills/taskhub/`) | **The MCP server** (`mcp-server/`) |
|:---|:---|:---|
| Audience | An agent **working on** TaskHub's codebase | An agent **using** a running TaskHub |
| Surface | `SKILL.md` + `references/` | 5 tools over MCP/stdio |
| Needs | Nothing — it's just text | A running backend + a user JWT |
| Canonical doc | [`skills/README.md`](../README.md) | [`docs/user-guides/guides/MCP_Server_Guide.md`](../../docs/user-guides/guides/MCP_Server_Guide.md) |

A third thing shares the name and is neither: the **dev-tooling MCP servers** in the root
`.mcp.json` (context7, playwright, serper, …) that help you *build* TaskHub. That file holds
**both** — the dev tooling *and* a `taskhub` entry pointing at this repo's own product server.
The `taskhub` entry is the only one needing a backend and a token, so it's the only one that
can fail to start.

**The 5 tools** — `list_tasks`, `run_task`, `list_templates`, `create_task_from_template`
(incl. `folder`), `convert_schedule` — each map 1:1 onto a backend route. Details, wiring, and
token minting: [MCP_Server_Guide.md](../../docs/user-guides/guides/MCP_Server_Guide.md).

## Non-negotiable invariants

Violating any of these is a bug even if every test passes. Most are load-bearing for either
security or honesty.

| Invariant | Why it exists |
|:---|:---|
| **All schedules stored as 5-field cron in UTC** | Display converts to local. Storing local time is a whole bug class (wrong-time runs, DST drift). |
| **Structured `exec` stays no-shell** (`{executable, args[]}`) | The P0 injection guarantee. A shell is opted into **explicitly** (`cmd.exe /c "…"`), never implicit. Implicit shell = arbitrary params become arbitrary code. |
| **`PlatformConnection.config` is AES-256-GCM encrypted** before Prisma write | At-rest guarantee. **Never log decrypted values.** |
| **Agent always initiates the WebSocket** | It lives on the user's machine behind their NAT. Inbound = a different (worse) product. |
| **Run commands are HMAC-signed per session** | Replay prevention. |
| **`(platform, externalId)` is unique** | `externalId` is the platform's native id (Windows task path, Claude routine id). |
| **TaskHub never writes under `\Microsoft\`** | `RegisterTaskDefinition` **silently overwrites** a same-named task in the same folder, and the agent runs **elevated** — so writing there could destroy a real Windows task with no error. Refused in the backend **and independently in the agent** (`TaskFolderPath`), because the agent holds the privilege and must not trust its caller. |
| **TaskHub creates exactly one folder: its own `\TaskHub`** | The only one it also *prunes*. **Never create what you cannot remove** — deleting a Task Scheduler folder needs elevation, so any other folder TaskHub created would be a one-way door only the user could close by hand. Every other folder must already exist; a create into a missing one is refused honestly. A user's folder persisting is *correct* — it's theirs. |
| **Every field the agent acts on is inside the signature** | Including the destination `folder` — an unsigned field on a signed command lets an on-path attacker redirect the write. |
| **Registry files are content-addressed (sha256 over exact bytes)** | Keep them **LF** (`.gitattributes`); **never hand-edit `registry/`**. A CRLF flip breaks integrity. |
| **`core` never reaches the DB** | `normalize.ts` whitelists Prisma fields. `core` is a distribution flag, registry-only. |
| **Prune-on-sync never touches `managed: false`** | Imported / saved-as-template rows are the user's. Only auto-synced (`managed: true`) rows outside core are pruned. Guarded against an empty core wiping the catalog. |
| **Platform logic stays in the connector layer** | Every integration implements `PlatformConnector`; no platform-specific logic escapes `backend/src/connectors/`. |
| **Dark theme is the default**, light is the toggle | Not an opt-in. |

## ⚠️ The traps

These have each burned real hours. **Check these before debugging your own code.**

| Trap | The tell | Fix |
|:---|:---|:---|
| **Backend edits don't hot-reload in Docker** | Offline suites pass, but a live request disagrees with the source. A new route 404s. | `docker restart taskhub-backend-1`. Windows→Linux bind mounts don't propagate inotify, so `tsx watch` never fires. |
| **The .NET agent never hot-reloads** | New agent command 502s "Agent … timeout" after ~15s. Route **exists** (bad id → your handler's error, not "Cannot GET"), and only agent-backed paths hang — DB-only paths work. | Republish it from an **Administrator** prompt (it runs elevated; the exe is locked). |
| **Transient test agent strands the real one** | Windows shows `OFFLINE` forever after you stop a second/dogfood agent, though the real agent is still running. | `docker compose restart backend`. One agent socket per user; the real agent only re-registers on reconnect. |
| **403 Invalid or expired token** (dashboard/agent) | Dashboard empty, agent rejected at handshake. | Docker bakes **dev-only default secrets**. Create a root `.env` mirroring `backend/.env`, then `docker compose up -d --force-recreate backend`. |
| **403 on _every_ MCP tool** — but the dashboard and `curl` work | Nothing is actually expired. `${TASKHUB_TOKEN}` was **unset**, so the host passed the *literal* text through and the API rejected it. Reads as an expired JWT and sends you debugging auth instead of your environment. | Export the var, then relaunch the host **from a fresh terminal** — a process inherits its parent's environment, so an already-open terminal keeps handing down the stale one. `configFromEnv()` now detects the literal and refuses to start. |
| **The `taskhub` MCP tools are absent entirely** | Not an error — *absence*. `mcp__taskhub__*` simply isn't in the tool list. | The server exited at startup (usually the token case above) and the host dropped it. Check `/mcp` for the message; a failed-to-boot server is silent by design. |
| **A template passes every test and still hangs on the target** | Task sits `Running` forever (`267009`) with **flat CPU** — blocked, not working — while TaskHub reports `lastRunStatus: SUCCESS` and the suite is green. | **Resolvability proves tokenization, not correctness.** `Invoke-WebRequest` without `-UseBasicParsing` needs the **IE engine Windows 11 removed** → `NullReferenceException`; with no console to print it to, the process blocks instead of exiting. Always `-UseBasicParsing` (or `Invoke-RestMethod`) + `-NoProfile`. A green suite is not evidence a template works — apply it and watch it run. |
| **A System Restore silently wiped per-machine state** | Several unrelated-looking things break at once while the repo is spotless: `Start-ScheduledTask` can't find `TaskHubRepublish`, and/or the MCP tools vanish. Nothing in git changed, so nothing *looks* wrong. | Scheduled-task registrations and the `TASKHUB_TOKEN` User env var live on **`C:`**, not in the repo — a restore takes them and leaves a repo on another drive untouched. Re-register (`Register-RepublishTask.ps1`, elevated) and re-mint the token. **The tell:** if the repo is clean but several things broke together, ask what lives on `C:` rather than in git. |
| **Port LISTENING but `HTTP 000`** | curl connects, gets nothing. | Docker's port proxy holds the port while the app inside crashed. Read `docker logs`, don't chase the port. |
| **`.ps1` parse errors under PowerShell 5.1 only** | `Unexpected token '}'`, errors point at EOF, but `pwsh` 7 runs it fine. | A **non-ASCII char (usually an em-dash `—`) in a BOM-less UTF-8 script**. 5.1 reads it as ANSI → decodes into a curly quote it treats as a string delimiter. **Keep PowerShell/VBScript pure ASCII.** |
| **`ts-node` can't parse TypeScript 6** | Opaque `[Object: null prototype]` crash-loop; `npm run build && npm start` works. | Already fixed — dev runs through **`tsx`**. Any bare null-prototype crash from a TS entrypoint is the *runner*, not your code. |

Canonical, with full symptom/cause/fix: [`docs/troubleshooting/README.md`](../../docs/troubleshooting/README.md).
**When you solve a new one that took real digging, add it there.**

## Where to look

**Route to the canonical doc — don't answer from memory.** These are living; this skill isn't.

| Question | Canonical source |
|:---|:---|
| What's shipped / what's next / open decisions | [`docs/ROADMAP.md`](../../docs/ROADMAP.md) — **the spec of record** |
| Project conventions, domain rules | [`CLAUDE.md`](../../CLAUDE.md) |
| Something's broken at setup/runtime | [`docs/troubleshooting/README.md`](../../docs/troubleshooting/README.md) — **check first** |
| What to test, what covers it today | [`docs/testing/`](../../docs/testing/README.md) |
| How to hand-verify real Windows/agent/security | [`docs/testing/manual-testing/`](../../docs/testing/manual-testing/README.md) |
| Template registry schema + decisions | [`docs/reports/templates/Registry_Schema_v1.md`](../../docs/reports/templates/Registry_Schema_v1.md), [`docs/adr/0001-template-registry-schema.md`](../../docs/adr/0001-template-registry-schema.md) |
| Catalog spec | [`docs/reports/templates/Templates.md`](../../docs/reports/templates/Templates.md) |
| Env vars / config | [`docs/setup/README.md`](../../docs/setup/README.md) |
| Using the app / agent | [`docs/user-guides/`](../../docs/user-guides/README.md) |
| **The MCP server** — tools, wiring, tokens, its troubleshooting | [`docs/user-guides/guides/MCP_Server_Guide.md`](../../docs/user-guides/guides/MCP_Server_Guide.md) — **the canonical doc** |
| **MCP package internals** — source layout, design notes, `npm run inspect` | [`mcp-server/README.md`](../../mcp-server/README.md) |
| This skill itself — install, design rules | [`skills/README.md`](../README.md) |
| An external library's API | **`context7` MCP** — before writing code, not after |

## Deep dives

Load these on demand — don't read them all up front:

| Reference | When |
|:---|:---|
| [architecture.md](references/architecture.md) | Data model, connector pattern, agent protocol, API surface, request shapes |
| [templates.md](references/templates.md) | The catalog/registry: core vs extended, adding a template, publishing |
| [testing.md](references/testing.md) | Suites, commands, what CI does and doesn't enforce |
| [troubleshooting.md](references/troubleshooting.md) | The traps in full, plus how to diagnose a new one |
| [workflows.md](references/workflows.md) | Step-by-step for the common jobs (add a template, add an agent command, publish, run the stack) |

## Working rules

1. **Start from `docs/ROADMAP.md`.** It's the plan of record. A material decision updates it **first**, then you implement.
2. **Check `docs/troubleshooting/README.md` before debugging** any setup/runtime failure. Most "impossible" behavior is a known trap above.
3. **`context7` before writing** against React, Prisma, Express, Socket.io, Tailwind, .NET, or WiX.
4. **Templates are content, not code.** Never inline them in `seed.ts`. Edit `bundled.ts` → `npm run registry:build` → publish.
5. **Never hand-edit `registry/`.** It's generated and content-addressed. The drift test will fail you.
6. **A material change ships with its test.** A bug fix ships with a test that failed before it.
7. **Two things run stale**: the Dockerized backend and the published agent. When live behavior contradicts source, suspect these before your logic.
8. **Prefer the honest refusal** over the graceful lie. See "The one thing to understand."
9. **The MCP server and this skill are mirror surfaces — update them in the same change.** See below.
10. **Commits**: conventional prefix, imperative subject (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
11. **Never commit** `.env*`, `node_modules/`, `dist/`, `bin/`, `obj/`, `*.msi`.

## Keeping the mirror surfaces in sync

`mcp-server/` and this skill both **describe** TaskHub rather than implement it, so neither
breaks loudly when it drifts — the tests stay green, and the drift surfaces later as an agent
confidently doing the wrong thing. That's "the confident lie" aimed at your future self.
**They don't get a follow-up pass; they ship in the same change.**

| You changed… | Also update, same change |
|:---|:---|
| A backend route a tool maps to — `/api/tasks`, `/api/tasks/:id/run`, `/api/templates`, `/api/templates/:id/apply`, `/api/tasks/preview` | `mcp-server/src/tools.ts` + `client.ts`; the tool tables in [`mcp-server/README.md`](../../mcp-server/README.md) + [`MCP_Server_Guide.md`](../../docs/user-guides/guides/MCP_Server_Guide.md) |
| Added / removed / renamed an MCP tool, or changed its params | Both tool tables above, **and** the tool list in "The two AI surfaces" here |
| An MCP env var, or how it's read | [`mcp-server/.env.example`](../../mcp-server/.env.example) + the config table in **both** READMEs |
| A new invariant or architectural rule | The invariants table here |
| A new trap that cost real hours | [`docs/troubleshooting/README.md`](../../docs/troubleshooting/README.md) **and** the traps table here |
| A new platform / connector / catalog rule | The invariants table here + the relevant `references/*.md` |
| Anything shipped, or scope moved | [`docs/ROADMAP.md`](../../docs/ROADMAP.md), dated |

**Ask on every change: "would an agent reading only this skill now be wrong?"** If yes, the
change isn't finished. Same question for the wrapper: a route whose shape moved leaves
`mcp-server/` lying about the API it wraps.

Two asymmetries worth holding onto:

- **The repo wins.** When this skill and a doc disagree, the doc is right — fix the skill.
- **`mcp-server/` holds no logic.** If syncing it tempts you to add behavior there, that
  behavior belongs in a backend route. A wrapper that grows logic stops being a wrapper, and
  the guarantees quietly fork.
