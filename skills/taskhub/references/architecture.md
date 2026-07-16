# Architecture

Load when touching the data model, connectors, the agent protocol, or the API surface.

> Verify against source before relying on a shape here — `backend/prisma/schema.prisma` and
> `backend/src/routes/` are the truth. This file is the map, not the territory.

## The processes

| Piece | Runs as | Port | Notes |
|:---|:---|:--|:---|
| **Frontend** | Vite dev server (host) | `5173` | React 19 + TS + Tailwind + TanStack Query + React Router |
| **Backend** | Node/Express 5 (Docker or host) | `3000` | TypeScript, Socket.io, Prisma |
| **Postgres** | Docker | `5432` | v16 |
| **Redis** | Docker | — | Optional for MVP; required for multi-instance WebSocket |
| **Agent** | Host `.exe` (**never** Docker) | — | .NET 10 + `Microsoft.Win32.TaskScheduler`; needs COM access |
| **MCP server** | On-demand, **launched by your AI host** (stdio) | — | `mcp-server/dist/index.js`; a REST client with a bearer token. Not part of `taskhub.ps1`; the host starts and stops it |

Control the whole stack with `pwsh scripts/taskhub.ps1 <up|down|restart|status|logs>`
(`down -All` also stops the Docker db/redis). It exists so you stop wondering which part is
down.

## Data model

Prisma models, **no `@@map`** — so SQL needs quoted PascalCase: `SELECT * FROM "Task";`

| Model | Key fields | Constraints |
|:---|:---|:---|
| `User` | email, password (hashed) | — |
| `PlatformConnection` | platform, **config (encrypted)**, isActive, healthState | `@@unique([userId, platform])` |
| `Task` | platform, **externalId**, name, category, schedule (5-field cron **UTC**), nextRunTime, status, quickLink, metadata | `@@unique([platform, externalId])`; indexed on `[userId, platform]`, `nextRunTime`, `category` |
| `ExecutionLog` | per-run status/time/output | — |
| `Template` | see below | indexed on `[isPublic, upvotes]`, `[isStarter, os]` |
| `TemplateFavorite` | userId, templateId | `@@unique([userId, templateId])` |

**`Task.externalId`** is the platform's native id — a Windows task path, a Claude routine id.
That's what makes `(platform, externalId)` a meaningful uniqueness key.

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

Only **Windows** and **TaskHub-native** have real compilers today. A declared-but-uncompiled
`compatibleTargets` entry is the honest "copy to set up manually" path — **never** a silent
failure.

## Connector pattern

Every integration implements `PlatformConnector` (`backend/src/connectors/platform.interface.ts`)
and registers in `backend/src/connectors/registry.ts`. **No platform-specific logic lives
outside this layer.**

Implementations: `WindowsAgentConnector`, `TaskHubNativeConnector`, `ClaudeConnector`.

### Capability is encoded in the type system

This is the pattern worth understanding. **Required** methods every connector must have:

```ts
runTask(externalId, config): Promise<{ success, platformRunId?, message? }>
getHealth(config): Promise<ConnectorHealth>
createTask(name, schedule, command, config, options?): Promise<{ success, externalId?, message? }>
```

**Optional** methods (note the `?`) — a connector only declares what it can honestly do:

```ts
updateSchedule?(externalId, trigger, config)
updateActions?(externalId, input, config)
deleteTask?(externalId, config)
exportTask?(externalId, config): Promise<{ success, xml?, message? }>
```

A connector that can't delete **doesn't implement `deleteTask`** — so the route can tell the
user honestly instead of pretending. Don't add a stub that returns `{ success: true }`; that
converts a missing capability into a lie. Leaving it undefined *is* the design.

## Agent ↔ Server protocol

- **The agent always initiates.** Outbound from the user's machine. The server never connects
  in. The agent is a client — **no `0.0.0.0` binds.**
- **Envelope:** `{ type: string, payload: object }`. Types are `noun:verb` — `task:run`,
  `agent:hello`, `task:scan`, `agent:tasks:list`, `task:create`, `task:delete`, `task:export`,
  `task:folders`.
- **Heartbeat:** ping every 30s. Reconnect with exponential backoff, **1s → 5min cap**.
- **Run commands are HMAC-signed** per session to prevent replay. Read-only commands (e.g.
  `task:export`, `task:folders`) aren't signed — but still need the agent republished for the
  handler to exist.
- **An accepted command ALWAYS answers, and a failure answer carries the reason.** The backend
  waits ~15s for a matching reply and then resolves with `Agent trigger timeout` — a message
  that names the *transport*. So an agent handler that returns without emitting doesn't produce
  "no result", it produces **a confident lie about a different subsystem**, pointing you at the
  socket while the real cause (a disabled task) is one click away. `task:run` did exactly this
  until 2026-07-15: it emitted only on success, and logged failures to a console nobody reads
  (the agent is launched hidden). ([#15](../../docs/troubleshooting/README.md#15-run_task-times-out-instead-of-saying-the-task-is-disabled))
  - **The one deliberate silence** is a command that fails signature verification: a forger
    should learn nothing, and the server's timeout is the correct outcome there.
- **Every signed command carries a per-command `nonce`, inside the message, just before `ts`.**
  `ts` is only second-granular, so without it two identical commands in one second were
  byte-identical — indistinguishable from a replay, and the guard dropped the second silently
  (fixed 2026-07-15; [#16](../../docs/troubleshooting/README.md#16-a-second-identical-agent-command-within-one-second-is-dropped)).
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
    agent with no handler ([#7](../../docs/troubleshooting/README.md#7-new-agent-command-502-times-out-until-the-agent-is-republished)),
    a silent failure path (#15), and the replay guard (#16). It is the backend's *default*, not
    a diagnosis. **To see what the agent actually did, run `agent/publish/TaskHub.Agent.exe` in
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
```

| Method | Route | Notes |
|:---|:---|:---|
| `POST` | `/api/auth/register` · `/api/auth/login` | JWT access + refresh; rotation supported |
| `GET` | `/api/tasks` | List (flattened last-run summary for the dashboard) |
| `GET` | `/api/tasks/health` | Per-platform health; **auto-creates** a Windows connection if none exists |
| `POST` | `/api/tasks/sync` | Kick the scan chain above |
| `POST` | `/api/tasks/:id/run` · `/api/tasks/native` | Run Now; create a native task |
| `PATCH` | `/api/tasks/:id` · `/:id/status` · `/:id/schedule` · `/:id/actions` | Edit |
| `GET` | `/api/tasks/:id/export` · `/:id/executions` | Windows → XML (UTF-16 LE + BOM), native → JSON |
| `DELETE` | `/api/tasks/:id` | DB row only goes **after** platform confirms |
| `POST` | `/api/tasks/:id/save-as-template` | → a real `Template` (`managed: false`) |
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
name collides with a task TaskHub already tracks under `\TaskHub\`. Without it,
`RegisterTaskDefinition` **silently overwrites** — the user loses a task and is never told.
That's data loss, not a UX nit.

## Auth

JWT access + refresh (OAuth2 post-MVP). Users get JWTs; **agents** get a
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
- Dark by default; `darkMode: 'class'`; persisted at `localStorage['taskhub.theme']`.
- **Mobile is first-class** — every page must pass a `<375px` viewport check. The FR is
  "trigger from phone in <30 seconds."
