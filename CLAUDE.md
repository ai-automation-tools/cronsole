# TaskHub

> Project-scoped instructions for **TaskHub** — the Unified Scheduled Task Management System. This file overrides the parent workspace `CLAUDE.md` at `D:\AI_Agents\Repo\Mikes_Repos\CLAUDE.md` where they conflict; otherwise the parent's general standards apply.

**Local path:** `D:\AI_Agents\Repo\Mikes_Repos\Other-Repos\taskhub`
**GitHub:** [`github.com/michaelschecht/taskhub`](https://github.com/michaelschecht/taskhub) (private)
**Working branch:** `mike_desktop` · **Deploy branch:** `main` (per workspace convention)

---

## 1. Project Goal

Build a modern, dark-themed web application that provides a **single pane of glass** for viewing, triggering, and managing scheduled tasks across:

- **Windows Task Scheduler** (via local agent)
- **Claude Code Routines** (via API)
- **ChatGPT Automations** (quick links — no public API)
- **Jules** (quick links)
- **Open Claw**, **Hermes**, and future systems

Includes quick links to native UIs, cross-platform schedule conversion templates (cron ↔ Windows trigger ↔ Claude routine), and **MCP-based AI integration** (Phase 6) so Claude / Codex / Cursor can create and run tasks via natural language.

**Source of truth for the plan:** [`docs/Project_Plan.md`](docs/Project_Plan.md). Each phase has its own deep-dive doc under `docs/` (see §5).

---

## 2. Current Status

- **Phase:** 1 — Requirements & Specifications (Active)
- **Repo state:** Documentation phase. Windows Agent feasibility validated 2026-06-01 via technical spike.
- **MVP target platforms:** Windows Task Scheduler + Claude Code Routines.
- **Out of scope for MVP:** Two-way sync, MCP creation, ChatGPT API integration, Open Claw / Hermes / Jules connectors.

---

## 3. Tech Stack (planned)

| Layer | Technology |
|---|---|
| **Frontend** | React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui |
| **Server state** | TanStack Query |
| **Backend API** | Node.js + Express (TypeScript) |
| **Database** | PostgreSQL 16 + Prisma ORM |
| **Real-time** | Socket.io (server) + WebSocket client (agent) |
| **Windows agent** | .NET 8 (C#) + `Microsoft.Win32.TaskScheduler` + WiX installer |
| **Auth** | JWT (access + refresh); OAuth2 post-MVP |
| **Hosting (dev)** | Docker Compose |
| **Hosting (prod)** | AWS ECS Fargate or Render; static frontend on S3 + CloudFront or Vercel |
| **Cache / pub-sub** | Redis (optional for MVP; required for multi-instance WebSocket) |
| **MCP server** (Phase 6) | Node.js wrapper over REST API |

> Pin all base images; never `:latest`. PostgreSQL 16, Node LTS, .NET 8.

---

## 4. Planned Repo Layout

```
taskhub/
├── CLAUDE.md                  # this file
├── docs/                      # planning & design docs (one per phase)
│   ├── Project_Plan.md        # master overview
│   ├── Phase0.md              # Inception & Discovery
│   ├── Phase1.md              # Requirements & Specifications
│   ├── Phase2.md              # Architecture & Design
│   ├── Phase3.md              # Development (MVP)
│   ├── Phase4.md              # Testing & QA
│   ├── Phase5.md              # Deployment & Rollout
│   ├── Phase6.md              # Post-Launch & Iteration
│   └── api-examples/          # raw JSON request/response samples
├── backend/                   # Node.js + Express + Prisma (Phase 3)
│   ├── prisma/
│   ├── src/
│   │   ├── connectors/        # PlatformConnector implementations
│   │   ├── routes/
│   │   ├── ws/                # Socket.io agent server
│   │   └── auth/
│   └── package.json
├── frontend/                  # React + Vite (Phase 3)
│   ├── src/
│   │   ├── components/
│   │   ├── pages/             # dashboard, templates, settings, task detail
│   │   └── hooks/
│   └── package.json
├── agent/                     # Windows agent — .NET 8 (Phase 3)
│   ├── src/
│   │   ├── AgentService.cs
│   │   ├── TaskSchedulerWrapper.cs
│   │   └── WebSocketClient.cs
│   └── installer/             # WiX
├── mcp-server/                # Phase 6
└── docker-compose.yml
```

> Create the `backend/`, `frontend/`, `agent/`, and `mcp-server/` folders only when starting their respective sprints. Don't scaffold all of them at the start of Phase 0.

---

## 5. Phase Documents

| Phase | Doc | Duration | Status |
|---|---|---|---|
| 0 — Inception & Discovery | [`docs/Phase0.md`](docs/Phase0.md) | 1–2 wk | Active |
| 1 — Requirements & Specs | [`docs/Phase1.md`](docs/Phase1.md) | 2–3 wk | Drafted |
| 2 — Architecture & Design | [`docs/Phase2.md`](docs/Phase2.md) | 2 wk | Drafted |
| 3 — Development (MVP) | [`docs/Phase3.md`](docs/Phase3.md) | 8–12 wk | Not started |
| 4 — Testing & QA | [`docs/Phase4.md`](docs/Phase4.md) | 2–3 wk | Not started |
| 5 — Deployment & Rollout | [`docs/Phase5.md`](docs/Phase5.md) | 1–2 wk | Not started |
| 6 — Post-Launch & Iteration | [`docs/Phase6.md`](docs/Phase6.md) | ongoing | Not started |

**When making material decisions** (e.g., choosing a connector pattern, redesigning the schema, changing the agent protocol), update the relevant phase doc — the docs are the spec, not an artifact.

---

## 6. Available Skills (use these proactively)

Invoke via `Skill` tool when the work matches.

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
- **`senior-qa`** — Phase 4 test strategy, E2E (Playwright), Vitest/Jest setup.
- **`web-performance-optimization`** — Phase 4–5; targets NFR1 (dashboard <2s).
- **`security-review`** — Phase 4 audit (API keys, agent auth, encryption at rest).

### DevOps & Infra
- **`senior-devops`** — Docker, ECS/Render, CI/CD pipelines, monitoring, secret management.

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

Configured in [`.mcp.json`](.mcp.json) at the project root (no extra setup needed):

- **`context7`** — fetch current docs for React, Prisma, Express, Socket.io, Tailwind, .NET, WiX. Use **before** writing code that touches an external library.
- **`github`** — once the repo is on GitHub, use for PR creation, reviews, issue tracking.
- **`playwright`** — Phase 4 E2E browser testing.
- **`serper`** — research for Phase 0 / Phase 6 (e.g., "does ChatGPT have a documented automations endpoint?").
- **`notion`** — optional: mirror phase docs / risk register to a Notion workspace.
- **`nanobanana`** — image generation if marketing/landing-page assets are needed in Phase 5.
- **`elevenlabs`** — voice generation (likely unused for this project).

Also available from the user environment: `mermaid-chart` (Phase 2 architecture diagrams), `ide` (diagnostics + code execution), `windows` (UI automation if any flow needs it).

---

## 8a. Project-Local `.claude/` Layout

```
.claude/
├── agents/         # 7 subagent definitions (matches §7 above)
│   ├── api-designer.md
│   ├── backend-designer.md
│   ├── frontend-designer.md
│   ├── frontend-developer.md
│   ├── fullstack-developer.md
│   ├── project-manager.md
│   └── technical-writer.md
├── commands/       # 3 custom slash commands
│   ├── create-architecture-documentation.md
│   ├── refactor-code.md
│   └── update-docs.md
├── rules/          # (empty — add project-specific rules as patterns emerge)
└── skills/         # 16 locally-installed skills (mirrors §6 above)
    ├── agent-tool-builder/
    ├── ai-agents-architect/
    ├── canvas-design/
    ├── code-reviewer/
    ├── frontend-design/
    ├── github-readme/
    ├── mobile-design/
    ├── obsidian-cli/
    ├── obsidian-markdown/
    ├── senior-data-scientist/
    ├── senior-devops/
    ├── senior-prompt-engineer/
    ├── senior-qa/
    ├── skill-writer/
    ├── ui-design-system/
    └── web-performance-optimization/
```

These are scoped to this project and override any same-named global skill/agent. Edit them in place when behavior needs to differ from the global default.

---

## 9. Domain Conventions

These are project-specific overrides on top of the parent workspace's general standards.

### Data model
- **All schedules stored as 5-field cron in UTC.** Display in the user's local timezone; convert on the way in/out.
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
- Tailwind `darkMode: 'class'`. Theme persists via `localStorage` keyed `taskhub.theme`.
- Use TanStack Query for all server state. Invalidate on WebSocket `task:updated` events.
- Mobile is a first-class target — every page must pass `<375px` viewport check.

### Security
- Secrets never in code. Use `.env.local` for dev, AWS Secrets Manager / Vault for prod.
- WebSocket: WSS only. JWT for users, pairing-secret-derived token for agents.
- No `0.0.0.0` binds in the agent. It's a *client*, not a server.

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

1. **Start of a session:** read this file + the active phase doc.
2. **Non-trivial change:** create a `TaskCreate` list, mark items `in_progress` / `completed` as you go.
3. **Material design decision:** update the phase doc *first*, then implement.
4. **External library question:** `context7` before writing.
5. **PR / large diff:** invoke the **`code-reviewer`** skill before declaring done.
6. **End of session:** if the phase advanced or any deliverable shifted, update `docs/Project_Plan.md` Status column.

---

## 12. Open Questions / Decisions Needed

(Move resolved items to the relevant phase doc.)

- [ ] Final hosting choice: AWS ECS vs. Render vs. self-hosted Docker. (Phase 2.)
- [ ] Agent transport: WebSocket only, or hybrid WebSocket + long-polling for restricted networks? (Phase 0 risk R4.)
- [ ] ChatGPT integration: full reverse-engineering effort, or stay quick-links-only forever? (Phase 6.)
- [ ] Will this app eventually live under `*.mikesailab.com`? If yes, pick the subdomain and reflect it in `michaelschecht.github.io/index.html`.

---

*Last updated: 2026-05-13.*
