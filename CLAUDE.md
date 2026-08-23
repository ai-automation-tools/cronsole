# Cronsole

> Project instructions for **Cronsole** — a single pane of glass for scheduled tasks across Windows
> Task Scheduler, Cronsole-native jobs, and Claude Code routines. Overrides the parent workspace
> `CLAUDE.md` (`D:\AI_Agents\Projects\Mikes_AI_Lab\Agents\Claude\CLAUDE.md`) where they conflict.

**Repo:** [`github.com/michaelschecht/cronsole`](https://github.com/michaelschecht/cronsole) (private) ·
**Working branch:** `mike_desktop` · **Deploy branch:** `main`
**Local path:** `D:\AI_Agents\Projects\Mikes_AI_Lab\Repos\Live_Apps\cronsole` — **move it only via
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
routines (two modes — see Connectors) · ChatGPT / Jules / Open Claw / Hermes = quick links only.

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
| Auth | JWT in two kinds: a 24h **browser session** (no refresh, no `jti`, not individually revocable) and a named, revocable **API token** (`ApiToken`, `/api/auth/tokens`, 30/60/90 days or never). `checkToken` is one definition shared by REST middleware and the Socket.IO handshake, and fails closed on DB error. |
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
the `proxy` profile is running. Run **`/doctor`** before debugging your own code.

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
- **A refresh and an import are two requests, and must stay two.** `POST /tasks/sync`
  `{ categories }` **clears the untrack exclusions** inside those folders — naming a folder is the
  gesture that started tracking it — while `{ scope: 'tracked' }` must never clear one, or a
  routine refresh silently undoes a deliberate removal. A refresh still *creates rows* for new
  tasks inside folders already tracked; what it cannot do is adopt a new folder.
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
- **`runTask` returns `ran` alongside `success`.** A job that ran and failed is a `200` with
  `success: false`; only "could not start" is a `502`
  ([#59](docs/troubleshooting/README.md#59-a-check-that-correctly-finds-a-problem-is-reported-as-could-not-run-the-check)).
  `ran` is stamped once, in `executeJob`.
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
- **Cronsole creates only `\Cronsole`.** Two carve-outs (restore's `createFolders`, create's
  `createFolder`), both `false` by default, both signed, both naming every folder they created.
  `\Microsoft\` is refused in the backend *and* independently in the agent.
- **`\Cronsole-Stack\` is deliberately untracked** — it is the thing that runs Cronsole, not work
  Cronsole runs. Nothing enforces this; it is a standing choice.

### Frontend
- **Dark is the default; light is the toggle.** Theme persists at `cronsole.theme` (with `taskhub.*`
  read as a legacy fallback, assembled from parts so a rename pass can't neuter it).
- **Colour is a semantic role token in `index.css`, never a raw Tailwind palette utility**
  (`bg-amber-500` etc. are banned in `frontend/src`). Each role is a pair: `--x` (accent, used at low
  opacity) and `--x-text` (text on the page background — it must invert between themes while the
  accent must not). `-text` is not `-foreground`. A shared hue is not a shared role.
- TanStack Query for all server state; invalidate on `task:updated`. Mobile is first-class — every
  page passes a `<375px` viewport check.
- **Filter state is one `TaskFilters` object and lives in the URL** (`utils/taskFilters.ts`,
  `savedViews.ts`). A new drawer filter is a field on it, never a seventh `useState`. Built-in views
  are code, not `localStorage`. Tweaking a filter drops the UI to "Custom". **Because the slice *is* the
  URL, a route away from the dashboard must carry it and a route back must know where it came
  from** — `utils/taskRoute.ts` is the one definition of that round trip (query on the detail URL so
  it survives a reload; origin path in history state, validated as an in-app path).
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
- **A count beside a control describes the population that control governs** —
  `applyTaskFiltersExcept`, with the hidden count derived, not counted separately.
- **A judgement has one definition and it is the server's** — `isSystem`, health tier, task source
  (`services/taskSource.ts`), creatability (`usePlatformCreatability`, three answers incl.
  `unknown`). Re-deriving one in the browser is the [#20a](docs/troubleshooting/README.md) shape.
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
- **Absence of evidence is `unknown`, never `ok`**, and a claim never travels without its source.
  Disabled is not unhealthy. Never mix populations in one summary.
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
- **Core vs extended**: `catalogSync` auto-syncs only `core: true`, marks those rows `managed` and
  prunes managed rows outside the core set (guarded against an empty core). Imported and
  saved-as-template rows are `managed: false` and never pruned.
- **Pack membership is declared, never derived** — `buildRegistry` throws on an unknown or duplicated
  id. Packs may overlap; every template belongs to at least one (a test asserts it).
- **A template family and the connector path that applies it ship in the same change**, or the
  templates are a promise the Apply button breaks.
- A template is target-agnostic and compiled at apply time; a declared-but-uncompiled
  `compatibleTargets` entry is the honest "copy to set up manually" path, never a silent failure.

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
