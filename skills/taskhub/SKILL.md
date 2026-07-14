---
name: taskhub
description: Expert knowledge of TaskHub, the unified scheduled-task management system — its architecture, the Windows .NET agent protocol, the template registry/catalog, the testing layers, and the traps that waste hours. Use when working anywhere in the TaskHub repo: adding or debugging templates, touching the agent WebSocket protocol or Windows Task Scheduler integration, editing the catalog (bundled.ts, registry/, catalogSync, normalize.ts), running or writing tests, publishing the registry or landing sites, or diagnosing setup and runtime failures (403 invalid token, agent OFFLINE, stale backend code, 502 agent timeouts, PowerShell parse errors).
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

Four processes plus Redis. The **agent always dials out** — the server never connects in.

```
┌─ Frontend ──┐  REST/JWT + Socket.io   ┌─ Backend ──┐   Prisma    ┌──────────┐
│  React 19   │ ──────────────────────► │  Express 5 │ ──────────► │ Postgres │
│  :5173      │                         │  :3000     │             │  :5432   │
└─────────────┘                         └────────────┘             └──────────┘
                                          ▲       │  HTTP (sha256-verified)
                       WS + HMAC          │       └──────────────► Registry / Webhooks
                       (outbound only)    │
                                    ┌─────┴──────┐   COM    ┌──────────────────┐
                                    │ .NET Agent │ ───────► │ Win Task Sched.  │
                                    │ host .exe  │          └──────────────────┘
                                    └────────────┘
```

The agent is a **client, not a server** — it never binds `0.0.0.0`. It can't be
containerized because it needs Task Scheduler COM access, which is why it's a host process
and why it **never hot-reloads** (see Traps).

Details: [references/architecture.md](references/architecture.md)

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
| **403 Invalid or expired token** | Dashboard empty, agent rejected at handshake. | Docker bakes **dev-only default secrets**. Create a root `.env` mirroring `backend/.env`, then `docker compose up -d --force-recreate backend`. |
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
| Using the app / agent / MCP | [`docs/user-guides/`](../../docs/user-guides/README.md) |
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
9. **Commits**: conventional prefix, imperative subject (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
10. **Never commit** `.env*`, `node_modules/`, `dist/`, `bin/`, `obj/`, `*.msi`.
