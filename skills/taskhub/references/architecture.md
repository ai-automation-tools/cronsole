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
  `agent:hello`, `task:scan`, `agent:tasks:list`, `task:create`, `task:delete`, `task:export`.
- **Heartbeat:** ping every 30s. Reconnect with exponential backoff, **1s → 5min cap**.
- **Run commands are HMAC-signed** per session to prevent replay. Read-only commands (e.g.
  `task:export`) aren't signed — but still need the agent republished for the handler to exist.
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
