# Architecture

Load when touching the data model, connectors, the agent protocol, or the API surface.

> Verify against source before relying on a shape here — `backend/prisma/schema.prisma` and
> `backend/src/routes/` are the truth. This file is the map, not the territory.

## The processes

| Piece | Runs as | Port | Notes |
|:---|:---|:--|:---|
| **Frontend** | Vite dev server (host) | `7373` | React 19 + TS + Tailwind + TanStack Query + React Router |
| **Backend** | Node/Express 5 (Docker or host) | `3000` | TypeScript, Socket.io, Prisma |
| **Postgres** | Docker | `5432` | v16 |
| **Redis** | Docker | — | Optional for MVP; required for multi-instance WebSocket |
| **Agent** | Host `.exe` (**never** Docker) | — | .NET 10 + `Microsoft.Win32.TaskScheduler`; needs COM access |
| **MCP server** | On-demand, **launched by your AI host** (stdio) | — | `mcp-server/dist/index.js`; a REST client with a bearer token. Not part of `cronsole.ps1`; the host starts and stops it |

Control the whole stack with `pwsh scripts/cronsole.ps1 <up|down|restart|status|logs>`
(`down -All` also stops the Docker db/redis). It exists so you stop wondering which part is
down. `status` asks each service directly (`/api/health`, HTTP `GET /`, `pg_isready`, a RESP
`PING`) and prints the signal it used; a bare port check is corroboration only, having been
wrong in both directions ([#23](../../../docs/troubleshooting/README.md#23-network-error-after-a-reboot--the-database-system-is-starting-up)
/ [#23a](../../../docs/troubleshooting/README.md#23a-and-the-same-probe-reported-four-services-down-while-all-four-were-serving)).

## Data model

Prisma models, **no `@@map`** — so SQL needs quoted PascalCase: `SELECT * FROM "Task";`

| Model | Key fields | Constraints |
|:---|:---|:---|
| `User` | email, password (hashed) | — |
| `PlatformConnection` | platform, **config (encrypted)**, isActive, healthState | `@@unique([userId, platform])` |
| `Task` | platform, **externalId**, name, category, schedule (5-field cron **UTC**), nextRunTime, status, quickLink, metadata | `@@unique([platform, externalId])`; indexed on `[userId, platform]`, `nextRunTime`, `category` |
| `ExecutionLog` | per-run status/time/output | indexed on `[taskId, triggeredAt]` **and** `[triggeredAt]` — the second exists for the cross-task history range, which the first (leading with `taskId`) cannot serve |
| `Template` | see below | indexed on `[isPublic, upvotes]`, `[isStarter, os]` |
| `TemplateFavorite` | userId, templateId | `@@unique([userId, templateId])` |

**`Task.externalId`** is the platform's native id — a Windows task path, a Claude routine id.
That's what makes `(platform, externalId)` a meaningful uniqueness key.

**`ExecutionLog` is not a complete run history** and reading it as one is wrong at dashboard scale.
Rows are written in exactly two places — `POST /api/tasks/:id/run` and `NativeScheduler` — so it
records runs **Cronsole performed**. A Windows task firing on its own schedule writes nothing, and a
manual Windows run's `SUCCESS` means *"the agent accepted the start"*, with `durationMs` timing the
round trip rather than the work. A Windows task's real outcome lives in the sync snapshot
(`metadata.lastTaskResult`, `lastRunTime`, `numberOfMissedRuns`), which is why the agent reports
them at all.

**`TemplateFavorite` is a join model, deliberately** — not a column on `Template`. Favoriting
must never mutate the shared catalog. It's the honest per-user signal that replaced fake
upvotes.

**`Template.managed`** is the provenance flag that makes prune-on-sync safe:
- `true` — auto-synced from the bundled/registry catalog. `catalogSync` owns it and **may prune it**.
- `false` — user-authored (imported or saved-as-template). **Never pruned.**

`Template.tags` (`String[]`) is free-form and **distinct from** the single `category` enum.

### Enums

`PlatformType`: `WINDOWS_TASK_SCHEDULER`, `MACOS_LAUNCHD` (catalog-only until built),
`CLAUDE_CODE`, `CHATGPT`, `JULES`, `OPEN_CLAW`, `HERMES`, `TASKHUB_NATIVE`.

Only **Windows** and **Cronsole-native** have real compilers today. A declared-but-uncompiled
`compatibleTargets` entry is the honest "copy to set up manually" path — **never** a silent
failure.

## Connector pattern

Every integration implements `PlatformConnector` (`backend/src/connectors/platform.interface.ts`)
and registers in `backend/src/connectors/registry.ts`. **No platform-specific logic lives
outside this layer.**

Implementations: `WindowsAgentConnector`, `CronsoleNativeConnector`, `ClaudeConnector`.

### Capability is encoded in the type system

This is the pattern worth understanding. **Required** methods every connector must have:

```ts
runTask(externalId, config): Promise<{ success, platformRunId?, message? }>
getHealth(config): Promise<ConnectorHealth>
createTask(name, schedule, command, config, options?): Promise<{ success, externalId?, message? }>
```

**`getHealth` has a contract beyond its signature, and every connector broke it the same way.**
`ConnectorHealth` is `{ state, reason?, lastContactAt? }`, and both optional fields are optional
*because absence is a legitimate answer*:

- **Derive `state` from evidence the platform produced, never from a precondition.** All three
  connectors returned `HEALTHY` from something that cannot change when the platform fails — a
  socket object existing (Windows), being in-process (native), a non-empty config (Claude). A
  wedged agent therefore read as Online through a run of `Agent sync timeout`s.
- **There is no `lastSync` on this interface, and that is the fix.** It had one until
  2026-08-12, and *it could not be filled honestly*: `WindowsAgentConnector` set it to
  `lastResponseAt` — the agent's last inbound event of any kind — so a **folder listing** made a
  19-hour-old task list render as *"Synced 7m ago"*. `lastSync` now has exactly one writer, the
  `PlatformConnection.lastSync` column that `POST /api/tasks/sync` records, and no connector can
  override it because there is no field to override it with.
- **What a connector *may* report is `lastContactAt`** — when the platform last said anything.
  That is liveness, and it is genuinely useful, which is why it gets its own name rather than
  being smuggled in under a label that means something else. If you have no real timestamp,
  **omit it**; a `new Date()` inside a health check can never be stale, which is exactly why it
  can never be true.
- The blast radius is global, not per-connector: the dashboard's *"synced N ago"* chip takes the
  **newest `lastSync` across every platform**, so one connector inventing a time defeats the
  honesty of all the others. That is why a connector with nothing to sync from reports none at all.

**The sequence is the lesson.** #40 was a *fabricated* timestamp; #42 was a **real timestamp of
the wrong event**, introduced by #40's own fix, and it passed every check that fix installed —
first-hand, absent without evidence, correctly stale when the agent went quiet. Ask what event
writes a status field and whether that is what the label names.

See the invariants table in [`SKILL.md`](../SKILL.md),
[troubleshooting #40](../../../docs/troubleshooting/README.md#40-the-sidebar-says-windows-is-online-and-synced-just-now-while-every-agent-request-times-out)
and [#42](../../../docs/troubleshooting/README.md#42-the-dashboard-says-synced-7m-ago-over-a-task-list-from-yesterday).

**Optional** methods (note the `?`) — a connector only declares what it can honestly do:

```ts
updateSchedule?(externalId, trigger, config)
updateActions?(externalId, input, config)
deleteTask?(externalId, config)
listFolders?(config): Promise<{ success, folders, message? }>
exportTask?(externalId, config): Promise<{ success, xml?, message? }>
importTask?(externalId, xml, { overwrite, createFolders }, config): Promise<ImportTaskResult>
```

`importTask` is `exportTask`'s write twin, and its result is **four-state**
(`created | replaced | exists | refused`) rather than a boolean — `exists` is neither a success
nor a failure, and every boolean shape collapses it into a lie in one direction.

A connector that can't delete **doesn't implement `deleteTask`** — so the route can tell the
user honestly instead of pretending. Don't add a stub that returns `{ success: true }`; that
converts a missing capability into a lie. Leaving it undefined *is* the design.

### `unsupportedVerbs` — for the four the type system can't help with

Absence encodes incapability for the optional methods above. The **required** four (`syncTasks`,
`runTask`, `createTask`, `setTaskStatus`) get no such signal: the interface demands them, so
`verbReachability` read their presence as proof the route would accept them. That is right for a
method that reaches a platform and wrong for one that is a hardcoded `{ success: false }` because
no such API exists — the Platforms matrix rendered Claude's `create` and `setStatus` as
**`declared`**, which reads *"reachable, just unproven"*.

```ts
readonly unsupportedVerbs?: readonly CapabilityVerb[];   // structurally impossible, not "not yet"
```

Declared on the connector, checked **first** in `verbReachability` — ahead of both the
mandatory-verb branch and the Cronsole-native route carve-outs, since either would otherwise
return `true` and restore the exact cells this removes. `CapabilityVerb` lives in
`platform.interface.ts` (not the service) so the connectors can name verbs without an import
cycle; the service re-exports it.

**Only for the impossible.** A verb that fails today because the agent is offline is still
reachable — that is what health is for. `declared` is a promise, `unsupported` is a boundary.

### Connectors are not all Windows-shaped

`WindowsAgentConnector` reads *and* writes, and it quietly sets the expectation for the others.
Two other shapes are legitimate, and each has to say which it is:

| Shape | Example | What it means |
|:---|:---|:---|
| **Dual-mode** | `ClaudeConnector` | **Two APIs, chosen per call by `services/claudeOAuth.ts`.** *OAuth mode* (a Claude Code session is readable on the backend's host): `/v1/code/triggers` gives a real `syncTasks` (name, 5-field UTC cron, enabled, platform-supplied `next_run_at`), plus `create`, `setStatus`, `updateSchedule` and token-free `run`. *Declared mode* (no session): the documented `POST /v1/claude_code/routines/{id}/fire` with a per-routine token — `run` only, `syncTasks` returns **the routines the user declared in config**, which is not a sync and is documented as not being one, and `create`/`setStatus`/`updateSchedule` are `unsupportedVerbs`. **`unsupportedVerbs` is a getter**, because the answer is a property of the install. **Neither mode can delete** — no DELETE exists on either family (verified). The declared path is kept as the fallback precisely because door 2 is undocumented and beta-gated. |
| **Read-only (observer)** | planned: GitHub Actions, Vercel Cron | Reads everything, mutates nothing. The mirror image; between them they bracket the pattern. |

Both earn a connector over a plain quick link by one test — **does it do something a bookmark
cannot?** Firing a routine does; that is why Claude keeps a connector while ChatGPT and Jules
stay links.

Write-only has one consequence that generalizes: **a health check may not have a side effect.**
Claude's only endpoint *fires the routine*, so "check whether this works" and "run the user's
nightly job" are the same request — a probing `getHealth` would burn their daily run cap on every
poll. It therefore reads back the `PlatformCapability` evidence the run route already writes.
Where no read-only probe exists, the record of real runs is the only honest health signal there
is. See [troubleshooting #45](../../../docs/troubleshooting/README.md#45-cronsole-cant-list-pause-or-create-claude-code-routines).

## Agent ↔ Server protocol

- **The agent always initiates.** Outbound from the user's machine. The server never connects
  in. The agent is a client — **no `0.0.0.0` binds.**
- **Envelope:** `{ type: string, payload: object }`. Types are `noun:verb` — `task:run`,
  `agent:hello`, `task:scan`, `agent:tasks:list`, `task:create`, `task:delete`, `task:export`,
  `task:import`, `task:folders`.
- **Heartbeat:** ping every 30s. Reconnect with exponential backoff, **1s → 5min cap**.
- **Run commands are HMAC-signed** per session to prevent replay. Read-only commands (e.g.
  `task:export`, `task:folders`) aren't signed — but still need the agent republished for the
  handler to exist.
- **`task:import` (restore, 2026-07-28) is the export verb's write twin, and is signed** —
  including the task's whole XML, folded in as a **sha256 of its UTF-8 bytes** rather than by
  value. The XML *is* the task (action, trigger, and the account it runs as), so leaving it out
  would make the signature decorative; embedding it raw would put arbitrary `|` bytes inside a
  pipe-delimited message. Its two flags — `overwrite` and `createFolders` — are signed for the
  same reason `folder` is: each widens what the command may destroy or create. It answers
  `task:imported` with a **four-state** outcome (`created` / `replaced` / `exists` / `refused`),
  because `exists` is neither a success nor a failure and collapsing it lies both ways.
- **An accepted command ALWAYS answers, and a failure answer carries the reason.** The backend
  waits ~15s for a matching reply and then resolves with `Agent trigger timeout` — a message
  that names the *transport*. So an agent handler that returns without emitting doesn't produce
  "no result", it produces **a confident lie about a different subsystem**, pointing you at the
  socket while the real cause (a disabled task) is one click away. `task:run` did exactly this
  until 2026-07-15: it emitted only on success, and logged failures to a console nobody reads
  (the agent is launched hidden). ([#15](../../../docs/troubleshooting/README.md#15-run_task-times-out-instead-of-saying-the-task-is-disabled))
  - **The one deliberate silence** is a command that fails signature verification: a forger
    should learn nothing, and the server's timeout is the correct outcome there.
- **Every signed command carries a per-command `nonce`, inside the message, just before `ts`.**
  `ts` is only second-granular, so without it two identical commands in one second were
  byte-identical — indistinguishable from a replay, and the guard dropped the second silently
  (fixed 2026-07-15; [#16](../../../docs/troubleshooting/README.md#16-a-second-identical-agent-command-within-one-second-is-dropped)).
  It is **inside** the signature for the same reason `folder` and `trigger` are: an unsigned
  nonce could be rewritten in flight to turn a captured frame into a "fresh" command.
  - **Signed AND sent.** The agent rebuilds the message locally, so it needs the exact nonce.
    Signing one and forgetting to emit it makes every command unverifiable — and the rejection is
    silent, so it looks like the agent died.
  - The replay cache still keys on `(ts, sig)` and needed no change: the signature is now unique
    per instance, so it stops colliding on its own. The `*Message` helpers take the nonce as a
    **required** parameter — that's the enforcement that one always exists.
  - Anything else that signs commands (`agent/test-server/index.js`) must add it too.
  - **Corollary for debugging:** `Agent trigger timeout` has at least three causes — a stale
    agent with no handler ([#7](../../../docs/troubleshooting/README.md#7-new-agent-command-502-times-out-until-the-agent-is-republished)),
    a silent failure path (#15), and the replay guard (#16). It is the backend's *default*, not
    a diagnosis. **To see what the agent actually did, run `agent/publish/Cronsole.Agent.exe` in
    the foreground** — it replaces the hidden elevated instance in the backend's registry, so it
    handles your commands and you can read its console. Republish afterwards to restore.
- **Everything the agent acts on is inside the signature.** `task:create` signs the name,
  schedule, command, canonical action, canonical trigger, **and the destination folder** — an
  unsigned field on a signed command lets an on-path attacker redirect the write. The message
  strings in `agentAuth.ts` and `AgentAuthenticator.cs` must match **byte-for-byte**, and both
  suites pin the same golden HMAC vectors; change one side alone and every command is rejected.
- **The agent re-validates what it is told.** It holds the elevation and calls
  `RegisterTaskDefinition` (which **silently overwrites** a same-named task in the same
  folder), so `TaskFolderPath` duplicates the backend's folder rules on purpose. A signed
  command is proof of *origin*, not of *correctness*.
- **⚠️ The agent's socket serializer does NOT camelCase. Project every emit explicitly.**
  `EmitAsync("x", new[] { new { foo = obj } })` where `obj` is a C# class puts **PascalCase**
  keys on the wire (`Path`, `TaskCount`), and the backend reads `f.path` → `undefined` for
  every field. Nothing throws: you get a well-formed payload of empty values, which is a
  *confident lie*. Follow `task:full_list` — project into an anonymous type with explicit
  lowercase names (`path = f.Path`). **Mocked tests cannot catch this**: the agent's tests
  mock the scheduler and the backend's mock the socket, so neither crosses the real JSON
  boundary. Assert the **serialized** shape (see `TaskFolders_Event_EmitsCamelCaseKeys…`).
- **One agent socket per user** (single-user MVP). This is why a transient test agent strands
  the real one — see troubleshooting.

Server side lives in `backend/src/ws/`: `AgentManager.ts` (socket registry), `agentAuth.ts`
(pairing + HMAC), `uiChannel.ts` (pushes to the frontend).

### The sync state machine

```
Frontend "Sync Now"
  → POST /api/tasks/sync
    → server emits task:scan to the agent socket
      → agent scans Task Scheduler
        → agent replies agent:tasks:list
          → server upserts (TaskService.upsertTasks, batched)
            → server pushes tasks:updated to the frontend
              → TanStack Query invalidates → UI repaints
```

If any link breaks, the dashboard silently drifts from reality — which is the failure mode
this product exists to prevent. Test the **whole chain**, not the hops.

## API surface

Mounted in `backend/src/app.ts`. Everything except `/api/health` and `/api/auth/*` requires
`Authorization: Bearer <jwt>`.

```
app.get ('/api/health')                        // liveness, NO auth
app.use ('/api/auth',      authRoutes)         // NO auth
app.use ('/api/tasks',     authenticateToken, taskRoutes)
app.use ('/api/templates', authenticateToken, templateRoutes)
app.use ('/api/tools',     authenticateToken, toolsRoutes)   // cross-task: export/restore/history/health
```

| Method | Route | Notes |
|:---|:---|:---|
| `POST` | `/api/auth/setup` · `/api/auth/login` | Single-user local login: 24h access token, **no refresh flow**. `/setup` creates the one owner and 409s afterwards. **There is no `/register`** — it was removed 2026-07-31; account creation is `/setup` only. |
| `GET` | `/api/tasks` | List (flattened last-run summary for the dashboard) |
| `GET` | `/api/tasks/health` | Per-platform health; **auto-creates** a Windows connection if none exists |
| `POST` | `/api/tasks/sync` | Kick the scan chain above |
| `POST` | `/api/tasks/:id/run` · `/api/tasks/native` | Run Now; create a native task |
| `PATCH` | `/api/tasks/:id` · `/:id/status` · `/:id/schedule` · `/:id/actions` | Edit |
| `GET` | `/api/tasks/:id/export[?format=]` · `/:id/executions` | **Two formats.** `native` (default): Windows → XML (UTF-16 LE + BOM), native → JSON. `format=template` → a Registry v1 template from `buildTemplateFromTask`, built from the DB row, so it works with the **agent offline** and for a **Claude routine** (from `metadata.prompt`, since a routine's command is its prompt). Writes nothing — unlike save-as-template. |
| `DELETE` | `/api/tasks/:id` · `/:id/native` | DB row only goes **after** platform confirms. Both archive the definition first (`archiveTaskBeforeDelete`) and **refuse the delete if the archive write fails**; `/native` is the MCP path and 400s every platform but `TASKHUB_NATIVE`. |
| `POST` | `/api/tasks/import` | A `cronsoleTaskVersion` bundle → a **new** native task. Refuses other platforms by name. |
| `GET`/`POST` | `/api/tools/task-archives[/:id]` · `/:id/restore` | Read a deleted task's archived definition; rebuild it as a **new** task (history not reattached, archive kept) |
| `GET` | `/api/tools/platforms` | The capability matrix. Health is derived per request from `connector.getHealth` — **never read back from `PlatformConnection.healthState`**, whose only writer is the poll in `GET /api/tasks/health` ([#66](../../../docs/troubleshooting/README.md#66-two-cronsole-surfaces-disagree-about-the-agent-in-the-same-second)) |
| `POST` | `/api/tasks/:id/save-as-template` | → a real `Template` (`managed: false`). Same `buildTemplateFromTask` as `export?format=template`; the difference is only the side effect. |
| `GET` | `/api/templates` · `/templates/discover` | Catalog |
| `POST` | `/api/templates/:id/preview` · `/:id/apply` | See shapes below |
| `POST`/`DELETE` | `/api/templates/:id/favorite` | Per-user |
| `GET`/`POST` | `/api/templates/export` · `/templates/import` | Grow the catalog without a reseed |

### Request shapes worth pinning down

Easy to get wrong. `platform` is **required** on both; the name field is **`name`**, not
`taskName`.

```jsonc
// POST /api/templates/:id/apply
{
  "platform": "WINDOWS_TASK_SCHEDULER",  // required; ALSO arms the duplicate-name guard
  "name": "my-task",                     // optional — defaults to the template's name
  "schedule": "0 3 * * *",               // 5-field cron UTC (or "scheduleExpression")
  "parameters": { }                      // raw values — the SERVER substitutes {{placeholders}}
  // "command": DEPRECATED (pre-substituted string, legacy clients only)
}
```

```jsonc
// POST /api/templates/:id/preview  →  { score, warnings[], trigger }
{ "platform": "WINDOWS_TASK_SCHEDULER", "schedule": "0 3 * * *" }
```

**`preview` scores the schedule→trigger conversion — it does not compile a command.** It
returns `score` = `min(template confidence, conversion confidence)`, deduped `warnings`, and
the resolved `trigger`. An **unparseable cron is a score-0 result with a warning, not a
`400`** — the modal wants to show the user the problem, not throw at them. That's the honesty
principle expressed as an API contract.

**The Windows duplicate-name guard** (`assertWindowsTaskNameAvailable`) returns **409** when a
name collides with a task Cronsole already tracks under `\Cronsole\`. Without it,
`RegisterTaskDefinition` **silently overwrites** — the user loses a task and is never told.
That's data loss, not a UX nit.

## Auth

**A single 24h JWT access token — there is no refresh flow and no rotation** (OAuth2
post-MVP). Expiry means logging in again. *(This line read "JWT access + refresh" until
2026-07-31, contradicting the route table above it in this same file — the same false claim
that stood in CLAUDE.md and in two testing docs. An aspiration written in the present tense
propagates across every surface that copies it.)* `/auth/login` and `/auth/setup` are both
rate-limited per IP (**10 / 15 min** → `429`). Users get JWTs; **agents** get a
pairing-secret-derived token. WSS only in prod. Multi-tenancy is enforced by route scoping —
every route must scope by `userId`, and **every new route is a fresh chance to leak**. The
IDOR integration sweep exists for exactly this; add new routes to it in the same PR.

Secrets: `.env.local` for dev; never in code. `docker-compose.yml` bakes **dev-only defaults**
so `docker compose up` works out of the box — which is precisely what causes the 403 trap when
you rotate `backend/.env` and forget the root `.env`.

## Frontend

- `Dashboard.tsx` is the shell (routing + mutations + top-level modals) — kept thin (~248
  lines) after the 1,830-line split.
- `screens/` — DashboardScreen / TemplatesScreen / PlatformsScreen.
- `components/ui/` — the `Modal` primitive (Escape, focus trap, ARIA, nested-modal stack).
- `hooks/` — `useSettings`, `useToast`, `useConfirm` (promise-based), `useLiveTaskUpdates`.
- **TanStack Query for all server state.** Invalidate on WebSocket `task:updated`.
- Dark by default; `darkMode: 'class'`; persisted at **`localStorage['cronsole.theme']`**
  (`taskhub.theme` is still *read* as a legacy fallback, assembled from parts on purpose so a
  future rename pass can't rewrite it into a no-op that still reads correctly).
- **The brand is one contiguous string wherever it renders.** Splitting it (`Task<span>Hub</span>`)
  is how the login screen kept the old name through the whole rename — invisible to grep.
- **Mobile is first-class** — every page must pass a `<375px` viewport check. The FR is
  "trigger from phone in <30 seconds."
