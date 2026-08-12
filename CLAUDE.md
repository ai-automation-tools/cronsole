# Cronsole

> Project-scoped instructions for **Cronsole** — the Unified Scheduled Task Management System. This file overrides the parent workspace `CLAUDE.md` at `D:\AI_Agents\Projects\Mikes_AI_Lab\Agents\Claude\CLAUDE.md` where they conflict; otherwise the parent's general standards apply.

**Local path:** `D:\AI_Agents\Projects\Mikes_AI_Lab\Repos\Live_Apps\cronsole` — renamed from `taskhub` on 2026-07-31 (rename **stage 4**), **after** stage 3 had deliberately left it alone. **Move it only through [`scripts/startup-task/Migrate-RepoFolder.ps1`](scripts/startup-task/Migrate-RepoFolder.ps1), never by hand.** The hazard the old note named is real: **everything that holds this folder by absolute path has to move with it**, and a stale `-File` path or working directory fails *silently* at the next fire. Three things hold it — the three `\Cronsole-Stack\` launcher tasks, the published agent, and the `.claude\skills\cronsole` **junction** (a junction stores an absolute target, and **a dangling junction is not an error, it is an absence** — Claude Code loads no skill and reports nothing). **The post-move audit found zero of the machine's 268 tasks naming the old path, which is evidence the script repointed them, not evidence nothing pointed there** — it runs after the rewrite, so it can only ever confirm the rewrite. The sole residue is two cosmetic `Created via TaskHub` description comments. *(Audit note: `Get-ScheduledTask` and `schtasks` agree exactly on 268 tasks; a 269th "task" from `schtasks /fo CSV` is `ConvertFrom-Csv` splitting one multi-line description, so prefer `Get-ScheduledTask` and match on each action's `Execute`/`Arguments`/`WorkingDirectory`.)* *(Promoted from `Other-Repos/` to a top-level workspace repo on 2026-06-01.)*
**GitHub:** [`github.com/michaelschecht/cronsole`](https://github.com/michaelschecht/cronsole) (private) — renamed from `taskhub` on 2026-07-31 (rename stage 3)
**Working branch:** `mike_desktop` · **Deploy branch:** `main` (per workspace convention)
**Hosting:** **Local-first by design** — the frontend, backend, and .NET agent all run on the user's own machine, and Cronsole **launches local-first** (no hosted/SaaS instance; the earlier Hetzner "hosted control plane" plan was dropped 2026-07-13). Reaching your own local instance from other devices (Tailscale / Cloudflare Tunnel — the code-server model) is the **final, optional P3 enhancement**, delivered as docs + optional tooling: [`docs/user-guides/guides/Remote_Access_Guide.md`](docs/user-guides/guides/Remote_Access_Guide.md), [`docs/ROADMAP.md`](docs/ROADMAP.md) › P3.

---

## 1. Project Goal

Build a modern, dark-themed web application that provides a **single pane of glass** for viewing, triggering, and managing scheduled tasks across:

- **Windows Task Scheduler** (via local agent)
- **Claude Code Routines** (via API)
- **ChatGPT Automations** (quick links — no public API)
- **Jules** (quick links)
- **Open Claw**, **Hermes**, and future systems

Includes quick links to native UIs, cross-platform schedule conversion templates (cron ↔ Windows trigger ↔ Claude routine), and **MCP-based AI integration** (Phase 6) so Claude / Codex / Cursor can create and run tasks via natural language.

**Source of truth for the plan:** [`docs/ROADMAP.md`](docs/ROADMAP.md) — completed work plus prioritized open items (P0 security → P3 expansion). The original phase-based planning docs, the engineering specs, and the research analyses are kept locally under `docs/archive/` (not tracked in git) for historical reference.

---

## 2. Current Status

- **Plan management:** roadmap-driven (phases complete & archived). Open work is tracked in [`docs/ROADMAP.md`](docs/ROADMAP.md). **P0 security hardening is complete** (2026-07-09: agent WebSocket auth, config encryption at rest, multi-tenancy route scoping, structured command handling — no more `cmd.exe /c`). **P1 correctness is complete** (2026-07-10), including the full QA suite: backend integration tests against real Postgres (`npm run test:integration`, wired into CI), a mock-agent Playwright E2E suite (`npm run test:e2e` against a live stack), resilience/soak work with a stale-pruning guard, the security audit + dependency remediation (production `npm audit` 0), and a performance baseline — all dated artifacts live under `artifacts/`. **P2 product value is underway**, with three items shipped 2026-07-10: **failure notifications** (server-side generic/Discord/ntfy webhooks on failed manual + scheduled native runs), **agent `task:delete`** (deleting a Windows task removes the real Task Scheduler entry via a signed agent command; DB row only goes after platform confirmation; admin-ACL'd tasks get an honest "needs elevation" refusal), and the **Apply-modal upgrades** (editable task-name field with a server-side duplicate guard — 409 instead of Windows silently overwriting a same-name task — cron preset chips, local/UTC human schedule preview, and applied tasks tracked immediately). Known gap flagged during the integration work: the archived Test_Plan's `429` login rate-limit isn't implemented (tracked in the Go-public checklist).
- **Repo state:** Functional MVP prototype. Real-time sync between the .NET Windows Agent and the Node.js/Postgres backend is established, the frontend supports selective import plus local categorization, and the **template library** now ships a two-tier catalog (**55 templates — 5 core + 50 extended — plus 6 packs**, per `registry/index.json`; the "20 curated script starters" this line claimed was the count at first ship) with a working Apply modal that creates Windows tasks from parameterized `{{placeholder}}` commands. Catalog spec: [`docs/reports/templates/Templates.md`](docs/reports/templates/Templates.md). The catalog is now **decoupled into a versioned registry**: a target-agnostic Registry v1 JSON schema loaded through a `TemplateCatalogSource` (`backend/src/catalog/`), published as a static artifact (`registry/`, generated by `npm run registry:build`) to a **separate public repo** ([`michaelschecht/cronsole-registry`](https://github.com/michaelschecht/cronsole-registry), served via GitHub Pages at `https://mikesailab.com/cronsole-registry`) and synced into the DB on boot + on an interval, so the catalog updates without redeploying the app. Schema + decision record: [`docs/reports/templates/Registry_Schema_v1.md`](docs/reports/templates/Registry_Schema_v1.md), [`docs/adr/0001-template-registry-schema.md`](docs/adr/0001-template-registry-schema.md).
- **MVP target platforms:** Windows Task Scheduler (Functional) + Claude Code Routines (Experimental connector scaffold; not yet production-ready).
- **Out of scope for MVP:** Two-way sync, MCP creation, ChatGPT API integration, Open Claw / Hermes / Jules connectors.

---

## 3. Tech Stack

*(Header said "(planned)" until 2026-07-31; every row below is built and running.)*

