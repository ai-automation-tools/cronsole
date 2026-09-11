# Cronsole

> Project instructions for **Cronsole** — a single pane of glass for scheduled tasks across Windows
> Task Scheduler, Cronsole-native jobs, and Claude Code routines. Overrides any parent-workspace
> or user-scope `CLAUDE.md` where they conflict.

**Repo:** [`github.com/ai-automation-tools/cronsole`](https://github.com/ai-automation-tools/cronsole) ·
**Working branch:** `mike_desktop` · **Deploy branch:** `main`
**Local path:** wherever you cloned it — **move it only via
[`scripts/startup-task/Migrate-RepoFolder.ps1`](scripts/startup-task/Migrate-RepoFolder.ps1)**. Three
things hold it by absolute path (the `\Cronsole-Stack\` launcher tasks, the published agent, the
`.claude\skills\cronsole` junction) and all three fail *silently* when it moves by hand.
**Hosting:** local-first by design — no hosted instance. Remote access to your own instance is an
optional P3 item ([Remote Access Guide](docs/user-guides/guides/Remote_Access_Guide.md)).

**Where things live**

| For… | Read |
|---|---|
| The plan — shipped, open, prioritized P0→P3 | [`docs/ROADMAP.md`](docs/ROADMAP.md) |
| **Why** any invariant below exists — the full arguments, failures and wrong turns | [`docs/DESIGN_NOTES.md`](docs/DESIGN_NOTES.md) |
| Symptom → cause → fix for things we've hit | [`docs/troubleshooting/README.md`](docs/troubleshooting/README.md) |
| User-visible change log | [`docs/CHANGELOG.md`](docs/CHANGELOG.md) |
| Working on the codebase as an agent | the `cronsole` skill → [`skills/cronsole/`](skills/README.md) |

> Counts (templates, packs, tasks, MCP tools) go stale on every change. Read `registry/index.json`
> and `mcp-server/src/tools.ts` rather than trusting a number written in prose.

> **The section numbers below are deliberately non-contiguous.** Docs, the skill, the troubleshooting
> log and `/sync-surfaces` cite **§8a**, **§9**, **§10** and **§11a** by number, so those numbers were
> kept when this file was condensed. Gaps are the removed sections, not a mistake.

---

## 2. Status

Phases 0–6 are complete and archived; work is roadmap-driven. **P0 security** and **P1 correctness**
are complete; **P2 product value** is rolling and **P3 expansion** is underway (MCP server, remote
access, registry). Functional MVP: real-time agent↔backend sync, selective import, a two-tier hosted
template catalog with an Apply modal, and a shipped MCP server.

**Platforms:** Windows Task Scheduler (functional) · Cronsole-native jobs (functional) · Claude Code
routines (two modes — see Connectors) · Gemini API Triggers (the **first hosted controller**;
`v1beta` preview) · GitHub Actions and Vercel Cron (**read-only observers**) ·
ChatGPT / Grok / Jules / Open Claw / Hermes = quick links only.

---

## 3. Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript + Vite + Tailwind (dark default) |
| Server state | TanStack Query |
| Backend | Node.js + Express (TypeScript) |
| Database | PostgreSQL 16 + Prisma |
| Real-time | Socket.io server + WebSocket client in the agent |
| Windows agent | .NET 10 (C#) + `Microsoft.Win32.TaskScheduler` |
| Auth | JWT in two kinds: a 24h **browser session** (no refresh, no `jti`, not individually revocable) and a named, revocable **API token** (`ApiToken`, `/api/auth/tokens`, 30/60/90 days or never). `checkToken` is one definition shared by REST middleware and the Socket.IO handshake, fails closed on DB error, and **resolves the identity from the `User` row rather than from the claims**. |
| Hosting | Docker Compose (dev). **No prod hosting — local-first.** Secrets live in the user's own `.env`. |
| MCP server | Node.js stdio wrapper over the REST API (`mcp-server/`) |

> Pin base images; never `:latest`.

---

## 4. Repo layout

```
cronsole/
├── docs/            # ROADMAP · CHANGELOG · DESIGN_NOTES · troubleshooting · install/setup/
│                    #   user-guides/ · testing/ · adr/ · prompts/ · reports/
│                    #   archive/ + local/ are LOCAL-ONLY (gitignored, NOT backed up)
├── registry/        # generated template registry artifact — never hand-edit
├── registry-site/   # the one public gallery page (published to two hosts)
├── proxy/           # opt-in single-origin reverse proxy (Caddyfile); nothing runs by default
├── backend/src/     # catalog/ · connectors/ · routes/ · services/ · ws/ · auth/ · tools/
├── frontend/src/    # components/ (ui/ = Modal primitive) · screens/ · hooks/ · utils/ · data/
├── agent/           # Cronsole.Agent/ (flat) · Cronsole.Agent.Tests/ · test-server/ · publish/
├── mcp-server/src/  # index.ts · client.ts · tools.ts · __tests__/  (thin wrapper, owns no logic)
├── skills/cronsole/ # TRACKED source of truth for the skill — always edit HERE, never via the junction
└── docker-compose.yml
```

**Three things run stale** and cause most "impossible" behavior: the Dockerized backend, the
published agent (`agent/publish/`), and `mcp-server/dist/`. A fourth — `frontend/dist/` — only while
the `proxy` profile is running, and it is the one with **no keeper**: `cronsole up` starts the proxy
and never rebuilds it, so the proxied page can be a complete, working dashboard from another day
while `:7373` is current (`node scripts/check-dist-fresh.mjs`, which omits itself when the proxy is
down). **The fifth is the database schema**, and it is the one the repo cannot see at all: an
unapplied migration makes a whole feature 500 with a bare *"Internal server error"* on **every** route
including reads, while `schema.prisma`, the generated client and the whole test suite hold the new
value — only the DB does not, so nothing reddens
(`node scripts/check-migrations-applied.mjs`,
[#81](docs/troubleshooting/README.md#81-a-brand-new-source-returns-internal-server-error-the-moment-you-open-it)).
Run **`/doctor`** before debugging your own code.

---

## 8. Skills, subagents, MCP

**Start with the `cronsole` skill** for work anywhere in this repo — mental model, invariants, traps,
routing. It routes rather than duplicates: when the skill and a doc disagree, **the doc wins, fix the
skill**.

**Skills:** `code-reviewer` (every non-trivial PR) · `frontend-design` / `ui-design-system` /
`mobile-design` · `api-architect` · `senior-qa` · `security-review` ·
`web-performance-optimization` · `senior-devops` · `release-engineering` (installers, signing,
versioning, go-public) · `claude-api` / `agent-tool-builder` (MCP work) · `github-readme` ·
`update-docs`.
Only `cronsole`, `release-engineering`, and `api-architect` are in this repo. The rest moved to
**user scope** (`~/.claude/skills/`, `~/.claude/commands/`) on 2026-08-23 and are available in every
repo — don't re-add copies here.
Two more are an **overlay installed from outside** and may or may not be present on a given clone:
`cronsole-windows-jobs` and `cronsole-claude-routines`, in
[`ai-automation-tools/agent-skills` › `Skills/Projects/cronsole/`](https://github.com/ai-automation-tools/agent-skills/tree/main/Skills/Projects/cronsole).
They cover **designing the jobs Cronsole schedules** — which is not what the `cronsole` skill covers,
and not a place to move any of its content to. Don't vendor copies into `skills/`; that repo is
canonical and a second copy would drift silently.
**Commands:** **`/doctor`** (stale processes, agent connectivity, `CRONSOLE_TOKEN`) ·
**`/sync-surfaces`** (the §11a drift check, mechanized — run before committing anything non-trivial).

**Subagents:** `native-agent-engineer` (anything under `agent/`, incl. the coming launchd agent) ·
`template-curator` (catalog/registry) · `test-engineer` — these three are in this repo. The
general-purpose set — `api-designer` · `backend-designer` · `frontend-designer` ·
`frontend-developer` · `fullstack-developer` · `project-manager` · `technical-writer` — is at **user
scope** (`~/.claude/agents/`) since 2026-08-23. `Explore` and `Plan` are built in.

**MCP — two different surfaces share `.mcp.json`** (gitignored; seeded from `.mcp.json.example`):
- **Dev tooling** that helps you *build* Cronsole: `context7` (check library docs before writing
  code), `github`, `playwright`, `serper`, `notion`, `mermaid-chart`, `ide`, `windows`.
- **`cronsole`** — Cronsole's *own* server, which lets an agent *use* a running Cronsole. Needs a
  built `dist/`, a running backend, and `CRONSOLE_TOKEN` exported in the environment the host was
  launched from (Windows: a *fresh* terminal). Unset → the literal `${CRONSOLE_TOKEN}` is forwarded,
  the API 403s, and the server refuses to start, so the tools go *missing* rather than erroring
  ([#8](docs/troubleshooting/README.md#8-every-mcp-tool-returns-403-invalid-or-expired-token),
  [MCP Server Guide](docs/user-guides/guides/MCP_Server_Guide.md)).

MCP rules that don't change: **it owns no logic** — new behavior belongs in a backend route.
**Destructive-op gating is tiered** — only `delete_task` is gated (`CRONSOLE_MCP_ALLOW_DESTRUCTIVE`),
and when off it is *absent* from `tools/list`. Bulk verbs are omitted deliberately: friction must
scale with blast radius and MCP has no equivalent of the UI's typed confirmation. The tool suite
stubs the HTTP client, so it **cannot** prove the wrapper and the API still agree — hand-drive a tool
after changing a route it wraps.

### 8a. Project-local `.claude/`

Only `agents/`, `commands/`, and `skills/` are tracked — `.gitignore` denies `/.claude/*` and
re-includes those three, so per-machine noise (`settings.local.json`, `temp/`, IDE state) can never be
committed by accident. `.claude/skills/cronsole` is a per-machine **junction** to the tracked
[`skills/cronsole/`](skills/README.md), created by `scripts/setup-skill-links.ps1` (run once per fresh
clone). **Always edit `skills/cronsole/`, never through the link**, and give each linked skill a
`/.claude/skills/<name>/` line in `.gitignore` or git follows the junction and commits the content
twice. **A dangling junction is not an error, it is an absence** — Claude Code loads no skill and says
nothing.

---

## 9. Invariants

Non-negotiable rules. **Every one has a reason recorded in
[`docs/DESIGN_NOTES.md`](docs/DESIGN_NOTES.md) — read it before arguing with or removing one.**

### Schedules & data model
- **All schedules stored as 5-field cron in UTC.** That is the storage, API, signed-agent-command and
  MCP contract. Conversion happens at the browser's edge only (`utils/timezone.ts` +
  `useScheduleZone`), once on submit. A zone must never reach storage or an MCP tool; every shifted
  field prints the stored UTC beside it.
- **A schedule picker compiles to cron; it is never a second representation.** `ScheduleBuilder`
  + `utils/scheduleBuilder.ts` hold five shapes (minutes · hours · daily · weekly · monthly),
  emit only on interaction — the round trip is not byte-identical, so writing on mount would
  rewrite every task merely opened — and go **unavailable rather than approximate** for an
  expression they cannot hold. They judge no platform's fidelity; that is the server's.
- **A refusal to convert must state its reason.** Declining to answer and answering "no problem here"
  must never be the same code path ([#60](docs/troubleshooting/README.md#60-a-schedule-is-stored-78-hours-off-and-the-ui-says-the-timezone-doesnt-matter)).
- **A weekday can be rolled across the UTC boundary; a day of the month cannot.** The agent
  resolves a `Weekly` trigger's UTC day+time to the local day it really lands on, because a week is
  always seven days. A `Monthly` trigger names a *fixed day of the month*, and the same roll would
  mean the 31st in January, the 28th in March and the 30th in May — no single value is right, so
  `TriggerBuilder` **refuses a monthly boundary that changes the local calendar date** and
  `TriggerReader` returns `null` for one rather than reporting a day the task does not run on.
  The other two unreadable monthly shapes are the same rule: a **restricted month set** (cron's
  month field has no home in `WindowsTrigger`, deliberately — see `daysOfMonth`) and
  **run-on-last-day** (cron's `L`, refused at the other end of the converter). A specific month
  therefore still reaches the replaced-with-hourly fallback, and says so.
- `(platform, externalId)` is unique. `PlatformConnection.config` is AES-256-GCM encrypted at the
  application layer; never log decrypted values.
- **`name` and `category` are Cronsole labels** — sync overwrites neither, and a rename is DB-only, so
  the UI keeps the real `externalId` on screen once they diverge.
- **One gesture may fan out to several routes, but must then report per route.** Partial success is
  the normal case; a single verdict over a fan-out is a lie in one direction or the other.
- **On live-data screens, object identity is not entity identity** — key resets on the record's `id`
  ([#52](docs/troubleshooting/README.md#52-an-open-edit-modal-closes-by-itself-discarding-what-you-typed)).

### Removal, export & archives
- **No MCP verb may destroy an artifact on the machine.** `delete_task` wraps
  `DELETE /api/tasks/:id/native` and 400s every other platform; Windows removal over MCP is
  `untrack_task`. The check lives in the **backend route**, never the wrapper.
- **The pre-delete archive is a precondition, so it throws** and aborts the delete. It has no relation
  to `Task` and no cascade — it must outlive the row it describes.
- **Every artifact Cronsole writes needs a route that reads it.** Grep the format's version constant;
  if every hit writes it, the feature is half-built however green the suite is
  ([#65](docs/troubleshooting/README.md#65-an-exported-task-file-has-nowhere-to-go--and-restore-refuses-it)).
  Import and restore both create a **new** task, don't reattach history, and keep the archive.
- **Export has two formats and they never merge**: `native` (fidelity — Task Scheduler XML or the
  `cronsoleTaskVersion` bundle) and `template` (portability). It reaches no platform, so it records no
  capability.
- **Untrack 400s for `TASKHUB_NATIVE` and `CLAUDE_CODE`** — their rows *are* the task.
  Disconnecting a Claude routine removes its tracked tasks with the declaration.
- **`createNativeTask` is the one definition of writing a native row**, shared by create, import and
  restore.

### Connectors
- Every platform implements `PlatformConnector`; **no platform-specific logic outside that layer.**
- **"Cannot" and "has not yet" are different cells.** `unsupportedVerbs` (a boundary) outranks every
  reachability rule and makes refusals a `400`, not a `502`. `declared` is a promise, `verified` is
  evidence, `unsupported` is a boundary.
- **Hosted does not imply observer, and the first counter-example is the one that proves `access` is a
  declaration rather than a tally.** `GEMINI_TRIGGERS` is a *controller* over somebody else's HTTP API:
  every interface-mandated verb reaches a documented `v1beta` endpoint, so `unsupportedVerbs` is **empty**
  — the only connector where it is. Its `run` is the real scheduled invocation (the same agent, prompt and
  sandbox, on the platform's own execution list), which is exactly what GitHub's and Vercel's refused `run`
  is *not*, so the three together are the argument that a verb is judged by what it does rather than by
  whether an endpoint exists. `updateAction` is absent rather than declared unsupported: editing a
  trigger's prompt is *not yet*, not *cannot*. **`updateSchedule` is absent for the opposite reason,
  and it was found by driving the API rather than by reading it**: `PATCH …/{id}` is the documented
  update endpoint, it takes `status` and `display_name`, and it answers `400 Unknown parameter
  'schedule'` — no `PUT`, no field mask — so a trigger's *when* is fixed at create time on `v1beta`.
  An **optional** verb's boundary is stated by absence (GitHub's rule in reverse: it names only the
  *mandated* verbs it refuses), which is why the empty `unsupportedVerbs` above still holds.
  Declaring it bought exactly one thing: a `declared` cell that could only ever fail, handing Google's
  word `schedule` back to a user who never typed it. **And `interaction.input` is written as a string
  but read back as a structured array**, so reading only the write spelling dropped the prompt from
  every synced trigger — including one Cronsole had just created *with* that prompt
  ([#82](docs/troubleshooting/README.md#82-a-gemini-trigger-loses-its-prompt-on-the-first-sync-and-edit-schedule-fails-with-googles-word)).
  **The tracked set is declared and constant** (`['Gemini']`)
  because an API key is scoped to one Google Cloud project and sees a flat list — there is nothing to
  name, so `extractCategory` returns a constant for the reason Claude's does.
  **Its run evidence is read in the platform's own vocabulary, checked against the wire
  rather than the docs** — the executions array is `trigger_executions` (not `executions`, though the
  sibling `GET /triggers` really is `triggers`), the success word is `completed` (the docs say
  `succeeded`), and in-flight is `in_progress`. `isSuccessStatus` / `isPendingStatus` are one
  definition shared by the connector and `taskHealth`. The first bug hid the second — an always-empty
  list meant the wrong success word could never fire, so a partial fix would have flipped every
  healthy trigger to `critical`
  ([#83](docs/troubleshooting/README.md#83-a-gemini-trigger-runs-fine-cronsole-shows-no-run-history--then-calls-a-good-run-a-failure)).
  It **reports run outcomes**,
  so it gets a real `scoreTask` arm plus one signal no observer can produce: a trigger the *platform*
  paused after `max_consecutive_failures`, which is GitHub's silent auto-disable with the count published.
  And it is the one platform that **stores a zone itself** — `{ schedule, time_zone }` against a 5-field
  UTC contract — so `utils/cron.ts`'s `shiftCronToUtc` is the single server-side conversion in the repo:
  everything Cronsole writes is `UTC` (exact round trip), everything it reads is normalized with the
  platform's original pair kept in metadata, and an expression with no honest UTC equivalent is `null`
  **with its reason**, never a guessed cron.
- **A read-only observer is a finished connector, and its boundary is fixed rather than derived.**
  **Two of them ship** — GitHub Actions and Vercel Cron — and both refuse the same three verbs by
  different routes, which is the point: the boundary is a property of the *connector's design*, not
  a count of unbuilt cells. Vercel's `run` is refused although a cron path is an ordinary HTTP
  endpoint (calling it bypasses `CRON_SECRET` and is **not the scheduled invocation**), and its
  `setStatus` because Vercel has no per-cron switch at all — crons are enabled per **project**.
  GitHub Actions reads scheduled workflows and changes nothing; `run` / `create` / `setStatus`
  are named in `unsupportedVerbs` as a **constant, not a getter** — Claude's answer changes with
  the install, this one is a property of the connector's design, and two of the three are
  refused *despite* having APIs (a `workflow_dispatch` run is not the scheduled run; enabling a
  workflow is a repository-state change). The optional verbs stay unsupported by **absence**, so
  each boundary is stated once. A sync where *every* source failed **throws** rather than
  returning `[]`, or `reconcileMissingTasks` reads one revoked scope as a mass deletion; a
  partial failure returns what it has. And a schedule it could not *read* is `null` **with a
  reason**, never an assumed cron. **Which of the two a connector is, is declared** — a
  `PlatformDescriptor.access` of `controller` or `observer`, served on the matrix and read by the
  Sources tab and `list_platforms`. Counting the cells instead would make a finished read-only
  connector indistinguishable from one whose write verbs are merely unbuilt, which is the whole
  thing the field exists to say.
- **Which sources a user sees is a union of three facts, and only one is a preference**
  (`utils/sourceVisibility.ts`, one definition for the rail and the Sources tab). Shown = asked
  for in `settings.shownSources`, **or** holds tasks, **or** has a connection — so opting in is
  additive, connecting never needs a second gesture, and **a source holding tasks can never be
  hidden**. It is a *show* list rather than a hide list for the same reason: a platform added to
  Cronsole later is absent from every existing list, so it arrives opt-in without a migration.
  A fresh install shows Windows and Cronsole-native; the rest are added from **Explore sources**,
  and that route existing is what makes hiding safe rather than indistinguishable from missing.
  **`shown` and `configured` are two facts, and the Sources tab renders both on different
  controls** — its three views (`?focus=connected|available|links`, one definition in
  `SourcesScreen`) split on `configured`; the eye switch on each card is the only thing that reads
  `shown`. Collapsing them is the tempting simplification and it destroys the union rule: adding a
  source would have to connect it. So *Available* holds two groups — added-but-unconnected first,
  because that is the state with something to do — and **an unconnected source states what would
  connect it** (`sourceSetupHint`): a panel to open, or a sentence and no button where nothing you
  could type would help. `?focus=yours` stays a legal alias; a stale link landing on the wrong view
  is indistinguishable from a broken one.
- **A refresh and an import are two requests, and must stay two.** `POST /tasks/sync`
  `{ categories }` **clears the untrack exclusions** inside those folders — naming a folder is the
  gesture that started tracking it — while `{ scope: 'tracked' }` must never clear one, or a
  routine refresh silently undoes a deliberate removal. A refresh still *creates rows* for new
  tasks inside folders already tracked; what it cannot do is adopt a new folder.
  **A refresh's include-set is the platform's own record of what you asked for, which is not always
  the rows.** `TaskService.trackedCategories` reads stored rows because that is how a Windows folder
  becomes tracked — you pick it in the discovery modal and the rows are the only trace. A connector
  whose tracked set is *declared* implements `PlatformConnector.trackedCategories(config)` instead
  (GitHub Actions: the watched repositories). Deriving from rows made *adding a repository* unable to
  adopt anything — no rows, empty include-set, every workflow filtered out, **Sync reporting success
  over nothing** with no second gesture to reach for, because the discovery modal talks to the agent
  ([#75](docs/troubleshooting/README.md#75-a-github-repository-is-watched-sync-succeeds-and-no-workflows-ever-arrive)).
  It changes only which categories are *included*; it must never clear an exclusion.
- **A sync reports what it *looked at*, not only what it kept.** `SyncOutcome` carries `notes`
  (coverage — success information, so it obeys `toastOnSuccess`), `warnings` (what it could not do
  while still returning what it had — never suppressible, the untracked sentence's rule) and
  `partial`. Returning a bare `TaskInfo[]` stays legal for a connector with nothing to add. The
  reason is that **"found nothing" and "looked at nothing" render identically**: a repository whose
  workflows are all push-triggered imports zero tasks and is working perfectly, which is the same
  empty screen as a broken sync — and that ambiguity hid a real defect until the DB was read by hand.
- **`partial` means add and refresh, but retire nothing** — the #74 rule generalized off the agent.
  A truncated listing or one unreadable repository is a *narrowed reader*, not an emptier platform,
  so `reconcileMissingTasks` is skipped for that pass. The 50%-retention guard does not cover it:
  100 of 140 looks plausible, which is what makes a partial view worse than an empty one.
- **A platform that reports no run outcomes says `unknown` in its own terms, permanently.**
  `metadata.reportsRunResult` is present-and-false, never absent, and `scoreTask` dispatches on
  platform with **no fallback arm** — the Windows branch used to be the `else`, so every other
  source read an absent Windows snapshot and was told to *"republish the agent"*, advice about a
  component it does not have. Vercel is the permanent case: it publishes no cron run history, so
  scoring `enabledAt` would report every configured cron healthy. **`configured` and `working` are
  different claims**, and only the first is knowable there.
- **Health reports evidence, never preconditions**, and never has a side effect (Claude's documented
  routines endpoint *fires* the routine). `UNKNOWN` is the absence of a verdict and must rank above
  healthy in any summary; failure evidence ages out (15 min), connection evidence renews itself.
  `lastSync` has exactly one writer. **A surface derives health from `connector.getHealth` when
  asked; it never reads back a cached column** — `PlatformConnection.healthState` is written only by
  the dashboard's poll, so the matrix served a stale `OFFLINE` to every MCP session
  ([#40](docs/troubleshooting/README.md#40-the-sidebar-says-windows-is-online-and-synced-just-now-while-every-agent-request-times-out),
  [#42](docs/troubleshooting/README.md#42-the-dashboard-says-synced-7m-ago-over-a-task-list-from-yesterday),
  [#48](docs/troubleshooting/README.md#48-windows-sits-at-degraded-for-hours-while-the-agent-is-perfectly-healthy),
  [#62](docs/troubleshooting/README.md#62-windows-reports-not-responding-15-seconds-after-every-successful-request),
  [#66](docs/troubleshooting/README.md#66-two-cronsole-surfaces-disagree-about-the-agent-in-the-same-second)).
- **Claude has two doors and keeps both**: the documented per-routine fire token (declared registry
  mode) and the undocumented OAuth `/v1/code/triggers` API (full read/write). `unsupportedVerbs` is
  therefore a **getter** — any test asserting Claude's capabilities must mock the credential. Delete
  is impossible on both, verified by enumeration.
- **The account credential is read at call time, never stored, never refreshed.** A task manager may
  not invalidate the login of the tool that created it.
- **A native `EXEC` child gets an allowlist (`childEnv()`), never `process.env`** — this process holds
  the key encrypting every stored platform credential. Tasks state their execution host
  (`services/runtimeContext.ts`): a native job runs where the *backend* runs.
- **Four native job types** — HTTP · EXEC (Programs) · SCRIPT · CHECK ([ADR 0002](docs/adr/0002-native-job-types.md)).
  A type is a permanent rail row, so the test is "a different *kind* of thing", not "useful".
  `SCRIPT` carries its body and uses a fixed interpreter allowlist; `CHECK` is the only type whose
  failure is a fact about the system rather than a bug in your script.
- **A native job stores a *reference* to a credential, never the credential**
  ([ADR 0003](docs/adr/0003-per-job-secrets.md)). `${secret.NAME}` in a url · header value · body ·
  arg · env value — refused in an `executable`, an `interpreter` or a check assertion, by name. The
  value lives AES-256-GCM encrypted in **`TaskSecret`**, a **relation and never a `Task` column**:
  Prisma returns every scalar by default, so a column rides into every task read, export and archive
  unless all of them remember to exclude it. **No route returns a value** — the absence of a read
  path, not a filter. `executeJob` both substitutes and redacts the value back out of the log, at
  the one point every job type funnels through, for the reason `ran` is stamped there. Secrets are
  not in `metadata.job` (a job edit *replaces* it), not in the export or the archive (both outlive
  the moment), and **cascade away with the task** — the opposite of `TaskExclusion`. A
  referenced-but-unset secret is a **run-time** refusal (`ran: false`), never a create-time one:
  import, restore and template-apply all legitimately produce one, so every write reports
  `missingSecrets`. Save-as-template refuses a secret-bearing job outright.
- **A dispatch timeout is not a failed dispatch — answer it with evidence.** Gemini's
  `POST /executions` holds the connection while the agent works, past every sane client timeout, so
  a manual run of a healthy task was reported *"Run now failed"*, written to `ExecutionLog` as a
  FAILURE and put on the dashboard banner while the platform's own history showed it completing.
  Raising the timeout is the wrong fix (the ceiling is the agent's whole runtime); on a **transport**
  timeout only, re-read the platform and look for a run started since the request. The check must be
  able to say no, or it is just a way of never reporting a failure.
- **`runTask` returns `ran` alongside `success`.** A job that ran and failed is a `200` with
  `success: false`; only "could not start" is a `502`
  ([#59](docs/troubleshooting/README.md#59-a-check-that-correctly-finds-a-problem-is-reported-as-could-not-run-the-check)).
  `ran` is stamped once, in `executeJob`. **And every reader of that result asks `ran`, not
  `success`** — the `run` capability cell means *"Cronsole can trigger a run here"*, so a check
  that correctly fails is the verb **working** (`runVerbSucceeded`, one definition). Recording it
  as a failure marked a healthy platform broken on the Sources tab and blamed it for a fact about
  the user's disk — #59's shape one layer up, in a line whose own comment stated the right rule
  ([#77](docs/troubleshooting/README.md#77-the-sources-tab-says-a-verb-failed-and-names-your-own-broken-file)).
- **`createTask` returns `refusedBeforeCalling` — the same split, on the create path.** A create can
  fail because the *caller* asked for something impossible (an unknown tool type, a saved MCP server
  that does not exist, a missing prompt) or because the *platform* declined, and one status code
  cannot serve both: a `500` means **retry**, and retrying an identical bad request never helps. Set
  it on any refusal the connector reaches **without contacting the platform**; the route then answers
  `400` and the message names what to change. Absent means "we called out and it went wrong", which
  is the safe default for a connector that has not thought about it. Found by driving the new MCP
  create: *"No saved MCP server called X. Saved servers: resend."* — a message carrying its own fix —
  was arriving as a 500.
- **A connector's success message is the caller's answer, and the route may not overwrite it.**
  `describeGrant` states what a Gemini create actually granted (the tools, the domains, and that a
  supplied credential now lives on the platform), §9 requires that confirmation because **reach is
  the consequential half of creating an autonomous task** — and the route replaced it with
  `'Task created successfully'` for every caller, so it reached nobody. `result.message ||` default,
  not a constant. [#65](docs/troubleshooting/README.md#65-an-exported-task-file-has-nowhere-to-go--and-restore-refuses-it)'s
  shape: grep what you produce, and if every hit writes it, the feature is half-built.
- **`buildNativeJob` / `validateJob` have one definition**, shared by create, edit and the connector —
  a second definition is how an edit produces a spec creation would have refused.
- Prefer the connector that unlocks several sources (one POSIX agent → launchd + cron + systemd) over
  one that unlocks a single cloud scheduler. An **observer** (read-only) connector is a finished
  state, not a stalled one.

### Agent ↔ server protocol
- The agent **always initiates** the WebSocket; the server never connects in. No `0.0.0.0` binds — it
  is a client.
- Envelope `{ type, payload }`, `noun:verb` types. Ping 30s, reconnect 1s → 5min backoff.
- Run commands are **HMAC-signed per session**. Anything that widens blast radius rides *inside* the
  signature (`folder`, `overwrite`, `createFolders`, and the restore XML's sha256).
- **The agent gets no file-write verb** — it is elevated and local, so that would be a general
  arbitrary-file-write primitive reachable from the backend.
- **A retirement verb requires a reader that could have seen everything.** The agent's enumeration is
  bounded by its **token**, not by the machine: unelevated it cannot see `\Microsoft\Windows\TPM\`,
  `\UpdateOrchestrator\`, `\Pluton\` and a dozen more ACL'd folders — 86 of 371 tasks on a real machine.
  Every layer stayed honest and the product still asserted *"the platform no longer has this task"* for
  86 tasks that were running fine. **Connected, answering and elevated are three facts**, and `getHealth`
  only ever measured the first two. So an agent must report its integrity level, and `reconcileMissingTasks`
  may **add and refresh rows on a narrowed view but never retire one** — the 50%-retention guard does not
  cover this, because a systematically-blinded snapshot (285/374 = 76%) looks plausible, which is exactly
  what makes it worse than a catastrophically partial one
  ([#74](docs/troubleshooting/README.md#74-dozens-of-windows-tasks-go-missing-in-one-sync-and-the-agent-is-healthy)).
- **Cronsole creates only `\Cronsole`.** Two carve-outs (restore's `createFolders`, create's
  `createFolder`), both `false` by default, both signed, both naming every folder they created.
  `\Microsoft\` is refused in the backend *and* independently in the agent.
- **`\Cronsole-Stack\` is deliberately untracked** — it is the thing that runs Cronsole, not work
  Cronsole runs. Nothing enforces this; it is a standing choice.
- **A launcher task is not the process it launched, and exactly one script may own a task name.**
  Every `\Cronsole-Stack\` task runs `wscript.exe` → `run-hidden.vbs`, which is fire-and-forget, so
  the instance ends in under a second while what it started runs on unparented: `Stop-ScheduledTask`
  stops **nothing** and `LastTaskResult: 0` is a statement about the shim, never about the stack.
  Restarting is therefore a property of the *script* (`cronsole.ps1 restart`, on-demand elevated as
  `CronsoleRestart`), and **`up` may never be used as a restart** — it is idempotent by design, which
  is the same property that lets the 5-minute self-heal run at all. The name and description are
  **not** the definition: `CronsoleAgent` was registered by two different scripts with incompatible
  actions, `-Force` overwrote as documented, and for months the docs prescribed a bounce that
  returned success while changing nothing — **read a task's registered action**
  ([#86](docs/troubleshooting/README.md#86-stop-scheduledtask-on-a-launcher-task-reports-success-and-stops-nothing)).
  The corollary is that **every layer needs a keeper that runs as often as the failure can happen**:
  the Docker engine was started only at logon while the thing that ran every 5 minutes could merely
  warn it was down, so `up` now starts the engine itself.

### Frontend
- **Dark is the default; light is the toggle.** Theme persists at `cronsole.theme` (with `taskhub.*`
  read as a legacy fallback, assembled from parts so a rename pass can't neuter it).
- **Colour is a semantic role token in `index.css`, never a raw Tailwind palette utility**
  (`bg-amber-500` etc. are banned in `frontend/src`). Each role is a pair: `--x` (accent, used at low
  opacity) and `--x-text` (text on the page background — it must invert between themes while the
  accent must not). `-text` is not `-foreground`. A shared hue is not a shared role.
- **The palette is measured, not reviewed** (`__tests__/themeContrast.test.ts`, WCAG AA: 4.5 text,
  3.0 non-text). Colour is the one thing that breaks *silently* — a failing role renders perfectly
  — so every role is checked against **every surface it can land on**, not against the page. The
  2026-08-12 pass measured against white and left 26 pairs under the bar, because `muted` is the
  binding constraint and a status **dot** is non-text UI with no text beside it to rescue it.
  **Elevation steps away from the page background**, in whichever direction that theme's page
  sits: light cannot say "lifted" with "lighter" (the page is white), so it steps darker and
  keeps the order. Inverting it put `raised` at 1.04 — flatter than the card it sits above
  ([#78](docs/troubleshooting/README.md#78-the-light-theme-is-hard-to-read-and-every-value-looks-defensible)).
  `:root` must equal `.dark` exactly, or the default theme flashes a different palette before
  hydration on every cold load and nothing fails.
- TanStack Query for all server state; invalidate on `task:updated`. Mobile is first-class — every
  page passes a `<375px` viewport check.
- **Filter state is one `TaskFilters` object and lives in the URL** (`utils/taskFilters.ts`,
  `savedViews.ts`). A new drawer filter is a field on it, never a seventh `useState`. Built-in views
  are code, not `localStorage`. Tweaking a filter drops the UI to "Custom". **Because the slice *is* the
  URL, a route away from the dashboard must carry it and a route back must know where it came
  from** — `utils/taskRoute.ts` is the one definition of that round trip (query on the detail URL so
  it survives a reload; origin path in history state, validated as an in-app path).
- **The rail's filter field narrows *routes*, never the list, so it is presentation state and
  never a `TaskFilters` field** (`utils/railFilter.ts`, local `useState` in `SourceRail`). Putting
  it in the URL would make two links that show the same tasks — branch expansion's rule, one
  control over. It is also not persisted: a narrowed rail is something you are doing right now, and
  finding the sidebar still filtered tomorrow reads as a platform that has disappeared. The two
  **scopes are exempt from it** — *All sources* and *Favorites* mean "stop narrowing", and a query
  matching nothing must still leave a route back to everything. A node survives if it matches **or**
  a descendant does, and the two cases keep different children: a node that matched keeps all of
  its (so you can drill in), a node on the path to a hit keeps only the hits. It reports what it
  **searched** beside what it found, `SyncOutcome.notes`' rule in the UI. Two things it may
  **never** narrow: **a reorder still reports the whole band** — `orderBy` drops every record the
  reported list does not name, so reporting the filtered rows destroys the rest (five pins, a query
  matching two, one drag, three pins gone from a synced preference); and **a fold may not swallow a
  hit** — the three band folds are persisted, so a query must open them the way it opens a branch,
  or a shut band answers with a heading, a coverage note and nothing at all.
- **No rail list draws unbounded, and none truncates silently.** Every band and every folder list
  stops at `RAIL_ROW_CAP` and states the remainder (*Show 11 more folders*) — one definition in
  `capRows`, one over the cap left alone because *Show 1 more* costs a row to save a row. **A list
  of filter matches is never capped and a list a match dragged along with it always is**: capping
  the first hides the row you typed for, lifting the second turns one hit on `AI-Lab` into all
  eight of its subfolders (`FilteredRail.liftedLists`). **A disclosure is never capped either** —
  the `\Microsoft\` group sorts last and exists to say what is held back, so a plain cap would hide
  it first on the machines with most to disclose, and behind a fold is most of the way to fenced.
  *Show more* is one-way — the band's own fold already puts the whole thing away.
- **A declared list is chips; an observed tree is rows.** Collections and Pinned are flat, named and
  short, so they render as wrapping chips — but they stay **two bands with two headings and two
  independent folds**, because a pin is not a collection and the shape may not blur what the type
  split exists to state. A chip keeps everything its row carried: name, count, selected state, and
  the unpin control. The source tree stays rows because it nests and its counts scan as a column.
- **A rail row states its platform on the glyph, and only its identity** (`sourceAccentGlyph`, the
  same `PLATFORM_ACCENT` table the Sources cards read). The tile that used to carry identity in its
  *background* is gone, so the colour moved onto the icon; health stays a dot in its own gutter,
  because reading *which source* and *how it is doing* off one colour is what the two-token split
  exists to stop. **Health is not exception-only**: a platform with no connection already draws no
  dot, so suppressing the healthy one makes *connected and fine* and *not connected* the same
  absence — drawn, rejected, and pinned by a test.
- **The rail's own controls leave the scroll.** The collapse toggle, *Explore sources*, *Manage
  sources* and the help `?` live in a bar pinned to the bottom of the panel. They used to sit under
  the tree and fold with it, which put the only route to a platform you have **not** added off
  screen on any real machine — and that route existing is what makes an opt-in default set safe
  rather than indistinguishable from a missing platform.
- **The source rail is navigation, and navigation must not invalidate the slice.** Its dimensions
  (source, category, favorites, collection) are excluded from `filtersEqual` and `activeFilterCount`
  *by omission* — legal only because a rail selection is never hidden. Every node applies
  `RAIL_SCOPE_RESET`; every count neutralizes every rail dimension. The rail may show `0` (a route to
  an empty place is the point); a filter chip may not.
- **A collection's membership is declared; every other lens is derived.** Collections and favorites
  are per-user joins keyed on `Task` with a cascade — never columns. `TaskExclusion` is the opposite
  shape, keyed on `(platform, externalId)`, because it must outlive the row. **A pinned folder is
  therefore not a collection** — it is derived, so it is a `RailPin` preference (`utils/railPins.ts`)
  shown in its **own** rail band (Pinned, beside Collections — one `Band` component draws both),
  storing no foreign key, reading its target node's count rather than re-deriving one, and
  surviving its target's disappearance at `0`.
- **The rail reorders per band, and each band's order is written where that band's record already
  lives** — `railPins` for a pin, the new `sourceOrder` preference for a platform,
  `TaskCollection.position` for a collection. A fourth record holding *"the rail's order"* would be
  a second definition of the collection order the server already serves, free to disagree with it,
  and the disagreement would show only as a rail that reshuffles itself on reload. The rail reports
  the move and never the store: `onReorder(section, keys)` hands back **the whole band** in its new
  order, because a `(from, to)` pair applied to an empty `sourceOrder` would name two platforms and
  leave every other row unordered beneath them. A row may not cross bands (three bands, three kinds
  of record), sources stay alphabetical until dragged so a later-shipped platform lands at the
  bottom rather than reshuffling an arranged rail, and folders *inside* a source are never hand
  ordered — they come and go with the tasks. **Drag has a keyboard twin** (`Alt+↑/↓`, one step of
  the same move): the rail is navigation, and an order only a pointer can set is one a keyboard
  user does not have.
- **A preference follows the account; only a fact about the device stays in the browser.**
  `localStorage` is scoped to an *origin*, so the same install at `localhost:8080` and at a
  Tailscale name is two stores — collections and favorites crossed over (rows), pins and saved
  views did not, and both draw the same sidebar. The whole `cronsole.settings` blob now syncs
  through `UserPreference` (`routes/preferences.ts`, one opaque JSON row per user; the server
  stores it and never reads it, or the shape gets a second definition that drifts silently).
  **The client hydrates before it may ever push**, and a browser holding untouched defaults does
  not seed — otherwise opening the dashboard once on a phone flattens the desktop. Conflicts
  resolve by recency over the whole document, never field-by-field. Theme, the API-origin
  override and the session token stay per-browser *because they describe the device*, and theme
  additionally is read before login.
- **A calendar is a layout, not a second question, and the day an instant lands on is the
  reader's.** The Calendar view draws the same filtered slice every other view draws;
  `GET /api/tools/occurrences` (`services/occurrences.ts`) walks the stored UTC cron and takes **no
  timezone** — `utils/calendar.ts` buckets by day through the same `dayKeyIn` that decides *due
  today*, or the grid disagrees with the times on its own cards. Two refusals it may not make
  quietly: a task it **cannot** place (no cron, or a `metadata.scheduleReason`) is listed with its
  reason rather than omitted, because a silently missing task is indistinguishable from a deleted
  one; and the per-task walk stops at a cap and reports **where** it stopped, because a month whose
  second half is empty reads as *"it stopped running"*.
- **A count beside a control describes the population that control governs** —
  `applyTaskFiltersExcept`, with the hidden count derived, not counted separately.
- **A judgement has one definition and it is the server's** — `isSystem`, health tier, task source
  (`services/taskSource.ts`), creatability and **deletability** (`usePlatformCreatability` /
  `usePlatformDeletability` over one `verbSupport`, three answers incl. `unknown`). Re-deriving one
  in the browser is the [#20a](docs/troubleshooting/README.md) shape, and it cuts both ways: the
  Delete button's hardcoded `{native, Windows}` pair meant a connector that *could* delete had **no
  delete control**, so the only removal on screen left the task running on its platform. A
  capability-gated control reads `unknown` as *show it* — hiding a destructive button because a
  request has not landed is worse than one the route refuses with a sentence.
- **A status readout may not change its own geometry** (masking hides colour, not layout —
  [#43](docs/troubleshooting/README.md#43-a-visual-regression-baseline-fails-on-one-pixel-or-on-a-layout-that-moved-by-itself)).
- **In-app help summarises a doc and links to it**; `HelpTopic.doc` is required and every link is
  resolved to a real file *and* heading by `docsLinks.test.ts`.
- **When one word covers two actions, split the controls; ask only if they cannot split.** Either
  way the options are named by consequence, not by file extension. **Import** takes a *file*,
  **Sync** reads a *source* — the chooser that used to ask which you meant was the weaker form of
  the same rule.

### Tools tab, bulk & reporting
- **Cross-task routes live on `/api/tools`**, not `/api/tasks` (everything there competes with `/:id`).
- **A bulk operation reports per item, never per batch** — one definition in `services/bulkOutcome.ts`
  (`updated` / `unchanged` / `refused` / `failed` / `skipped`). The **halt** rule is separate and
  belongs only to agent-touching verbs; a per-task refusal must not halt.
- **Friction scales with blast radius**: past 25 tasks the confirmation costs a typed count, and the
  dialog states the scope in words. Row selection was removed from the dashboard — relocating a
  control is not a safety measure.
- **Restore plans before it writes**, from read-only agent verbs, so `dryRun` is a real preview. An
  offline agent is a `502`, never a blind restore. Restoring does not track.
- **Bulk untrack is one transaction** (a row removed without its exclusion returns on next sync) and
  needs no agent. Its label is "Remove from Cronsole", never "Remove".
- **Bulk export reads the machine, not the tracked subset**; `\Microsoft\` excluded by default but
  **counted out loud**; a selection names what it could not export (`requestedMissing`).
- **Task Scheduler XML is UTF-16 LE + BOM, always**, from one definition (`toTaskXmlBuffer`); it never
  crosses a JSON boundary as text. **CSV is UTF-8 + BOM and neutralizes formula injection** (`=`,
  `+`, `-`, `@`).
- **`ExecutionLog` records runs Cronsole *performed*, not runs that *happened*.** A Windows task
  firing on its own schedule writes nothing, and a manual Windows `SUCCESS` means "the agent accepted
  the start". Windows outcomes live in `lastTaskResult`. `runKind` is derived at read time, only on
  `/api/tools/history`.
- **A platform's own run history is a *live read*, never a second writer of `ExecutionLog`.**
  `PlatformConnector.listPlatformRuns` / `getRunOutput` (both optional, both `unsupported` by
  absence, `GET /api/tasks/:id/platform-runs[/:runId/output]`) exist because the rule above leaves a
  real hole: on a source that runs work by itself, the tab correctly said *"no recorded runs"* over a
  week of them. The two populations **render as two groups and are never summed** — folding one into
  the other would turn a table meaning "Cronsole did this" into one meaning nothing. Nothing is
  stored, so the platform half can fail alone and must say so rather than showing a short list as a
  complete one. **Output is fetched per opened run, never per list** (~90KB a transcript), and its
  refusals carry a reason: "still running", "produced nothing" and "aged out of the list" are three
  different facts. **The step list is part of the answer, not decoration** — an agent asked to email
  a report finishes `completed` having only called `write_file`, and no status can show that.
  `PlatformRunOutput` is `{ text, steps, facts, url }`: `facts` is free-form label/value pairs and is
  **printed, never parsed** (every source counts something different — tokens, jobs, an exit code — so
  a field per platform would make the shape a union of every vocabulary), and `url` is null wherever
  the platform has no page, which is the case on Gemini and Windows and precisely why the panel
  matters most there.
- **A credential Cronsole hands to a platform is stored deliberately or not at all, and the UI says
  which where it is typed.** Typed inline, an MCP server's `headers` reach `createTrigger` and no
  further: not `TaskSecret`, not metadata, not a log. **Saved as a preset, the value is stored** —
  AES-256-GCM inside `PlatformConnection.config`, beside the Gemini API key, which is the larger
  credential of the two and has been stored all along. The original rule said "used once and stored
  nowhere" and gave **lifecycle, not caution**, as the reason: the value is needed exactly once. Live
  use falsified that premise — it is needed once *per trigger*, again on every prompt edit (the
  definition is immutable, so editing is recreating), and again for every trigger using a rotated
  token, which had **no path at any price**: nothing on screen said which tasks used a given server.
  What survives unchanged is the half that was always right: **no route returns a stored value**
  (`redactPreset` is the only shape that leaves, reporting `hasHeaders` and never a hint — a header
  has no two-keys-to-tell-apart use the API key's four characters serve), and **a task stores a
  reference, never a value** — ADR 0003's `${secret.NAME}` rule one layer up, so every reader
  downstream (metadata, export, archive, log line, MCP response) is unchanged and none of them can
  leak what was never put there. `AgentToolInput` (has `headers` **and** `preset`) and
  `GeminiToolSummary` (can hold neither) stay two types for the original reason.
  **Resolution belongs to the connector** (§9's no-platform-logic-outside-that-layer), is **one
  definition shared by create and rotate** — a second copy is how a rotation sends what a create
  would have refused, and this one carries credentials — and a name with nothing behind it is
  **refused with the list**, never passed through as a credential-less server, which would fail later
  on a schedule as somebody else's 401. **A preset's URL is unique**, because a synced trigger reports
  `{type, name, url}` and nothing else: two presets on one URL make *"which triggers use this"*
  unanswerable and a rotation would rebuild the wrong one.
- **A platform whose task definition is immutable still needs an edit path, and it must say
  "recreate".** Gemini's `PATCH` takes `status` and `display_name`, so a rotated token — or a prompt
  needing one more sentence — would strand a trigger forever. `rotateCredentials` builds the
  replacement **first** (a failure leaves the original running), inherits a paused status (rotating a
  parked trigger must not resume it), and the route **rekeys the existing row** rather than deleting
  it — favourites, collections and run history hang off that row and a token rotation is not a
  request to lose them. A replacement that exists while the original survives is reported as a
  **failure**: the schedule now fires twice. **It carries `RecreateChanges` — a prompt, a schedule —
  because the machinery is identical whatever is being changed**, and restricting it to credentials
  left the ordinary case (iterating on a prompt) as a retype in Duplicate plus a manual delete.
  `updateAction` / `updateSchedule` stay `unsupported` anyway: they mean *change in place*, and this
  is a different act with a new platform id at the end of it — so the refusals on those two **name
  the recreate path** instead of reading as a dead end. **An omitted field is read back off the
  platform, never resent from the row**, or rotating a token silently reverts a prompt edited in the
  vendor's console; the row is then written from what the platform reports the replacement to be, not
  from the request. And an **inherited** schedule is converted through `shiftCronToUtc` on the way
  out, because the create writes `time_zone: UTC` unconditionally and echoing a real zone's
  expression back would move the trigger by the offset with nothing on screen to say so. **Rotating a preset
  fans that out** — every trigger referencing it is rebuilt, and per §9's fan-out rule the result
  **reports per task, never per batch**, because each one is an independent create-then-delete
  against somebody else's API. A trigger also carrying an *unsaved* MCP server is **skipped with its
  reason** rather than rebuilt: Cronsole never read that credential, so rebuilding would drop it.
- **A grant is refused with the list, never silently narrowed.** An unknown tool type is rejected
  before the call rather than dropped, because a create that quietly produces less reach than the form
  showed is worse than an error — and the same rule makes an empty `tools` array *absent* rather than
  `[]`, since the platform reads `tools` as a restriction of its defaults.
- **A credential is dropped at the parse, never filtered downstream.** A Gemini trigger's `tools` can
  carry an MCP server whose `headers` are bearer tokens, and an allowlist entry can carry header
  transforms that are the same thing by another name. `toToolSummary` / `readAllowlist` **never read
  those fields**, so no `GeminiTrigger` has ever held one — rather than parsing them and removing them
  later, which would leave every future reader (task metadata, an export, an archive, a log line, an
  MCP tool response) one forgotten `delete` from publishing somebody's token. `TaskSecret`'s rule
  pointed the other way: there no route *returns* a stored value, here no parse *produces* one.
  **What an agent can reach is shown; what lets it reach is not.**
- **Cronsole redacts what it *writes*; it never redacts what the platform already shows you.**
  `executeJob` strips `${secret.NAME}` values out of a native job's log at the one point every job
  type funnels through, because Cronsole **stores** that log. A platform's own log is different in
  the way that matters: it is the user's own output on a system they can already read, and it is
  **never stored here** — no row, no export, no archive, fetched per opened run and gone. Storage is
  what creates new exposure, so a live read needs no chokepoint; the day any of this is captured at
  sync time, it needs one first.
- **A verb the agent gained later must not report an old agent as unresponsive.** `agentRequest`
  takes `timeoutIsHealthEvidence`, false for optional reads added after a published build: silence
  from an agent that predates the verb means *"does not know this word"*, not *"not answering"*, and
  recording it would hold the whole platform at DEGRADED for 15 minutes because someone opened a tab
  — [#62](docs/troubleshooting/README.md#62-windows-reports-not-responding-15-seconds-after-every-successful-request)'s
  shape, manufactured by something that is not a health check. The refusal names the republish.
- **A platform that records history can be told not to.** Windows Task Scheduler's per-task history
  is a machine-wide switch, off by default on some installs, and a disabled log returns **zero events
  — identical to a task that has never run**. The agent reports `historyEnabled` as a third state
  (`true` / `false` / `null` = could not tell) so the two never render as one sentence, and the
  refusal says the setting is **not retroactive**: turning it on will not bring back the run the user
  came to read.
- **Absence of evidence is `unknown`, never `ok`**, and a claim never travels without its source.
  Disabled is not unhealthy. Never mix populations in one summary.
- **A preflight warns; it never refuses, and it says what it looked for.**
  `services/promptPreflight.ts` is the one definition (`POST /api/tools/prompt-preflight`, the form
  as you type; the same list on the create response, for a caller with no typing moment). Not one of
  its rules is certainly right — a prompt may legitimately hold a question mark — so **nothing gates
  a submit** and the panel says so, because a note a reader cannot dismiss by ignoring it is a note
  they stop reading. It returns `checked` beside `warnings` for the schedule-conversion reason: *"we
  looked and found nothing"* and *"nothing looked"* must not be the same response. It renders in
  **two** places, and `RecreateTriggerModal` is the more important — a Gemini definition is
  immutable, so every prompt edit after the first arrives there.
- **A diagnostic reports; it does not repair** — three of four agent-health incidents were the readout
  lying, so a "restart the agent" button would have restarted a working agent forever, and looked
  like it worked. A check may not fail its siblings; a check with nothing to measure is omitted, not
  rendered as a pass; a verdict another module owns is forwarded, never re-derived.

### Security
- **A `VITE_*` variable is public by construction, and clean source proves nothing** — Vite inlines it
  as a literal at build time. The guard reads the **build output**
  (`frontend/scripts/check-bundle-secrets.mjs`). Dev-only values must **fold** on
  `import.meta.env.DEV` so the branch and its string vanish from a build — a fold, not a convention.
- **Same-origin is the default for every build**, so one bundle is correct at every address it is
  served from; `setApiOrigin` refuses to store the sentinel
  ([#63](docs/troubleshooting/README.md#63-the-proxied-dashboard-loads-on-the-phone-but-cannot-reach-the-backend)).
- **Remote access is opt-in and single-origin**; the proxy binds loopback and Cloudflare Access is the
  gate. `TRUST_PROXY` stays off unless the proxy is the *only* route in — the test is "can the caller
  also reach `:3000`", so the same proxy yields opposite answers on Tunnel vs Tailscale.
  **An opt-in the self-healer cannot read is not an opt-in.** The opt-in is a per-machine, gitignored
  marker (`.cronsole-remote`, written by `cronsole remote on`) rather than an env var, because the
  reader is a Scheduled Task with a bare environment — and `cronsole up` starts the proxy from it, so
  the 5-minute self-heal covers it. `restart: unless-stopped` never undoes a deliberate stop and a
  profile gate blocks a plain `compose up`, so without this the proxy has **no keeper at all**
  ([#70](docs/troubleshooting/README.md#70-the-tailscale-url-is-dead-for-days-while-every-other-service-is-healthy)).
- **A tracked `.env*` file is an allowlist, not a habit.** `.gitignore` denies `.env*` and re-includes
  three `.env.example` files plus `frontend/.env.remote` — a build input (`vite build --mode remote`)
  holding one public routing value. The risk is not today's content but tomorrow's one-line diff to a
  file git has carried for months, which nothing would redden. `scripts/check-tracked-env.mjs`
  (CI `repo-hygiene`) refuses any unlisted tracked `.env*` path, **pins `.env.remote` to
  `VITE_API_URL=same-origin` and nothing else**, and scans every tracked env file for credentials.
  Credential patterns have **one definition** (`scripts/secret-patterns.mjs`), shared with the
  build-output guard — different populations, same fact.
- **A signature says who was *signed for*; only the row says who *exists*.** `checkToken` ends with a
  primary-key read of `User` and returns that row's id and email — `req.user` is never assembled from
  the claims. Without it a correctly-signed token for a deleted account stayed good for its whole
  life (up to `never`, for the API token the MCP server holds) and the `email` claim could never be
  corrected. The missing row is its own `403` (*"This account no longer exists"*, not
  *"invalid or expired"* — a caller told the latter goes to log in with credentials that are also
  gone), a DB that cannot answer is a `503` on the revocation lookup's fail-closed rule, and a
  revoked API token is still refused **before** the read. It costs one indexed read per authenticated
  request; the browser session's `jti`-free "no round trip" property was traded for it deliberately.
  There is **one door** — `verifyToken`, a synchronous payload-trusting helper with no caller left,
  was deleted in the same change rather than left as the cheap second definition.
- **Exactly one account-creation path: `POST /api/auth/setup`** (first run only). **Never re-add a
  register route for a test** — an integration test pins its 404.
- **`ALLOWED_ORIGINS` is one list gating two surfaces** (REST CORS + the Socket.IO handshake), parsed
  once in `config/origins.ts`. No `Origin` header = always allowed (non-browser callers are gated by
  auth). Empty list stays permissive but warns at boot.
- WSS only. Secrets in `.env.local`, never in code. **Structured `exec` stays no-shell**
  (`{executable, args[]}`) — a shell is opted into explicitly, never implicitly.

### Template catalog
- **Templates are content, not code.** Edit `backend/src/catalog/bundled.ts` → `npm run registry:build`
  → commit `registry/` → **merge to `main`, which publishes itself**
  (`.github/workflows/publish-registry.yml`). **The drift test catches an unbuilt `registry/`; the
  daily `Registry drift` workflow catches an unpublished one**
  (`scripts/check-registry-published.mjs`, comparing the live index's ids and sha256s against the
  committed artifact) — a stale CDN and a correct `registry/` are indistinguishable from inside the
  repo, so no test in the suite can see it. `pwsh scripts/publish-registry.ps1` remains the manual
  path and now **refuses to publish from anything but up-to-date `main`** (`-Force` to override):
  it mirrors the working tree, so a branch behind `main` republishes an older catalog and prints
  *"Published."* ([#68](docs/troubleshooting/README.md#68-the-hosted-registry-goes-backwards-after-a-successful-publish)).
- **Who a stale registry actually hurts is narrower than it looks.** `TEMPLATE_REGISTRY_URL` is
  commented out in `backend/.env.example` by default, so a default install reads the compiled-in
  `bundled.ts` and needs no publish at all. The hosted artifact is what the **public gallery** serves
  and what an install that opts in syncs — and `catalogSync` auto-syncs only `core: true` rows, so
  extended templates reach a user by being browsed and imported. Publish because the gallery is
  advertising a catalog it does not have, not because installs are broken.
- Registry files are **content-addressed** (sha256 over exact bytes): keep them LF, never hand-edit
  `registry/`. The registry base URL is **frozen** at `https://mikesailab.com/cronsole-registry/` —
  GitHub does not redirect renamed Pages paths, so there is no second free move.
- **The front door is the only public face of the catalog; the registry host is a machine read**
  *(decided 2026-09-09)*. One page is served from two hosts, so every link has a choice of host and
  the choice is not arbitrary: **a human-facing link goes to `cronsole.mikesailab.com`** (README, the
  Templates-tab gallery pointer, the onboarding resource list) and **the apex path is what code
  fetches** (`TEMPLATE_REGISTRY_URL`, the gallery's own `REGISTRY_BASE` fallback). The registry repo
  is a **mirror with no source in it**, so linking a user at it offers them a worse copy of a page
  they were already on. This is also why `cronsole-registry` **stays on the personal account
  permanently** — it borrows the apex domain from `michaelschecht.github.io` with `cname: null`, and
  moving it to an org changes the frozen URL above with no redirect. The two rules are the same rule:
  the *path* cannot move, so nothing a user sees should depend on it.
- **Core vs extended**: `catalogSync` auto-syncs only `core: true`, marks those rows `managed` and
  prunes managed rows outside the core set (guarded against an empty core). Imported and
  saved-as-template rows are `managed: false` and never pruned.
- **Pack membership is declared, never derived** — `buildRegistry` throws on an unknown or duplicated
  id. Packs may overlap; every template belongs to at least one (a test asserts it).
- **A template family and the connector path that applies it ship in the same change**, or the
  templates are a promise the Apply button breaks.
- A template is target-agnostic and compiled at apply time; a declared-but-uncompiled
  `compatibleTargets` entry is the honest "copy to set up manually" path, never a silent failure.
- **On a hosted agent target a template is a prompt *plus a grant*, and the grant is a reference.**
  `agentTools` (its own `Template` column — not a second meaning for `nativeJob`, not a corner of
  `parameters`) holds `[{ type, name?, preset? }]` and **the two missing fields are the rule**: the
  registry schema reads no `url` and no `headers`, at the parse *and* at the export, so a published
  template can never carry a bearer token and no reader downstream (row, export, archive, log line,
  MCP response) is one forgotten `delete` from publishing one — `toToolSummary` / `readAllowlist`'s
  rule one layer up. The grant is not separable from the prompt: an agent told to email a digest
  with no `mcp_server` finishes `completed` and mails nothing, which no status can show. `preset`
  names a **saved server on the applying user's own connection**, may carry a `{{placeholder}}` so
  the choice can be a parameter, and resolves through the connector's one `resolveToolPresets` — an
  unsaved name is refused **with the list**, never passed through. And because reach is the
  consequential half of an autonomous task, **the Apply screen states the grant before the button**,
  not after.

---

## 10. Coding standards

- **TypeScript strict** everywhere on the JS side; no `any` without a comment justifying it.
- **Validate at boundaries** with Zod. Trust internal code.
- **Async/await only** (Node and C# `async Task`). Prisma transactions for multi-step atomic writes.
- Index every `WHERE` / `JOIN` / `ORDER BY` column.
- **Commits:** imperative subject, conventional prefix (`feat:`, `fix:`, `chore:`, `docs:`,
  `refactor:`, `test:`).
- **Never commit:** `.env*`, `node_modules/`, `dist/`, `build/`, `bin/`, `obj/`, `.venv/`, `*.msi`.

---

## 11. Workflow

1. **Session start:** this file + [`docs/ROADMAP.md`](docs/ROADMAP.md).
2. **Non-trivial change:** keep a task list; mark items in-progress/completed as you go.
3. **Material design decision:** update `ROADMAP.md` (and the relevant doc) *first*, then implement.
4. **External library question:** `context7` before writing.
5. **Setup or runtime failure** (won't build, boot, connect, authenticate): check
   [`docs/troubleshooting/README.md`](docs/troubleshooting/README.md) **first**, then run `/doctor`.
   Add a new entry in the same change — the bar is *"it cost you time"*, and a wrong turn is worth
   logging even when the fix was small.
6. **PR / large diff:** run `code-reviewer` before declaring done.
7. **Every change updates the records — in the same change** (§11a). Run **`/sync-surfaces`**.

### 11a. Mirror surfaces — update them in the same change

Every record below **describes** Cronsole rather than implementing it, so **none of them breaks
loudly when it drifts.** The suite stays green and the drift surfaces later as an agent — or you in
three weeks — confidently doing the wrong thing.

| You changed… | Also update, same change |
|---|---|
| A backend route an MCP tool maps to | `mcp-server/src/tools.ts` + `client.ts`; the tool tables in [`mcp-server/README.md`](mcp-server/README.md) **and** [`MCP_Server_Guide.md`](docs/user-guides/guides/MCP_Server_Guide.md) |
| Added / removed / renamed an MCP tool, or its params | Both tool tables above + [`skills/cronsole/SKILL.md`](skills/cronsole/SKILL.md) › "The two AI surfaces" + the tiers and prompt sets in [`docs/prompts/mcp-server/`](docs/prompts/mcp-server/README.md) |
| An MCP env var, or how it's read | [`mcp-server/.env.example`](mcp-server/.env.example) + the config table in **both** READMEs |
| A new invariant or architectural rule | §9 here + the invariants table in `SKILL.md` (rationale → [`DESIGN_NOTES.md`](docs/DESIGN_NOTES.md)) |
| **Anything that took real digging** | [`troubleshooting/README.md`](docs/troubleshooting/README.md) **and** the traps table in `SKILL.md` |
| The catalog (`bundled.ts`, `packs.ts`) | `npm run registry:build` and **commit `registry/`** — merging to `main` publishes it (`publish-registry.yml`), and the daily **Registry drift** check reddens if that ever stops working |
| A capability or claim the public gallery states | [`registry-site/index.html`](registry-site/README.md) — merging to `main` publishes it to **both** hosts (`publish-registry.yml` + `publish-frontdoor.yml`), and **Front door drift** checks both daily. One page, two hosts, so a fix that reaches one and not the other is the failure to look for |
| A field on a probe or action shape | The gallery's renderer — a *partial* reading is worse than raw JSON; absent and malformed are different facts |
| A new platform / connector / catalog rule | §9 here + `SKILL.md` + the relevant `skills/cronsole/references/*.md` |
| **A new source on the Sources tab** | Its own guide in [`docs/user-guides/sources/`](docs/user-guides/sources/README.md), registered in `SOURCE_DOCS` (`frontend/src/data/docs.ts`) so the card carries its **Read: using X** link, and listed in that folder's `README.md`. `docsLinks.test.ts` pins the count to the number of sources, so this one **fails loudly** — the only mirror surface that does |
| Renamed or removed a doc heading the app deep-links to | The matching `HelpTopic.doc` / `more` anchor in [`frontend/src/data/help.ts`](frontend/src/data/help.ts) (`docsLinks.test.ts` catches this) |
| A new user-facing control worth explaining | A topic in `help.ts` **and** the guide section it links to — the doc comes first |
| **Any user-visible change** | [`docs/CHANGELOG.md`](docs/CHANGELOG.md), under the right `[Unreleased]` heading, dated |
| Anything shipped, or scope moved | [`docs/ROADMAP.md`](docs/ROADMAP.md), dated |

**The check, every change:** *would an agent reading only the skill now be wrong? Does the wrapper
still describe the API it wraps?*

Two asymmetries: **the repo wins** — when the skill and a doc disagree, fix the skill; and
**`mcp-server/` owns no logic** — if syncing it tempts you to add behavior there, that behavior
belongs in a backend route.

**Published surfaces are mirror surfaces too, and they stay wrong after a green build and a clean
push**: the hosted registry and the gallery page are read by *other people's machines*. **Both now
publish on merge and are checked daily** — `publish-registry.yml` + `publish-frontdoor.yml`,
`registry-drift.yml` + `frontdoor-drift.yml`. The two publish scripts remain the manual path and
both now **refuse any branch that is not up-to-date `main`**; both `git reset --hard origin/main`
their working clone (`Repos/Tools/cronsole-registry`, `Repos/Tools/cronsole-site`) — **never keep
manual work there** — and both exclude `README.md` and `CNAME`, which the public repos own. `CNAME`
is infrastructure, not content: it decides which domain a Pages repo answers on, so the front-door
workflow **fails** when the target has none rather than publishing a page nobody can reach.

**One page, two hosts, so it is checked at both.** `registry-site/index.html` is served from
`cronsole.mikesailab.com` *and* `mikesailab.com/cronsole-registry/`, by two different publish paths —
so the stale half is whichever one you did not happen to open. `check-frontdoor-published.mjs`
compares sha256 over the served bytes at both, **LF-normalized**: a CRLF working tree makes the same
commit pass on Linux and fail on Windows, and makes a manual publish copy different bytes than CI
([#69](docs/troubleshooting/README.md#69-a-published-page-check-reports-both-hosts-stale-and-they-are-not)).
`registry-site/**` is pinned `text eol=lf` for the same reason `registry/**` is.

---

## 12. Open questions

Tracked in **Open decisions** in [`docs/ROADMAP.md`](docs/ROADMAP.md) — keep them there, not here.

---

*Condensed 2026-08-17 from a 601-line original, preserved verbatim at
[`docs/DESIGN_NOTES.md`](docs/DESIGN_NOTES.md). No rule was dropped; the reasoning behind each moved
there. When a rule changes, update it here — updating the long form is optional.*
