# Phase 6: Post-Launch & Iteration

**Duration:** Ongoing
**Status:** Not started
**Master plan:** [`Project_Plan.md`](Project_Plan.md)
**Predecessor:** [`Phase5.md`](Phase5.md)
**Informed by:** [`Business_Idea_Assessment.md`](Business_Idea_Assessment.md)

---

> **Expansion discipline (per the assessment).** The #1 execution threat is becoming a connector-maintenance project instead of a product. Therefore expansion is governed by **hard roadmap gates tied to reliability metrics, not connector count**:
>
> **Gate:** a new connector / major feature ships only when the *existing* set holds its KPIs — **sync reliability > 95%**, **agent crash rate < 2% (7-day)**, and **zero open P0/P1**. If a quarter's reliability slips below target, connector work pauses and reliability work takes priority. MCP stays pitched as "coming soon" until it is genuinely production-ready, not GA-day vaporware.

## Goal

Operate, improve, and expand TaskHub after GA. The headline post-MVP capability is **MCP-based AI task creation** — letting Claude / Codex / Cursor list, run, and create scheduled tasks via natural language. Beyond that, add platform connectors, advanced visualization, and community features — **each subject to the reliability gate above.**

---

## Workstreams

### 1. MCP Integration (priority feature)

Build an MCP server that wraps the existing REST API so AI assistants can drive TaskHub.

**Tools exposed**

| Tool | Description | Scope |
|---|---|---|
| `list_tasks` | Return all tasks for the authenticated user | read |
| `run_task(task_id)` | Trigger a task | run |
| `create_task(platform, name, schedule_expression, command)` | Create a task on a connected platform | write |
| `update_task(task_id, ...)` | Edit a task | write |
| `delete_task(task_id)` | Delete a task (where supported) | write |
| `convert_schedule(source_platform, target_platform, expression)` | Return converted schedule + warnings | read |
| `list_platforms` | Return connected platforms with status | read |

**Auth model**
- User generates an MCP API key in Settings → MCP.
- Each key carries a scope subset: `read`, `run`, `write`.
- Keys are revocable; each one tracks last-used timestamp.

**Implementation notes**
- New folder: `mcp-server/` (Node.js + `@modelcontextprotocol/sdk`).
- Reuses the same `PlatformConnector` registry — never reach around the connector layer.
- Tool descriptions matter as much as code (see **`agent-tool-builder`** skill).
- Ship `claude_desktop_config.json` snippet and `mcp install` instructions in the docs.

**Skill / agent playbook**
- **`claude-api`** — Anthropic SDK + caching patterns.
- **`agent-tool-builder`** — schema and description authoring.
- **`ai-agents-architect`** — if orchestration grows beyond simple tool wrappers.
- **`senior-prompt-engineer`** — sample prompts for the docs ("Run my backup", "Create a task to do X every Monday").

---

### 2. Additional Platform Connectors

Each new connector follows the same pattern as Windows + Claude in Phase 3 — and **ships only through the reliability gate** (existing connectors must hold their KPIs first). Prefer **fewer, deeper, high-confidence connectors** over a broad shallow checklist; a connector that can't be made reliable stays quick-links-only rather than shipping as a half-integration.

| Connector | Difficulty | Notes |
|---|---|---|
| ChatGPT Automations | High | No public API at the time of writing; may require browser automation or wait for OpenAI to ship one. Until then: quick links only. |
| Jules (Google) | Medium | Pending API documentation review. |
| Open Claw | Unknown | Survey first. |
| Hermes | Unknown | Survey first. |
| GitHub Actions scheduled workflows | Medium | Treat workflows with `schedule:` triggers as tasks. |
| n8n / Make.com | Medium | Webhook-based discovery. |

Each new connector ships with: schema migration (extend `PlatformType` enum), connector class, settings UI, smoke tests, docs page.

---

### 3. Advanced Schedule Visualizer

Calendar view + Gantt view of upcoming runs across all platforms.

- Use `@fullcalendar/react` or `react-big-calendar`.
- Backend endpoint `/api/v1/schedule/preview?from=...&to=...` returns flattened `(task_id, runs_at)` tuples.
- Cross-platform dependency chains: declare "Task B runs after Task A succeeds" with optional delay.

---

### 4. Public Template Gallery

- User-submitted templates with moderation queue.
- Upvotes, comments, fork count.
- Category tags (Backup, Reporting, Data sync, …).
- Featured templates curated by Mike.

---

### 5. Two-Way Sync

Where the platform supports it (Windows agent always; Claude via API), edits in the TaskHub UI propagate back to the platform.

- New connector method: `updateTask(externalId, changes)`.
- Conflict policy: last-writer-wins with a banner if a remote change was overwritten.

---

### 6. Operational Hardening

- Cost dashboard (RDS + ECS + CloudFront spend with per-feature attribution).
- Audit log of admin actions (key generation, account deletion, template moderation).
- SSO support (Google / Microsoft) — opens the door to enterprise tier.
- Optional enterprise features: org accounts, role-based access, shared template libraries.

---

## Cadence

- **Monthly release cycle** (`v1.1.0`, `v1.2.0`, …) — feature minors.
- **Weekly patch window** for fixes.
- **Quarterly retro** with beta users; update KPI dashboard.
- **Community management** for template submissions: triage queue weekly.

---

## Feedback Loops

- GitHub issues (bug + feature templates).
- In-app feedback widget routes to a private channel.
- Status page (`status.taskhub.app`) for incidents.
- Optional anonymous telemetry (opt-in) — error stack traces, page load times, no PII.

---

## Risk Watch

- **API churn** — Anthropic / OpenAI / Google may change schedule endpoints. The connector abstraction shields the rest of the app; budget engineering time each quarter for connector maintenance.
- **MCP scope creep** — Phase 0 listed this as `Medium / Medium`. Stay disciplined: ship the seven tools above before adding anything more exotic. Keep it "coming soon" externally until it's production-ready.
- **Scope creep / connector sprawl (R7)** — the assessment's top execution risk. The reliability gate above is the control: connector count never leads reliability. Track it explicitly in the quarterly retro.
- **Agent EOL** — Windows agent depends on `Microsoft.Win32.TaskScheduler` and .NET 8. Track .NET LTS roadmap; plan a `.NET 10` upgrade well before .NET 8 EOL.

---

## Future / Stretch

- Native mobile apps (iOS + Android) — likely React Native to share UI patterns.
- Slack / Teams / Discord notifications for task failures.
- AI-suggested templates (Claude reviews your task list and proposes optimizations).
- Multi-machine awareness: a single account managing agents across many Windows hosts.

---

## Phase 6 Definition of "Done"

Phase 6 is intentionally open-ended — there is no exit criteria. The phase is healthy when:

- Monthly releases ship on schedule.
- Critical bug median time-to-fix < 7 days.
- KPI dashboard meets or exceeds Phase 0 targets (sync reliability > 95%, crash rate < 2%, connect-2-systems < 15 min).
- New platform connectors are added **only through the reliability gate** — without destabilizing existing ones or dropping below KPI.