| Layer | Technology |
|---|---|
| **Frontend** | React 19 + TypeScript + Vite + Tailwind CSS |
| **Server state** | TanStack Query |
| **Backend API** | Node.js + Express (TypeScript) |
| **Database** | PostgreSQL 16 + Prisma ORM |
| **Real-time** | Socket.io (server) + WebSocket client (agent) |
| **Windows agent** | .NET 10 (C#) + `Microsoft.Win32.TaskScheduler` + WiX installer |
| **Auth** | JWT — **a single 24h access token; there is no refresh flow and no rotation.** The auth surface is exactly three routes (`GET /status`, `POST /setup`, `POST /login`). OAuth2 post-MVP. *(This row read "JWT (access + refresh)" until 2026-07-31. The same false claim was found and fixed in the `cronsole` skill's route table on 2026-07-31 and survived here — an aspiration written in the present tense, which is the drift §11a exists to catch.)* |
| **Hosting (dev)** | Docker Compose |
| **Hosting (prod)** | **None — Cronsole is local-first.** Every user runs the whole stack on their own machine; there is no hosted instance (decided 2026-07-13). Reaching your own instance from another device is the optional P3 *Remote access* item. *(This row previously read "AWS ECS Fargate or Render; static frontend on S3 + CloudFront or Vercel" — true before the local-first decision, and corrected 2026-07-31.)* |
| **Cache / pub-sub** | Redis (optional for MVP; required for multi-instance WebSocket) |
| **MCP server** (Phase 6) | Node.js wrapper over REST API |

> Pin all base images; never `:latest`. PostgreSQL 16, Node LTS, .NET 10 (LTS).

---

## 4. Repo Layout

*(Header said "Planned" until 2026-07-31. This is now the actual tree — verified against disk; correct it here when it drifts rather than leaving an aspirational one.)*

```
cronsole/
├── CLAUDE.md                  # this file
├── docs/                      # all documentation (hub + folder READMEs; index: docs/README.md)
│   ├── ROADMAP.md             # the living plan: completed + prioritized open work
│   ├── install/               # index + guides/ (Windows / macOS / clone-repo install guides)
│   ├── setup/                 # env vars & configuration (VITE_*, DATABASE_URL, pairing)
│   ├── user-guides/           # index + guides/ (Agent_Setup_Guide.md, UI_User_Guide.md)
│   ├── agent-tools/           # dev tooling docs: mcp/, clis/, agents/
│   ├── resources/             # curated external links: repos/, websites/
│   ├── reports/               # templates/ (catalog spec) + examples/ (JSON payloads)
│   └── archive/               # LOCAL-ONLY (gitignored): specs/, research/, phases/, Project_Plan.md
├── registry/                  # static template registry artifact (index.json + templates/*.json)
│                              #   generated from backend/src/catalog/bundled.ts; mirrored to the
│                              #   public cronsole-registry repo (GitHub Pages). Do not hand-edit.
├── backend/                   # Node.js + Express + Prisma (Phase 3)
│   ├── prisma/
│   ├── src/
│   │   ├── catalog/           # template registry: v1 Zod schema, bundled snapshot, sources, sync
│   │   ├── connectors/        # PlatformConnector implementations
│   │   ├── tools/             # the Tools tab's API side: connect-pack/ (authored markdown,
│   │   │                      #   USER-facing — compiled to connectPackBundled.ts by
│   │   │                      #   `npm run connectpack:build`; never hand-edit the bundle)
│   │   ├── routes/
│   │   ├── ws/                # Socket.io agent server
│   │   └── auth/
│   └── package.json
├── frontend/                  # React 19 + Vite + React Router
│   ├── src/
│   │   ├── components/        # modals + widgets; components/ui/ = the Modal primitive
│   │   ├── screens/           # DashboardScreen / TemplatesScreen / PlatformsScreen
│   │   ├── hooks/             # useSettings, useToast, useConfirm, useLiveTaskUpdates, …
│   │   └── Dashboard.tsx      # the app shell (routing + mutations + top-level modals)
│   └── package.json
├── agent/                     # Windows agent — .NET 10
│   ├── Cronsole.Agent/        # the agent project (flat, no src/): AgentService.cs,
│   │                          #   AgentAuthenticator.cs, Win32TaskScheduler.cs,
│   │                          #   TriggerBuilder.cs / TriggerReader.cs, SocketIOWrapper.cs, …
│   ├── Cronsole.Agent.Tests/  # xunit
│   ├── test-server/           # local harness
│   ├── publish/               # `dotnet publish` output — the exe Windows actually launches.
│   │                          #   NOT cleaned between publishes; one of the 3 things that run stale.
│   └── setup-agent-startup.ps1
│                              # NOTE: there is no installer/ yet — the WiX MSI is an open
│                              #   P3 roadmap item ("Installer packages"), not shipped code.
├── mcp-server/                # Cronsole's own MCP server (shipped) — thin stdio wrapper over the
│   │                          #   REST API; owns NO logic. Runs dist/, so an unbuilt change is
│   │                          #   invisible. Lets an agent USE a running Cronsole. See §8.
│   └── src/                   #   index.ts (stdio bootstrap) · client.ts (axios) · tools.ts (15 tools;
│                              #   delete_task gated by CRONSOLE_MCP_ALLOW_DESTRUCTIVE)
│                              #   __tests__/ = vitest (npm test), no backend needed
├── skills/                    # Agent Skills — TRACKED source of truth. Surfaced to Claude Code via
│   └── cronsole/               #   a per-machine junction at .claude/skills/ (§8a). ALWAYS edit here.
│       ├── SKILL.md           #   Mental model, invariants, traps, routing. Teaches an agent to
│       └── references/        #   WORK ON the codebase (the mirror image of mcp-server/).
└── docker-compose.yml
```

> Create the `backend/`, `frontend/`, `agent/`, and `mcp-server/` folders only when starting their respective sprints. Don't scaffold all of them at the start of Phase 0. *(`mcp-server/` now exists — the MCP server shipped 2026-07-13.)*

---

## 5. Planning Docs

The phase lifecycle (0–6) is complete and archived. Planning now runs through a single living document:

- **[`docs/ROADMAP.md`](docs/ROADMAP.md)** — completed work (dated) + open items in priority order: P0 security → P1 correctness → P2 product value → P3 expansion, plus open decisions and strategy guardrails.
- **`docs/archive/`** (local-only, not tracked in git) — the original `Project_Plan.md`, `phases/Phase0–6.md`, the engineering specs (`specs/CONTRACTS.md`, `Test_Plan.md`, `Native_Tasks.md`, `Platforms-Tab.md`), and the `research/` analyses, kept as the historical record of the MVP build. Don't update these; they're frozen.

**When making material decisions** (e.g., choosing a connector pattern, redesigning the schema, changing the agent protocol), update `docs/ROADMAP.md` — it's the spec of record. The detailed contracts in `docs/archive/specs/` are kept locally for reference.

---

## 6. Available Skills (use these proactively)

Invoke via `Skill` tool when the work matches.

### Cronsole itself — start here
- **`cronsole`** — **this project's own skill**: the mental model, the non-negotiable invariants, the traps that cost real hours, and a routing table to the canonical docs. Use it for work **anywhere in this repo**. It lives canonically at [`skills/cronsole/`](skills/README.md) (tracked) and reaches Claude Code through a per-machine junction — **always edit `skills/cronsole/`, never through the link** (see §8a). It **routes rather than duplicates**: when the skill and a doc disagree, **the doc wins — fix the skill**. Not to be confused with the `cronsole` **MCP server** (§8), which *uses* a running Cronsole rather than teaching you about the codebase.

### Planning & PM
- **`init`** — scaffold/refresh project-level CLAUDE.md if structure changes drastically.
- **`update-docs`** — keep phase docs synced with implementation reality.
- **`create-architecture-documentation`** — generate diagrams + ADRs for Phase 2 outputs.
- **`refactor-code`** — quality passes during/after sprints.
- **`simplify`** — review changed code for reuse and clarity.

### Design (Phase 2 → 3)
- **`frontend-design`** — distinctive, production-grade UI; use for dashboard, template library, task detail modal.
- **`ui-design-system`** — dark-theme tokens, component contracts, dev handoff. The system *is* dark-themed by default; this skill anchors that.
- **`mobile-design`** — the FR explicitly says "trigger from phone in <30 seconds." Use when touching the responsive view.

### Development & Quality
- **`code-reviewer`** — review every non-trivial PR (TypeScript, C#, etc.).
- **`api-architect`** — REST/GraphQL contract design, pagination, versioning, OpenAPI. Overlaps the `api-designer` subagent (§7); reach for the skill when *you* are designing a route, the subagent when the work is big enough to hand off.
- **`senior-qa`** — Phase 4 test strategy, E2E (Playwright), Vitest/Jest setup.
- **`web-performance-optimization`** — Phase 4–5; targets NFR1 (dashboard <2s).
- **`security-review`** — Phase 4 audit (API keys, agent auth, encryption at rest).

### DevOps & Infra
- **`senior-devops`** — Docker, ECS/Render, CI/CD pipelines, monitoring, secret management.
- **`release-engineering`** — shipping to strangers: versioning across the four independently-versioned components (app / agent+protocol / MCP server / registry schema), WiX MSI, Authenticode signing, macOS notarization, agent auto-update & trust, the legal minimum. Covers four open roadmap items `senior-devops` doesn't: **Installer packages**, **Agent distribution & trust**, **Versioning & releases**, **Legal minimum**.

### Diagnosis & consistency (custom commands)
- **`/doctor`** — run this **before debugging your own code** when live behavior contradicts the source. Checks the **three things that run stale** (Dockerized backend, published agent, `mcp-server/dist/`), agent connectivity, and `CRONSOLE_TOKEN` expansion. Most "impossible" behavior is one of those.
- **`/sync-surfaces`** — the §11a mirror-surface check, mechanized: maps a diff onto the surfaces it obligates and reports what drifted. Run before committing anything non-trivial.

### MCP & AI Integration (Phase 6)
- **`claude-api`** — building the MCP server / Anthropic SDK integration.
- **`agent-tool-builder`** — designing the MCP tool surface (`list_tasks`, `run_task`, `create_task`, `convert_schedule`).
- **`ai-agents-architect`** — orchestration if the MCP layer grows beyond simple tool wrappers.
- **`senior-prompt-engineer`** — system prompts for the natural-language task creation flow.

### Documentation
- **`github-readme`** — final repo README before public beta.
- **`obsidian-markdown`** — only if Mike chooses to mirror these docs to Obsidian.

### Automation
- **`schedule`** / **`loop`** — for any long-running validation loops (e.g., agent stability sweeps in Phase 4).

---

## 7. Available Subagents

Invoke via `Agent` tool with `subagent_type`. Spawn in parallel when work is independent.

| Subagent | When to use |
|---|---|
| **`native-agent-engineer`** | Anything under `agent/`: .NET 10, Task Scheduler COM, `TriggerBuilder`, the WS+HMAC protocol, WiX. **The macOS/launchd agent (P3) lands here.** Owns the layer where a bug stops being cosmetic. |
| **`template-curator`** | The catalog: `bundled.ts` → `registry:build` → publish, core vs extended, `normalize.ts`, `catalogSync` pruning, template packs, resolvability failures. |
| **`test-engineer`** | Characterization / contract tests that pin down existing behavior before a rewrite. |
| **`api-designer`** | Phase 1 deliverable: OpenAPI contracts. Phase 6: MCP tool schemas. |
| **`backend-designer`** | Prisma schema, Express service layer, WebSocket server design, auth middleware. |
| **`frontend-designer`** | Component architecture, design tokens, dark-theme CSS variables. |
| **`frontend-developer`** | Full React app build-out in Phase 3 sprints 6–7. |
| **`fullstack-developer`** | Cross-cutting features that span DB → API → UI (e.g., the template apply flow). |
| **`project-manager`** | Sprint planning, dependency mapping, scope negotiation. |
| **`technical-writer`** | User docs and template contribution guide (Phase 5). |
| **`Explore`** | Quick read-only lookups inside this repo or sibling repos. |
| **`Plan`** | Step-by-step implementation plans for non-trivial features. |

---

## 8. Relevant MCP Servers

> [!IMPORTANT]
> **Two different MCP surfaces share [`.mcp.json`](.mcp.json)** (gitignored; seeded from [`.mcp.json.example`](.mcp.json.example)). Don't conflate them:
> - **Dev tooling** — servers that help you *build* Cronsole. Nothing to set up.
> - **`cronsole`** — Cronsole's **own product MCP server** ([`mcp-server/`](mcp-server/README.md)), which lets an agent *use* a running Cronsole. It's the only entry needing a built `dist/`, a running backend, and a token — and so the only one that can fail to start.

**Dev tooling** (no extra setup needed):

- **`context7`** — fetch current docs for React, Prisma, Express, Socket.io, Tailwind, .NET, WiX. Use **before** writing code that touches an external library.
- **`github`** — PR creation, reviews, issue tracking.
- **`playwright`** — Phase 4 E2E browser testing.
- **`serper`** — research for Phase 0 / Phase 6 (e.g., "does ChatGPT have a documented automations endpoint?").
- **`notion`** — optional: mirror phase docs / risk register to a Notion workspace.
- **`nanobanana`** — image generation if marketing/landing-page assets are needed in Phase 5.
- **`elevenlabs`** — voice generation (likely unused for this project).

Also available from the user environment: `mermaid-chart` (Phase 2 architecture diagrams), `ide` (diagnostics + code execution), `windows` (UI automation if any flow needs it).

**Cronsole's own MCP server** — `cronsole` (dogfooding):

Exposes **15 tools** over stdio, each a 1:1 call to a backend route — **read**: `list_tasks`, `list_templates`, `list_folders`, `get_task_history`, `export_task`, `convert_schedule`; **create**: `create_task` (free-form command → a real task, no template), `create_native_task` (full HTTP job spec), `create_task_from_template`; **act**: `run_task`; **modify**: `set_task_status`, `update_task_schedule`, `update_task_action`, `untrack_task` (drops Cronsole's row, leaves the real scheduled task running); **destroy**: `delete_task`. Covered by its own vitest suite (`cd mcp-server && npm test`; real tools driven through a real MCP client over an in-memory transport, stubbed HTTP client) — which by construction **cannot** prove the wrapper and the API still agree, so hand-drive a tool after changing a route it wraps.

**Destructive-op gating is tiered** (decided 2026-07-15): read-only and *reversible* verbs are ungated; only `delete_task` is, behind `CRONSOLE_MCP_ALLOW_DESTRUCTIVE=true` — and when off it is **absent from `tools/list`**, not present-and-erroring. `set_task_status` ships ungated *on purpose*: it's the honest way to park a task, and gating it would push an agent toward encoding "don't run" in the cron (troubleshooting #14) — **a gate that makes the safe path harder than the unsafe one is worse than no gate**. The gate is an **env var, not a `confirm: true` param**: a param is filled in by the model, i.e. the caller assuring itself it's sure, which is the missing deliberation rather than a substitute for it. Still REST-only: template import/export, save-as-template, sync, agent pairing, and **favorites** (`POST` / `DELETE /api/tasks/:id/favorite`) — `compactTask` does not forward `isFavorite`, so `list_tasks` cannot read a star either. Requires `cd mcp-server && npm run build`, a running backend, and `CRONSOLE_TOKEN` exported in the environment **the host was launched from** (`.mcp.json` references it as `${CRONSOLE_TOKEN}` so the committed config never holds the secret). On Windows, a newly set variable needs a **fresh terminal** — a process inherits its parent's environment, so restarting Claude Code inside an old terminal won't pick it up. If the variable is unset the host forwards the literal `${CRONSOLE_TOKEN}`, the API returns a misleading `403 Invalid or expired token`, and the server refuses to start — so the tools go *missing* rather than erroring. See [troubleshooting #8](docs/troubleshooting/README.md#8-every-mcp-tool-returns-403-invalid-or-expired-token) and the [MCP Server Guide](docs/user-guides/guides/MCP_Server_Guide.md).

**It is a thin wrapper and owns no logic** — new behavior belongs in a backend route, never in `mcp-server/`. It runs `dist/`, not `src/`, so an unbuilt change is invisible: it's a **third thing that runs stale**, alongside the Dockerized backend and the published agent.

---

## 8a. Project-Local `.claude/` Layout

**Only `agents/`, `commands/`, and `skills/` are tracked.** `.gitignore` denies `/.claude/*`
and re-includes those three, so per-machine noise (`settings.local.json`, `temp/`, `images/`,
`rules/`, IDE state) can never be committed by accident — the failure mode that once let four
duplicate `" copy"` skill trees sit one `git add -A` away from the repo.

```
.claude/
├── agents/         # 10 subagent definitions (matches §7 above)
│   ├── api-designer.md
│   ├── backend-designer.md
│   ├── frontend-designer.md
│   ├── frontend-developer.md
│   ├── fullstack-developer.md
│   ├── native-agent-engineer.md      # .NET agent, Task Scheduler COM, launchd, WiX
│   ├── project-manager.md
│   ├── technical-writer.md
│   ├── template-curator.md           # catalog / registry / core-vs-extended
│   └── test-engineer.md
├── commands/       # 5 custom slash commands
│   ├── create-architecture-documentation.md
│   ├── doctor.md                     # diagnose the 3 stale processes + agent + MCP token
│   ├── refactor-code.md
│   ├── sync-surfaces.md              # mirror-surface drift check (§11a)
│   └── update-docs.md
├── rules/          # (empty, untracked — add project-specific rules as patterns emerge)
└── skills/         # 19 entries: 18 installed skills + the cronsole junction (mirrors §6)
    ├── agent-tool-builder/
    ├── ai-agents-architect/
    ├── api-architect/
    ├── canvas-design/
    ├── code-reviewer/
    ├── cronsole/                      # a per-machine JUNCTION to repo-root skills/cronsole —
    │                                  #   gitignored, created by scripts/setup-skill-links.ps1.
    │                                  #   Never a copy; never edit through it (see below).
    ├── frontend-design/
    ├── github-readme/
    ├── mobile-design/
    ├── obsidian-cli/
    ├── obsidian-markdown/
    ├── release-engineering/
    ├── senior-data-scientist/
    ├── senior-devops/
    ├── senior-prompt-engineer/
    ├── senior-qa/
    ├── skill-writer/
    ├── ui-design-system/
    └── web-performance-optimization/
```

These are scoped to this project and override any same-named global skill/agent. Edit them in place when behavior needs to differ from the global default.

**The `cronsole` skill is the exception — do not edit it here.** It lives canonically at the repo-root [`skills/cronsole/`](skills/README.md) (tracked) and is surfaced to Claude Code through a per-machine junction at `.claude/skills/cronsole`, created by `scripts/setup-skill-links.ps1` (`.sh` on POSIX). Run that once per fresh clone. **Always edit `skills/cronsole/`**, never through the link. Each linked skill needs a `/.claude/skills/<name>/` line in `.gitignore` — because `.claude/skills/` *is* tracked here, git would otherwise follow the junction and commit the content twice; the setup script warns if the entry is missing.

---

## 9. Domain Conventions

These are project-specific overrides on top of the parent workspace's general standards.

### Data model
- **All schedules stored as 5-field cron in UTC.** That is the storage, API, signed-agent-command and MCP contract, and it does not move. **Conversion happens at the browser's edge only** (`frontend/src/utils/timezone.ts` + `useScheduleZone`): the cron *fields* read and accept the user's zone — `Settings › Schedule timezone`, an IANA id defaulting to **`America/Los_Angeles`** — and `zoneCronToUtc` runs once on submit. Two consequences worth holding onto: **a zone must never reach storage or an MCP tool** (a cron whose meaning depends on its author forks every expression in the DB, and `create_task` cannot see a browser preference), and **every field that shifts prints the stored UTC form beside it**, so the dashboard and `list_tasks` never appear to disagree. Two honest refusals: a date-pinned cron whose shift crosses midnight (`0 4 1 1 *`) is unexpressible and stays UTC with a reason; and **DST is asymmetric** — a Windows task holds its local wall-clock across a transition (the agent converts UTC→local at registration), a Cronsole-native task does not (`NativeScheduler` evaluates the stored UTC cron forever), and the UI says so.
- `Task.externalId` is the platform's native ID (e.g., Windows task path, Claude routine ID). `(platform, externalId)` is unique.
- `PlatformConnection.config` is **encrypted at the application layer** (AES-256-GCM) before Prisma write. Never log decrypted values.

### Connector pattern
- Every platform integration implements the `PlatformConnector` interface in `backend/src/connectors/platform.interface.ts`.
- New platforms get a `<Platform>Connector.ts` file and register themselves in `backend/src/connectors/registry.ts`. No platform-specific logic outside this layer.

### Agent ↔ Server protocol
- Agent **always initiates** the WebSocket (outbound from the user's machine). Server never connects in.
- Message envelope: `{ type: string, payload: object }`. Types use `noun:verb` form (`task:run`, `agent:hello`).
- Heartbeat: ping every 30s. Reconnect with exponential backoff (1s → 5min cap).
- Run commands are signed with per-session HMAC to prevent replay.

### Frontend
- Dark theme is the **default**, not an opt-in. The light variant is the toggle.
- **Colour is a semantic role in `index.css`, never a raw Tailwind palette utility.** `bg-amber-500` / `text-red-400` and friends are banned in `frontend/src`; use the role tokens — `success` · `warning` · `danger` · `isolate` · `info` · `system` · `neutral-text`, plus `native` / `claude` / `chatgpt` identity. Each role is a **pair**: `--x` is the accent for fills and borders (used at low opacity, `bg-warning/10`), and `--x-text` is that role rendered as text on the page background. They are separate because **the text version must invert between themes and the accent must not** — which is exactly why a raw utility cannot work: one literal cannot be light-on-black and dark-on-white, so before this every status role failed WCAG AA in the light theme (1.67–2.77 against white, AA is 4.5), and no tuning at the call site could have fixed it without breaking dark. Two traps. **`-text` is not `-foreground`**: `--x-foreground` is text placed *on* a solid fill of that role. And **a shared hue is not a shared role** — merging by appearance would have folded ChatGPT's brand emerald into `success`, Claude's purple into the system lens, and the isolating-lens rose into failure red; check what a colour *means* before merging it. Platform identity is a role too, and its home is `platform.ts`.
- **Schedules are read and written in `settings.timezone`** (default Pacific), never raw UTC. A new cron input must hold its value in that zone and call `useScheduleZone().toUtc()` exactly once, on submit — converting per keystroke fights the cursor, and converting twice double-applies the offset. `describeCron` and the `/tasks/preview` route both take the **UTC** form.
- Tailwind `darkMode: 'class'`. Theme persists via `localStorage` keyed **`cronsole.theme`** (`frontend/src/hooks/useTheme.ts`). The pre-rename `taskhub.theme` is **read** as a legacy fallback — in `index.html`'s inline no-flash script and in `utils/storageMigration.ts`, which copies `taskhub.*` forward — so the rename doesn't reset anyone's theme. That legacy prefix is **assembled from parts on purpose** so a future rename pass cannot rewrite it into `cronsole` and turn the fallback into a no-op that still reads correctly.
- Use TanStack Query for all server state. Invalidate on WebSocket `task:updated` events.
- Mobile is a first-class target — every page must pass `<375px` viewport check.
- **The dashboard's filter state is one `TaskFilters` object, and it lives in the URL** (`frontend/src/utils/taskFilters.ts`, `savedViews.ts`). Saved views need a combination that can be *named*, so a new filter is a field on that object — never a seventh `useState` alongside it, which is how the fifth filter ends up applied to the list but not to the counts beside it. Three consequences that are easy to get wrong: **a view is a bookmarkable URL**, so state must survive a paste into another window (history is written with `replace`, not `push` — filters are a state of the page, not a sequence of pages); **a matched view always writes its id**, because a bare URL already means "this user's saved dashboard defaults" and two states cannot share one encoding; and **the built-in views are code, not data** — storing them in `localStorage` would freeze a copy of what "Failures" means into each user's browser. Tweaking any filter must drop the UI to "Custom": a lit chip over a list it no longer describes is the same lie as `Active Only` hiding 110 rows silently.
- **A favorite is a preference about a tracked row; an exclusion is a memory of a removed one.** `TaskFavorite` is keyed on **`taskId`, and cascades**; `TaskExclusion` is keyed on **`(platform, externalId)`** precisely *because* it must outlive the row (without that, the next sync re-imports what you untracked). Getting this backwards in either direction is a real bug: a star that survived a delete returns attached to nothing, or to a re-imported task nobody starred. Both are per-user joins, never columns — a column would make one tenant's star everyone's. **The Favorites view ignores every other lens** (`status: 'any'`, `system: 'include'`): a star is an explicit per-task choice, so no *default* may overrule it, or the star quietly means "shown, conditions apply". **The dashboard opens on it when the user has any star** — decided by `openingFilters(hasFavorites, defaults)` from a **bare URL**, derived rather than written, so touching any filter ends it (the default state itself writes `?view=my-jobs`). And because that filter is *self-applied*, the lit chip is not enough: a banner names it, counts the tasks it is holding back, and offers the way out — the tooltip that suffices for a view you clicked does not suffice for one that arrived on its own.
- **Source is the dashboard's outer lens, and the one dimension a view does not own.** *Where a task comes from* is the first-level axis (`components/SourceBar.tsx`), above the saved views — Cronsole is growing past one scheduler, and "which system is this from?" precedes "is it failing?". Being *outer* is a set of obligations, not a position: `filtersEqual` **ignores `platform`**, so selecting a source leaves the view chip lit rather than dropping to *Custom* — legal only because both constraints are visible at once, since the rule being bent is about **hidden** constraints. Everything else follows. Source rides **alongside** the view id in the URL (`?view=my-jobs&platform=TASKHUB_NATIVE`), because a matched view returns early and would otherwise swallow it, and a bookmark must reproduce what you see. Saved views **do not store** a platform (`viewFiltersFrom` strips it) — `matchView` would never read it, so it would be dead state that reads as meaningful. The Filters badge **does not count** it: a count may only describe what its own drawer can clear. And **every view count is taken inside the selected source**, or `My jobs 88` sits above one row, which is `Showing All 269` again.
  - **An outer lens may not disappear because an inner filter narrowed the list.** Built from the *faceted* population, the bar vanished on any view whose matches were all one source — removing the only control that could switch away. **Existence** ("do you have this source at all") comes from the whole task list; only the **count** ("what will I see if I click") stays faceted. That split is why a source can legitimately read `0`, and the zero is the honest form: it predicts the empty list instead of hiding the route to it.
- **A count beside a filter control is a promise about what clicking it will reveal.** So it is taken over the population that control *governs* — every task passing every **other** lens — which is neither the dashboard total nor the filtered list. One helper computes it, `applyTaskFiltersExcept(tasks, filters, dimension, opts)`, and `applyTaskFilters` delegates to it so a dimension cannot exist in one and not the other. The status chip learned this the hard way: counting over the raw list, it printed `Showing All 269` above the two rows the Favorites view was showing. Two corollaries. **The hidden count is derived, not counted separately** (`governed.length - filtered.length`) — a number computed by its own route can disagree with the list it sits above, and eventually will. And **a control labels the dimension it owns, never the whole list**: `All statuses`, not `Showing All`, because status is one lens of eight and the others are still in force underneath it. The rule generalizes past this chip — it is what the category and platform facets were already doing by hand, and what the Filters drawer will need.
- **A judgement has exactly one definition, and it is the server's.** The dashboard's *Failures* view filters on the tier from `GET /api/tools/task-health`; it does **not** ask whether `lastRunStatus === 'FAILURE'`. That shortcut is wrong on the platform that dominates a real dashboard — a Windows task's `SUCCESS` in `ExecutionLog` records the agent *accepting a start* — and the correct reasoning (Windows' `lastTaskResult`, minus Task Scheduler's informational codes) already exists in `services/taskHealth.ts`. Re-deriving it in the browser is the shape that silently took a folder out of every sync (troubleshooting #20a). Same rule as `isSystem`: the server sends a verdict, the browser renders it.

### Bulk export, restore & the Connect Pack (the Tools tab)
- **Bulk export reads the machine, not the tracked subset.** `POST /api/tools/export/tasks` enumerates every task the agent can see — the un-imported ones are precisely the ones nothing else is holding. Tasks under `\Microsoft\` are excluded **by default but counted out loud**; silently dropping them would repeat the invisible-fence failure that made un-imported tasks impossible to notice.
- **Task Scheduler XML is UTF-16 LE + BOM, always** — the only encoding Windows re-imports. One definition of that format lives in `toTaskXmlBuffer` (`services/bulkExport.ts`), shared with the single-task route. It never crosses a JSON boundary as text: the browser path sends **base64**, the download path sends a server-built ZIP.
- **The agent gets no file-write verb.** It is already elevated and already local, so "let it write where told" is the obvious shortcut — and it would convert a task-scheduler agent into a general elevated arbitrary-file-write primitive reachable from the backend. The browser's directory-picker limitation is the lesser cost.
- **Two skills, two audiences.** `skills/cronsole/` teaches an agent to work **on** this codebase. `backend/src/tools/connect-pack/` teaches an end user's AI tool to **use** a running Cronsole. Repo internals (`catalogSync`, `normalize.ts`, `bundled.ts`, `registry:build`) and repo-relative links must never reach the pack — a test enforces it. Every pack artifact is version-stamped: a downloaded copy is a mirror surface that can never be updated, so it must at least be able to say how old it is.
- **Cross-task routes live on `/api/tools`, not `/api/tasks`** — everything on `tasks.ts` competes with `/:id` in Express's declaration-order matching.
- **A bulk operation reports per item, never per batch, and needs a halt rule distinct from its failure rule.** At real scale a bulk change is *partially* successful as the normal case, so every bulk verb returns five outcomes: `updated`, `unchanged` (already in the target state — not a success to count, not an error to invent), `refused` (declined by Cronsole *before* the platform is asked, e.g. a `MISSING` task, or a native task that cannot be untracked), `failed` (the platform said no), `skipped`. **There is one definition, `services/bulkOutcome.ts`**, shared by `POST /api/tools/tasks/status`, `/category` and `/untrack` — three response shapes for three verbs would mean a caller who handles one has learned nothing about the others. The **halt** rule is separate, and belongs only to the verbs that talk to the agent: bulk status **stops at the first sign the agent is gone** and marks the remainder `skipped` with the reason — each Windows task costs its full ~15s timeout, so continuing turns one request into fifty copies of the same error. **A per-task refusal must not halt** (an ACL denial says nothing about the next task); getting that discrimination wrong is a bug in either direction. Recategorize and untrack never ask a platform, so they *cannot* halt: their `skipped` is structurally `0` and stays in the response anyway. Anything that failed stays selected in the UI, because the next move is a retry.
- **Friction has to scale with the blast radius, and a scope is what makes that possible.** A confirmation that is the same dialog at 3 tasks and at 254 does not get harder as the operation gets bigger, so habit built on small batches carries straight through to a machine-wide one — which is the actual gap, not a missing dialog (bulk status and untrack always confirmed). Two rules follow. **Past `TYPE_TO_CONFIRM_THRESHOLD` (25) the confirmation costs a deliberate act** — typing the count — because that is the smallest gesture muscle memory cannot produce; and **the dialog states the scope in words**, since `254 selected` is not something a reader can check while *"every tracked task of yours"* is. That is why the Mass Actions console (`components/tools/MassActionsTool.tsx`, `utils/massActions.ts`) is scope-first rather than a bigger checkbox. **Row selection was removed from the dashboard entirely (2026-08-12)** — two ways to say "these tasks" is one too many, and selection was the weaker one: it could not survive into a confirmation as anything checkable, and `Select all 269` built a batch every bulk button then 400'd on. The safe-path objection to removing it did not survive checking: **"Remove from Cronsole" sits beside "Delete from Windows" in the task modal, per task**, which is where that pairing always actually lived — the bulk bar was never what kept them together. The corollary that does hold: **relocating a control is not a safety measure**, since friction by obscurity wears off; the typed confirmation is what carries it. Chunking honours that ceiling rather than arguing with it: the bound is correctness (each Windows task can cost its full ~15s agent timeout), and batching also buys progress and a stopping point one long request could never have.
- **A category is a Cronsole label; the Task Scheduler folder is the machine.** They normally agree — a Windows task's category is *derived* from its folder at import — which is exactly why relabelling one silently forks them. `POST /api/tools/tasks/category` is DB-only and moves nothing on the machine; it is **not refused** (it is a legitimate thing to want, and single-task `PATCH /api/tasks/:id` always allowed it) but it is **counted and named**: the response carries `detachedFromFolder`, and the modal states the number *before* the click, because a warning that arrives with the result arrives too late to change the decision. The folder verdict comes from `TaskService.extractCategory` and is passed *into* the planner — never re-derived, which is the shape of troubleshooting #20a.
- **Bulk untrack is one transaction, and needs no agent.** `POST /api/tools/tasks/untrack` deletes each row and records its `TaskExclusion` together: a row removed without its exclusion returns on the next sync, so the user does the work twice and trusts it less the second time. That atomicity is affordable precisely *because* there is no platform round-trip inside it — bulk status cannot do the same, since each of its writes is only legitimate once the machine has confirmed the change. Being platform-free also means it works while the agent is offline, which is when someone is most likely to be tidying up. The UI label is **"Remove from Cronsole", never "Remove"** — this sits one click from Delete and is the safe path it must not be mistaken for.
- **Export-selected names what it could not export.** `POST /api/tools/export/tasks` takes `scope: 'selection'` with **Cronsole task ids** (never raw paths — the server resolves them, so a caller cannot name an arbitrary task on the machine). `all` and `folder` describe a *region*, so whatever is there is the answer; a selection names specific tasks, and a named task the machine does not report is a fact about the request — surfaced as `requestedMissing` in the response *and* written into the archive manifest, alongside `unsupported` for selected non-Windows tasks. An archive silently missing the one task that mattered is the failure the whole backup feature exists to prevent. An explicit selection also overrides the `\Microsoft\` default exclusion: that fence exists so a machine-wide export isn't buried under ~257 system tasks, not to override a row the user deliberately ticked.
- **Restore plans before it writes, and the plan needs no write to produce.** `POST /api/tools/restore/tasks` always decides create / overwrite / skip / refuse for every file first, from the machine's real tasks and folders — both readable through **read-only** agent verbs — so `dryRun: true` is a genuine preview rather than a rehearsal. `RegisterTaskDefinition` overwrites silently and the agent is elevated, so "restore" must never be the first moment you learn what a file was going to do. An offline agent is a **502, not a blind restore**.
- **Restore's two flags are `false` by default and both live inside the HMAC signature.** `overwrite` (replace an existing task) and `createFolders` (recreate a missing folder chain) each widen what one click may destroy or create — the same argument that put `folder` inside the `task:create` signature. So does the XML itself, folded into the signed message as a **sha256 of its UTF-8 bytes**: the XML *is* the task (action, trigger, and the account it runs as), so an unsigned one would make the signature decorative.
- **"Cronsole creates only `\Cronsole`" has exactly two carve-outs, and they share one shape.** The invariant exists because folder deletion needs elevation — and [#28](docs/troubleshooting/README.md#28-a-restored-task-or-the-folder-it-landed-in-cant-be-deleted-access-is-denied) sharpened it past its original wording: the agent is elevated, so a folder it creates carries an administrator ACE and is a door **only an administrator** can close, not merely "only the user". The two exceptions are **restore** (`createFolders`, the user asking for *their own* tree back by name, from a file they chose) and **task creation** (`createFolder` on `POST /api/tasks`, where the folder is the one the user is filing a task into right now). Both are **`false` by default**, both ride **inside the HMAC signature** — each widens what one click may create — and both **name every folder they created** in the response, because Cronsole creating a folder is the exception to a standing invariant and may never be silent. Neither may create under `\Microsoft\`, refused independently in the agent. `\Cronsole` is still the only folder Cronsole ever *removes*.
  - **Why creation is a carve-out and a free-standing `create_folder` is not.** A folder here is always incidental to a task the caller actually asked for, which is what keeps the blast radius tied to intent. A tool that makes folders on its own lets an agent feeling its way leave `\AI-Tools`, `\ai_tools` and `\AITools` behind — each permanent without elevation, at machine speed. That is the dogfood that produced the invariant (three empty folders needing hand-deletion, 2026-07-14), with a faster clock.
- **Restoring a task does not track it.** It lands on the machine; Cronsole's row comes from an explicit Import, like any other native task.
- **`\Cronsole-Stack\` is Cronsole's own launcher, and is deliberately left untracked** *(decided 2026-07-31)*. The three tasks that start the agent and self-heal the stack are **infrastructure — the thing that runs Cronsole, not work Cronsole runs.** Tracking them puts the app in its own task list, where the obvious action is wrong in the obvious way: disabling `CronsoleAgent` from the dashboard takes the agent offline, which is also what stops the dashboard being able to re-enable it. It also keeps the `\Cronsole-Stack\` ↔ `\Cronsole\` separation (which exists so prune-its-own-folder can never reach the launcher) true at the UI layer instead of relying on nobody clicking Delete. **Nothing enforces this** — Import discovers `Cronsole-Stack` as an ordinary category and it is ticked under the *Non-system* preset — so it is a standing choice, not a guard. Rationale and the "why not" live in [`scripts/startup-task/README.md`](scripts/startup-task/README.md).
- **`ExecutionLog` records runs Cronsole *performed*, not runs that *happened*.** Rows come from exactly two writers — `POST /api/tasks/:id/run` and `NativeScheduler`. **A Windows task firing on its own schedule writes nothing**, and a manual Windows run's `SUCCESS` means *"the agent accepted the start"* (fire-and-forget; `durationMs` times the round trip). So a Windows task's real outcome lives in **Windows** — `lastTaskResult`, `lastRunTime`, `numberOfMissedRuns`, carried on the sync snapshot — and only Cronsole-native tasks can be judged from `ExecutionLog`. Every **cross-task run-history** row carries a `runKind` so `status` is readable — but `runKind` is **not a column on `ExecutionLog`**: it is derived at read time by `runKindFor(platform)` in `services/runHistory.ts` and exists only on the `/api/tools/history` surface (JSON + CSV). The per-task `GET /api/tasks/:id/executions` returns the raw rows, with no `runKind` on them. Anything treating the table as a complete run history is wrong at dashboard scale. **The same fact decides each analytics view differently** (`services/runAnalytics.ts`, `GET /api/tools/analytics`): the failure trend reads `ExecutionLog` and is *labelled* as Cronsole-performed runs; the duration trend reads it but **only native rows** (a Windows `durationMs` times the agent accepting a start, so ranking those compares handshakes to jobs — the excluded count is stated); and the **idle** report cannot use it for Windows at all, judging those from Windows' own `lastRunTime` instead. Idle has **four** outcomes, not two — idle / never-run / no-run-evidence / disabled-or-on-demand — because only one of them is a defect, and the unassessed ones are counted out loud so "nothing is idle" is never read as "everything is fine".
- **Platform status reports evidence, not preconditions.** `getHealth` must never derive a verdict from something that cannot change when the platform fails. It returned `HEALTHY` whenever a socket **object** existed — but Socket.IO's heartbeat is answered by the transport, so a wedged agent whose command loop has stopped keeps a healthy socket while answering nothing, and the dashboard said *"Online · synced just now"* through a run of `Agent sync timeout`s. Health is now the newest of `lastResponseAt` (any inbound event, hooked once via `socket.onAny` in `index.ts` so no connector verb can forget it) against `lastFailureAt` (set at each request timeout, naming the verb): no socket → `OFFLINE`, timeout newest → `DEGRADED`, else `HEALTHY`. **`lastSync` has exactly one writer — the `PlatformConnection.lastSync` column that `POST /api/tasks/sync` writes — and `ConnectorHealth` has no `lastSync` field at all.** A health probe never stamps one, because *a timestamp the observer generates can never be stale, which is exactly why it can never be true*. **Connected is not synced.** The rule is per-connector but the consequence is global: the "synced N ago" chip takes the newest `lastSync` across *all* platforms, so one connector fabricating a time defeats the honesty of every other. Cronsole-native therefore reports none at all — this database is its source of truth, so it has nothing to be stale against. See [troubleshooting #40](docs/troubleshooting/README.md#40-the-sidebar-says-windows-is-online-and-synced-just-now-while-every-agent-request-times-out).
  - **Why the field was deleted rather than documented.** *This paragraph used to say `lastSync` was "the agent's last inbound event, else the stored column"* — and that first clause was the bug. `WindowsAgentConnector` filled it with `lastResponseAt`, so a **folder listing** made a 19-hour-old task list read as *"Synced 7m ago"* ([#42](docs/troubleshooting/README.md#42-the-dashboard-says-synced-7m-ago-over-a-task-list-from-yesterday)). That is #40 one level down, and it **survived #40's fix**: the replacement was a *real* timestamp of the *wrong event*, which passes every honesty check an invented one fails — first-hand, absent without evidence, correctly stale when the agent goes quiet. The sharpened rule: **ask what event writes a status field and whether that is what the label names.** Liveness is real and useful, so it is reported under its own name, `lastContactAt`; a field only a mistake can fill should not exist.
- **A capability is a property of the route, and a claim about *this install*.** The Platforms matrix (`services/platformCapabilities.ts`, `GET /api/tools/platforms`) answers "what can Cronsole do with this platform" in three states, and the middle one carries the design: **verified** (it has actually succeeded here, with the timestamp that earned it), **declared** (the route would accept it; nothing has been observed to work), **unsupported** (the route would refuse). Two things it may never be derived from. **Not `typeof connector.deleteTask === 'function'`** — that is a claim about the code, not this machine, the same shape #40 was fixed for; and it is *factually false* for Cronsole-native, whose delete, reschedule and export are handled inside `routes/tasks.ts` (the DB row **is** the task) without touching a connector method, so a connector-derived matrix reports that platform as unable to do three things it does daily. **And not from a single boolean** — collapsing declared into verified is the spec-table lie the screen exists to prevent. Evidence lives in `PlatformCapability`, written by `recordCapability` at the routes as they run; **that writer must never throw**, because an observer may not be able to fail the verb it observes. Absence of a row is absence of evidence, never a negative verdict — the same reading the health scorer gives a field an un-republished agent never reported.
- **A status readout may not change its own geometry.** The dashboard health strip is one fixed-height line that scrolls; it was `flex-wrap`, so a segment appearing took it from one row to two and moved the whole dashboard down ~22px — on a 45-second poll, with no interaction to explain it. The generalization matters for the visual suite too: **masking hides colour, not geometry** ([#43](docs/troubleshooting/README.md#43-a-visual-regression-baseline-fails-on-one-pixel-or-on-a-layout-that-moved-by-itself)), so a live-data element whose size tracks its content de-stabilizes everything laid out beside it, mask or no mask. Give it fixed geometry, or put it where nothing depends on its size.
- **Health scoring: absence of evidence is `unknown`, never `ok`.** `GET /api/tools/task-health` returns a tier, a ranking score, and **signals that each name the field they came from** — a claim never travels without its source, and the UI never renders the number alone. A field the agent has never reported is *absent*, not zero: an un-republished agent omits `lastTaskResult`, and reading that as "never ran" would flag every Windows task at once. The score's weights are fixed so it is explainable; its job is sorting worst-first, not grading. **Disabled is not unhealthy** — parking a task is the recommended safe action (the same reason `set_task_status` ships ungated over MCP). **The rule has to survive into the UI, not stop at the API:** the dashboard's *Failures* chip shows `–` rather than `0` until the scan lands, because with no tiers every task is `unknown`, the list renders empty, and an empty list asserts *"nothing is failing"*. And a summary must never mix populations — the Task health card counted three tiers over personal tasks and `Healthy` over all 352, printing a row that summed to 256 under the label "across 352 tasks" (fixed 2026-07-31).
- **Cross-task reads apply the same system/personal lens the dashboard does.** `isSystem` comes from the one server-side definition (`TaskService.isSystemTask`) and is never re-derived in the browser. Live testing showed why: on a real machine 4 of the 5 worst-scoring tasks were `\Microsoft\` entries, which re-creates exactly the burial the lens exists to prevent. Hidden by default, and the count is always named.
- **The CSV export neutralizes formula injection and ships UTF-8 + BOM.** Cronsole stores command lines, so a cell beginning `=`, `+`, `-` or `@` would be executed by Excel on open — a task named `=cmd|'/c calc'!A1` would make the report a live payload. The BOM is not cosmetic either: without it Excel decodes non-ASCII task names as ANSI. Encoding is part of the format, same as the UTF-16 the Task Scheduler XML needs.

### Security
- Secrets never in code. Use `.env.local` for dev. **There is no "prod" secret store — Cronsole is local-first** (§3), so secrets live in the user's own `.env` / environment on the machine running the stack. *(This line read "AWS Secrets Manager / Vault for prod" until 2026-07-31 — a leftover of the hosted plan dropped 2026-07-13, the same staleness already corrected in the §3 Hosting row.)*
- WebSocket: WSS only. JWT for users, pairing-secret-derived token for agents.
- No `0.0.0.0` binds in the agent. It's a *client*, not a server.
- **There is exactly one account-creation path — `POST /api/auth/setup`** (first run only; 409 once an owner exists). The generic `POST /auth/register` was deleted 2026-07-31: an unauthenticated account-creation endpoint on a service whose job is creating and running commands on the user's machine, kept alive only because the test suite found it convenient. **Never re-add one for a test.** An integration test pins its 404.
- **`ALLOWED_ORIGINS` is one list gating two surfaces** — REST CORS *and* the Socket.IO handshake — parsed once in `backend/src/config/origins.ts`. They used to be separate (a bare `app.use(cors())` beside a restricted socket), which is how two mechanisms answering the same question drift. A request with **no `Origin` header is always allowed** — every non-browser caller (MCP server, `curl`, the test suite) sends none, and authentication, not CORS, is their gate. An **empty list stays permissive but warns at boot**: "unset" and "deliberately open" are indistinguishable from inside the process, and only one of them is a decision.

### Template catalog (registry)
- Templates are **content, not code**: they live in the Registry v1 JSON schema, not inlined in `seed.ts`. Edit the catalog in `backend/src/catalog/bundled.ts` (the bundled source of truth), then `npm run registry:build` to regenerate `registry/`, and `pwsh scripts/publish-registry.ps1` to mirror it to the public `cronsole-registry` repo.
- **Local clones of the two public site repos** live side by side under `D:\AI_Agents\Projects\Mikes_AI_Lab\Repos\Tools\`:
  - **`Tools\cronsole-registry`** — remote [`michaelschecht/cronsole-registry`](https://github.com/michaelschecht/cronsole-registry), served at `https://mikesailab.com/cronsole-registry` (registry JSON **and** the browse-and-import gallery site).
  - **`Tools\cronsole-site`** — remote [`michaelschecht/cronsole-site`](https://github.com/michaelschecht/cronsole-site), served at `https://cronsole.mikesailab.com` — **Cronsole's front door**. *(2026-07-28: the separate marketing landing page was retired; this domain now serves the **gallery**, with the landing page's pitch, quick start and project links merged into its Home view. There is one public page, published to two hosts.)*
  - Both are **separate, independent git repos** — NOT submodules of this one (`registry/` and `registry-site/` here are normal tracked folders; **there is no `landing-site/`** — the separate landing page was retired 2026-07-28 and its folder and `publish-landing.ps1` are both gone. The two publish scripts are `publish-registry.ps1` and `publish-frontdoor.ps1`). **These clones double as the publish working clones**: both scripts default their `-WorkDir` to them (falling back to `%TEMP%` off this machine), `git reset --hard origin/main` them, copy the source in, commit, and push — so **each publish leaves the local clone updated** to the pushed state. Because of that reset, **never keep manual work in these clones** — they are pure mirrors.
  - **The public repos own their own `README.md`** (house-style front pages) — both publish scripts exclude `README.md` from the mirror, so the clones' READMEs are safe. Source-of-truth folders in this repo are `registry/` (registry JSON, generated) + `registry-site/` (the one public page) → **both** `cronsole-registry` (via `publish-registry.ps1`) **and** `cronsole-site` (via `publish-frontdoor.ps1`). The in-repo folder READMEs are dev folder-notes and diverge from the public front pages on purpose.
  - **The public repos also own their `CNAME`.** A domain is infrastructure, not content: it decides which host a Pages repo answers on. Both scripts exclude `CNAME` from the mirror, so a stray one in `registry-site/` can never hand `cronsole.mikesailab.com` to the **registry** repo — which would move the registry JSON off its documented URL and break catalog sync for every installed Cronsole. `publish-frontdoor.ps1` warns if the target's CNAME went missing.
  - **The registry base URL is frozen at `https://mikesailab.com/cronsole-registry/`.** It is the documented `TEMPLATE_REGISTRY_URL` that installed apps fetch from, so it does not follow the front door to its domain. The one `index.html` works at both hosts: it tries `./index.json` and falls back to the canonical registry origin when it isn't co-located (GitHub Pages serves `Access-Control-Allow-Origin: *`). **"Frozen" now means frozen** — the URL moved exactly once, on 2026-07-31 (`taskhub-registry` → `cronsole-registry`, rename stage 3), and that was safe only because `TEMPLATE_REGISTRY_URL` was commented out everywhere, so **zero installs were fetching it**. GitHub redirects a renamed repo's *git* URLs indefinitely but **not its Pages paths**, so the identical move after the first real install is an unannounced, silent outage on someone else's machine. There is no second free move.
- A template is **target-agnostic** (Trigger → Action → Execution Target) and *compiled* to a target's native config at apply time; only Windows/Cronsole-native have real compilers today — a declared-but-uncompiled `compatibleTargets` entry is the honest "copy to set up manually" path, never a silent failure.
- The app loads templates through `TemplateCatalogSource` (`backend/src/catalog/source.ts`): `BundledCatalogSource` (compiled-in) or `RegistryCatalogSource` (remote, integrity-checked via per-file sha256, cached, falls back to bundled). Selected by `TEMPLATE_REGISTRY_URL`. `catalogSync.ts` upserts the catalog into the DB on boot + interval — favorites and applied tasks are keyed by template id and untouched.
- **Core vs. extended (distribution tiers).** Templates carry an optional **`core`** flag. **`catalogSync` auto-syncs only `core: true`** into a DB (it intersects the `core` ids from `listRaw()` with the normalized `list()` rows), so a fresh install gets a small curated **core** (built-in) and the **extended** long tail is **import-only** — users pull those from the gallery via the shipped Import route. The registry/gallery always contains **both** (it's built from the full `bundledCatalog`); only the auto-sync is limited. The gallery reads `core` from `index.json` and shows an **Availability** facet (Built-in / Import) + a "Built-in" card badge. No DB column: `normalize.ts` whitelists Prisma fields, so `core` never reaches the DB. To reclassify a template, flip `core: true/false` in `bundled.ts` and rebuild. Current split: **5 core + 50 extended = 55**. **Prune-on-sync:** auto-synced rows are marked `Template.managed = true`; after upserting core, `catalogSync` deletes managed rows outside the core set, so **existing** installs converge to core too (not just fresh ones). Imported / saved-as-template rows are `managed: false` and are **never pruned**. Guarded against an empty core (a bad sync can't wipe the catalog).
- Registry files are **content-addressed** (sha256 over exact bytes): keep them LF (`.gitattributes`) and never hand-edit `registry/`; the drift test fails if it's out of sync with `bundled.ts`.
- **Packs are curated sets, and membership is declared — never derived.** A pack lists its `templateIds` explicitly in `backend/src/catalog/packs.ts`; `buildRegistry` **throws** on an unknown or duplicated id. The gallery used to infer collections from tags (`tags.includes('dev')`), which meant tagging an unrelated template silently changed what a collection held — fine for a filtered view, not for a **downloadable file that lands in someone's catalog**. Each pack is published as `registry/packs/<id>.json` in the exact shape `POST /api/templates/import` accepts (one file, one import), content-addressed like templates, with **no timestamp inside** — a clock would change the hash every build and make the drift test meaningless. `packs` is **optional** in `index.json` in both directions, so it rolled out without a coordinated release. Packs may overlap; every template should belong to at least one, or "download every pack" is quietly less than the catalog (a test asserts full coverage). Presentation (icons/colors) stays in the gallery keyed by pack id, so adding a pack needs no site change.
- Structured `exec` actions stay **no-shell** (`{executable, args[]}`) — the P0 injection guarantee. A shell is opted into explicitly (`cmd.exe /c "…"`), never implicit.

---

## 10. Coding Standards

Inherited from the parent `CLAUDE.md`. Key points worth repeating:

- **TypeScript strict mode** everywhere on the JS side. No `any` without a comment justifying it.
- **Validate at boundaries** with Zod (Node) / Pydantic (Python, if any). Trust internal code.
- **Async/await only** in Node and C# (`async Task`). No callback chains.
- **Prisma transactions** for any multi-step atomic write.
- **Indexes on every** `WHERE` / `JOIN` / `ORDER BY` column (see Phase 2 doc for the SQL).
- **Commit style:** imperative subject, conventional-commits prefix (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`).
- **Never commit:** `.env*`, `node_modules/`, `__pycache__/`, `dist/`, `build/`, `bin/`, `obj/`, `.venv/`, `*.msi`.

---

## 11. Working Workflow

1. **Start of a session:** read this file + [`docs/ROADMAP.md`](docs/ROADMAP.md).
2. **Non-trivial change:** create a `TaskCreate` list, mark items `in_progress` / `completed` as you go.
3. **Material design decision:** update `docs/ROADMAP.md` and the relevant spec doc *first*, then implement.
4. **External library question:** `context7` before writing.
5. **Every change updates the records — in the same change, not a follow-up pass:** [`ROADMAP.md`](docs/ROADMAP.md) (what shipped / what moved), [`CHANGELOG.md`](docs/CHANGELOG.md) (any user-visible change), [`troubleshooting/README.md`](docs/troubleshooting/README.md) (anything that took real digging), and the mirror surfaces (`mcp-server/`, the `cronsole` skill). **See §11a for which change obligates which.** None of them fails a test when it goes stale — that's exactly why the discipline has to be explicit. Run **`/sync-surfaces`** to check.
6. **PR / large diff:** invoke the **`code-reviewer`** skill before declaring done.
7. **End of session:** the records above should already be current (step 5). This is a *last check*, not the first time you write them.
8. **Setup / runtime error (won't build, boot, connect, or authenticate):** check [`docs/troubleshooting/README.md`](docs/troubleshooting/README.md) **first** — it's a symptom → cause → fix log of problems we've hit. When you resolve a *new* one, **add an entry in the same change**. The bar is "it cost you time", not "it cost hours" — and a *wrong turn* is worth logging even when the eventual fix was small, because the next person will take the same wrong turn.

### 11a. The record-keeping surfaces — update them **in the same change**

**The three living records — [`docs/ROADMAP.md`](docs/ROADMAP.md), [`docs/CHANGELOG.md`](docs/CHANGELOG.md), and [`docs/troubleshooting/README.md`](docs/troubleshooting/README.md) — plus the two mirror surfaces (`mcp-server/` and the `cronsole` skill), are part of the work, not a chore afterwards.** A change isn't done until they're true.

Why this is a rule and not a nicety: every one of these **describes** Cronsole rather than implements it, so **none of them breaks loudly when it drifts.** The suite stays green, CI is happy, and the drift surfaces later as an agent — or a user, or you in three weeks — confidently doing the wrong thing. That's a *confident lie*, which §9's honesty rule treats as the worst failure mode there is, aimed at your future self.

This has already bitten, repeatedly: the skill went months with **zero** MCP coverage while `mcp-server/` shipped; two READMEs insisted the server wasn't wired into `.mcp.json` long after it was, actively misdirecting a live debugging session; and a full day of work reached `ROADMAP.md` while `CHANGELOG.md` got **nothing** — because CHANGELOG wasn't in the table below. If it isn't listed, it gets forgotten. That's the whole reason the table exists.

| You changed… | Also update, same change |
|---|---|
| A backend route an MCP tool maps to — `/api/tasks`, `/api/tasks/:id/run`, `/api/templates`, `/api/templates/:id/apply`, `/api/tasks/preview` | `mcp-server/src/tools.ts` + `client.ts`; the tool tables in [`mcp-server/README.md`](mcp-server/README.md) **and** [`MCP_Server_Guide.md`](docs/user-guides/guides/MCP_Server_Guide.md) |
| Added / removed / renamed an MCP tool, or changed its params | Both tool tables above + the tool list in [`skills/cronsole/SKILL.md`](skills/cronsole/SKILL.md) › "The two AI surfaces" |
| An MCP env var, or how it's read | [`mcp-server/.env.example`](mcp-server/.env.example) + the config table in **both** READMEs |
| A new invariant or architectural rule | §9 here + the invariants table in `SKILL.md` |
| **Anything that took real digging** — a wrong turn, a confusing symptom, a trap | [`docs/troubleshooting/README.md`](docs/troubleshooting/README.md) **and** the traps table in `SKILL.md`. **The bar is "it cost you time", not "it cost hours"** — if you had to work it out, the next person will too. |
| A new platform / connector / catalog rule | §9 here + `SKILL.md` + the relevant `skills/cronsole/references/*.md` |
| **Any user-visible change** — feature, fix, behavior change, removal | [`docs/CHANGELOG.md`](docs/CHANGELOG.md), under the right `[Unreleased]` heading (Added / Fixed / Changed / Removed / Security), dated |
| Anything shipped, or scope moved | [`docs/ROADMAP.md`](docs/ROADMAP.md), dated |

**The check, on every change:** *would an agent reading only the skill now be wrong? Does the wrapper still describe the API it wraps?* If either answer is bad, the change isn't done.

Two asymmetries to hold onto:
- **The repo wins.** When the skill and a doc disagree, the doc is right — fix the skill. The skill routes; it must not become a second, staler copy of the docs.
- **`mcp-server/` owns no logic.** If syncing it tempts you to add behavior there, that behavior belongs in a **backend route** — that's what keeps owner scoping, no-shell `exec`, signed agent commands, and cron→trigger conversion in one tested place. A wrapper that grows logic stops being a wrapper, and the guarantees quietly fork.

---

## 12. Open Questions / Decisions Needed

Tracked in the **Open decisions** section of [`docs/ROADMAP.md`](docs/ROADMAP.md) — keep them there, not here. (Resolved 2026: P0 security is now complete — backend hosting is unblocked for a single-user host; a multi-user launch still depends on the Go-public account/operations items. The frontend-only demo deployment was retired 2026-07-09.)

---

*Last updated: **2026-07-31** — the rename is complete through **stage 4** (product, repos, registry URL, front door, and the local checkout folder), and this file was audited against the code the same day. Ten claims were corrected: the Auth row (no refresh flow exists), the prod-secrets line and the "planned" framing on §3/§4 (all leftovers of the dropped hosted plan), the `agent/` subtree (no `src/`, no `installer/` — WiX is still an open P3 item), the template count (20 → 55 + 6 packs), the theme key (`cronsole.theme`, with `taskhub.theme` read as a fallback), the retired `landing-site/` + `publish-landing.ps1`, and two skills missing from the §8a tree. **The pattern in almost all of them: an aspiration or a first-ship number written in the present tense, left standing after the thing changed.** The dated narrative below is the 2026-07-15 snapshot, kept as written.*

*Prior header: 2026-07-15 (P1 complete; P2 rolling; P3 underway. Shipped since: the Windows management pass (enable/disable → schedule edit → action/settings edit), Templates-tab work (view selector, Resources menu, honesty pass, favorites), the **template registry** — the catalog is now a decoupled, versioned, hosted registry (`backend/src/catalog/` + `registry/` → the public `cronsole-registry` repo) synced into the DB on boot + interval — **template import/export** (`backend/src/catalog/denormalize.ts` + `GET /api/templates/export` / `POST /api/templates/import`) and **Save task as template** (`backend/src/catalog/templateFromTask.ts` + `POST /api/tasks/:id/save-as-template`) — the two non-reseed ways users/agents grow the catalog — plus two dogfood fixes: the self-heal tasks no longer flash a PowerShell window (`scripts/startup-task/run-hidden.vbs` + dedup) and the empty `\Cronsole\` scheduler folder is auto-pruned on last-task delete. **User resources & onboarding**: the Help Center now leads with a Getting Started walkthrough + Guides & Docs links, with a dismissible first-run banner (`frontend/src/data/onboarding.ts`). **Export existing tasks**: per-task Export in the modal — Windows → native Task Scheduler XML via a read-only `task:export` agent round-trip (delivered UTF-16 LE + BOM), Cronsole-native → JSON (`GET /api/tasks/:id/export`). **Template tags model**: free-form `tags String[]` on `Template` (distinct from `category`), carried through registry→DB→export and surfaced as a dedicated Tags facet + per-card chips in the Templates tab (foundation for the template packs). **Developer Pack** (2026-07-13): 9 dev-workflow templates (git hygiene ×3, npm dependency-check/build/test ×3, .NET build, Docker prune + compose self-heal) added to the bundled catalog + rebuilt registry (33 templates), all tagged via the tags model; a new whole-catalog resolvability test guards every bundled `commandTemplate` through the Apply pipeline. **AI Pack — Claude Code** (2026-07-13): 4 `ai-agent` templates that run the Claude Code CLI unattended as real creatable Windows tasks (`ai-claude-headless-run`, `-repo-digest`, `-autofix-commit`, `-log-cleanup`) — headless `claude -p`, fenced by `--permission-mode dontAsk`, user-scoped `--allowedTools`, `--bare`, captured output via a PowerShell `-Command` wrapper (invocation verified vs. the current CLI docs); registry rebuilt to **37 templates** and published to the hosted registry (`https://mikesailab.com/cronsole-registry`). The **Codex** slice is deferred. See `docs/ROADMAP.md` and `docs/reports/templates/Registry_Schema_v1.md`. **MCP server** (2026-07-13, first P3 item): a new `mcp-server/` package — a thin stdio wrapper over the REST API exposing 5 tools (`list_tasks`, `run_task`, `list_templates`, `create_task_from_template`, `convert_schedule`) on `@modelcontextprotocol/sdk` 1.29, auth'd as one user via `CRONSOLE_TOKEN`, so any MCP host can drive Cronsole in natural language; verified live against the running backend. **Launch posture — local-first** (2026-07-13): cloud/SaaS hosting is dropped as the default; Cronsole launches as a local-first app and remote access (reaching your own instance from other devices via Tailscale / Cloudflare Tunnel — the code-server model) is the final, optional P3 enhancement (`docs/user-guides/guides/Remote_Access_Guide.md`). **Frontend refactor** (2026-07-13, P3): shipped as five slices — an accessible `Modal` primitive + promise-based `useConfirm` (replacing both native `confirm()` gates), that shell adopted across all 8 modals (Escape/focus-trap/ARIA + a nested-modal stack), a mobile sidebar drawer meeting the `<375px` requirement, `react-router-dom` with bookmarkable sections + `/tasks/:id` & `/templates/:id` deep links, and `Dashboard.tsx` split 1,830 → 248 lines into `frontend/src/screens/` (DashboardScreen / TemplatesScreen / PlatformsScreen). New user docs: `MCP_Server_Guide.md`, `Remote_Access_Guide.md`. **2026-07-14**: (1) **Multi-day weekly schedules fixed** (P1) — `parseInt('1-5')` is `1`, so `0 9 * * 1-5` built a **Monday-only** trigger at confidence 1.0 with no warnings, in all three layers (convert, import, *and* the agent's `TriggerBuilder`); real day parser + lossy-step warnings, verified live (`DaysOfWeek=62`). (2) **MCP hardening** — an unset `CRONSOLE_TOKEN` is forwarded as the *literal* `${CRONSOLE_TOKEN}` and 403s like an expired JWT; `configFromEnv()` now refuses to start (troubleshooting **#8**), and two READMEs that claimed the server isn't in `.mcp.json` (it is) were corrected. (3) **Mirror-surface rule** (§11a) — `mcp-server/` and the skill describe rather than implement, so they never break loudly when they drift; they ship with the change that obsoletes them, mechanized by `/sync-surfaces`. (4) **Windows folder selector on apply** (P2) — the Apply modal now picks a **real** Task Scheduler folder (category *is* the root folder for Windows tasks); `\Microsoft\` refused in the backend **and** independently in the elevated agent, `folder` is inside the `task:create` signature, and the duplicate guard became folder-aware. **Needs an agent republish.** See `docs/ROADMAP.md` + `docs/CHANGELOG.md`. **2026-07-15**: the **MCP surface grew from 5 → 7 tools and finally got a test suite**. (1) **`create_task`** — the surface could only create *from a template*, making the catalog a gate on a capability the app never gated; found by hitting it (asked for a task that "just launches a PowerShell app", the only path was a template whose command is `-File "{{scriptPath}}"`, so a `.ps1` had to be *invented for it to point at*). Wraps `POST /api/tasks`; **no new backend logic**. (2) **`list_folders`** — `create_task`'s `folder` had no honest way to be filled, since Cronsole creates only `\Cronsole` and refuses a create into a missing folder; read-only, so it jumped ahead of the mutating verbs, which still wait on a **destructive-op gating decision** ("the route already exists" is *not* an argument for exposing it). (3) **`skills/cronsole/references/task-authoring.md`** — shipped *with* the tools, not after: a create tool without the invariants (UTC cron, no-shell, `\Microsoft\` refused, folder-must-exist, `0.7` = **replaced**) just creates wrong tasks confidently. (4) **75-test vitest suite** + CI (`npm test` → `typecheck` → `build`), driving the real tools through a real MCP client over an in-memory transport; **mutation-tested**, because a suite that can't fail is decoration. Two honest residuals recorded rather than papered over: the suite **stubs the client**, so it cannot prove the wrapper and the API still *agree* ([#9](docs/troubleshooting/README.md#9-agent-payload-arrives-with-every-field-empty) one layer up — hand-drive a wrapped route after changing it); and an unrecognized cron is **replaced** with a hard-coded hourly trigger while warning only that times "might not align 100%" ([#14](docs/troubleshooting/README.md#14-a-rare-cron-becomes-an-hourly-trigger); the honest-warning fix is a P3 item). Recurring lesson, now written down twice: **when you're testing the reporting layer's honesty, the reporting layer cannot be your witness** — `lastRunStatus: SUCCESS` is exactly what a hung task reports, so proof came from Windows' `LastTaskResult` plus a real side effect. See `docs/ROADMAP.md` + `docs/CHANGELOG.md`.)*
