<a id="manual-top"></a>

<h1 align="center">🖐️ Manual Testing</h1>

<p align="center">
  <em>Step-by-step runbooks for the things no suite can prove — real COM, real Windows, real eyes.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/format-copy_·_paste_·_compare-F59E0B?style=for-the-badge" alt="Format">
  <img src="https://img.shields.io/badge/covers-the_⬜_gaps-EF4444?style=for-the-badge" alt="Covers">
  <a href="../README.md"><img src="https://img.shields.io/badge/↩-testing_home-6B7280?style=for-the-badge" alt="Testing Home"></a>
</p>

---

Some things genuinely can't be automated cheaply — or at all. Real Task Scheduler COM, the
Docker stack booting from a clean checkout, whether a PowerShell window flashes, whether the
dashboard *looks* right. This folder is where those live as **runbooks you can follow without
thinking**: exact commands, exact expected output.

**These runbooks exist to close the ⬜ rows** in [functional](../functional-testing/README.md),
[integration](../integration-testing/README.md), and [regression](../regression-testing/README.md).
Each one names the IDs it covers.

> [!NOTE]
> **Manual testing ≠ [UAT](../uat/README.md).** These runbooks are mechanical verification —
> *does the machine do the thing?* UAT asks *would a person accept it?* Same hands, different
> question. Run these when you need proof; run UAT when you need judgment.

## 📋 The runbooks

| Runbook | What it verifies | Time | Needs |
|:---|:---|:--|:---|
| [**🔥 Smoke Test**](runbooks/Smoke_Test.md) | The stack is alive and the agent is talking. **Gateway for everything below** | ~10 min | Stack |
| [**🪟 Windows Task Lifecycle**](runbooks/Windows_Task_Lifecycle.md) | Create → run → edit → disable → delete against **real Task Scheduler** | ~25 min | Stack + Windows |
| [**📄 Template Apply**](runbooks/Template_Apply.md) | Params, preview, the 409 duplicate guard, and a real applied task | ~20 min | Stack + Windows |
| [**🔌 Agent Resilience**](runbooks/Agent_Resilience.md) | Offline detection, reconnect/backoff, the transient-agent trap | ~20 min | Stack |
| [**🔐 Security Checks**](runbooks/Security_Checks.md) | Encryption at rest, tenant isolation, no-shell — verified **in the database** | ~20 min | Stack + psql |

## 🚦 Preflight — do this once per session

Every runbook assumes these three things. Do them first.

### 1. Start the stack

```powershell
pwsh .\scripts\taskhub.ps1 up
pwsh .\scripts\taskhub.ps1 status
```

`status` should show every service up: Postgres, Redis, backend (`:3000`), frontend
(`:7373`), and the agent.

### 2. Confirm the backend is alive

```powershell
Invoke-RestMethod http://localhost:3000/api/health
```

`/api/health` is **unauthenticated** — it's a liveness probe, so a `200` here only proves the
process is answering.

> If the port listens but nothing answers (`HTTP 000`), the app crashed behind Docker's port
> proxy — see [troubleshooting #3](../../troubleshooting/README.md#3-port-listening-but-http-000--eaddrinuse).

### 3. Get a dev token

Every `/api/tasks/*` and `/api/templates/*` route is auth-gated. Grab the token from
`frontend/.env.local` (`VITE_DEV_TOKEN`), or mint one signed with the backend's `JWT_SECRET`:

```powershell
cd backend
node -r dotenv/config -e "console.log(require('jsonwebtoken').sign({id:'cli_user_placeholder',email:'mike@example.com'}, process.env.JWT_SECRET, {expiresIn:'3650d'}))"
```

Then keep it in a variable for the session:

```powershell
$env:TH_TOKEN = '<paste token>'
$H = @{ Authorization = "Bearer $env:TH_TOKEN" }
```

Verify it works:

```powershell
Invoke-RestMethod http://localhost:3000/api/tasks -Headers $H
```

**Expect:** a JSON array of tasks (possibly empty). A **403 `Invalid or expired token`** means
your token was signed with a different secret than the running backend is using — the classic
Docker-defaults mismatch, see [troubleshooting #2](../../troubleshooting/README.md#2-403-invalid-or-expired-token-or-agent-rejected).

## 🗺️ Endpoint cheat sheet

Handy while working through the runbooks. Everything except `/api/health` and `/api/auth/*`
requires the `Authorization: Bearer` header.

| Method | Route | What it does |
|:---|:---|:---|
| `GET` | `/api/health` | Liveness (**no auth**) |
| `GET`/`POST` | `/api/auth/status` · `/setup` · `/login` | Auth (**no auth**). `/setup` is first-run only; there is no `/register`. |
| `GET` | `/api/tasks` | List tasks |
| `GET` | `/api/tasks/health` | **Per-platform** health (`HEALTHY` / `OFFLINE`) |
| `POST` | `/api/tasks/sync` | Trigger a scan |
| `POST` | `/api/tasks/:id/run` | Run Now |
| `PATCH` | `/api/tasks/:id/status` | Enable / disable |
| `PATCH` | `/api/tasks/:id/schedule` | Edit schedule |
| `PATCH` | `/api/tasks/:id/actions` | Edit command / settings |
| `GET` | `/api/tasks/:id/export` | Export (Windows → XML, native → JSON) |
| `GET` | `/api/tasks/:id/executions` | Run history |
| `DELETE` | `/api/tasks/:id` | Delete |
| `POST` | `/api/tasks/native` | Create a Cronsole-native task |
| `POST` | `/api/tasks/:id/save-as-template` | Save task as template |
| `POST` | `/api/tasks/:id/untrack` | Remove from Cronsole, leave the platform entry running |
| `POST` | `/api/tools/export/tasks` | **Bulk** export — the whole machine or one folder (`format: 'zip' \| 'files'`) |
| `POST` | `/api/tools/restore/tasks` | Restore from a backup. **Send `dryRun: true` first** — it returns the plan and writes nothing |
| `GET` | `/api/templates` · `/api/templates/discover` | List / browse catalog |
| `POST` | `/api/templates/:id/preview` | Score the schedule→trigger conversion → `{ score, warnings, trigger }` |
| `POST` | `/api/templates/:id/apply` | Apply → create a real task |
| `POST` | `/api/templates/:id/favorite` · `DELETE` same | Favorites |
| `GET` | `/api/templates/export` · `POST` `/api/templates/import` | Catalog import/export |

### Payload shapes worth pinning down

The two easiest to get wrong (`platform` is **required** on both, and the name field is
`name` — not `taskName`):

```jsonc
// POST /api/templates/:id/apply
{
  "platform": "WINDOWS_TASK_SCHEDULER",  // required; also arms the duplicate-name guard
  "name": "my-task",                     // optional — defaults to the template's name
  "schedule": "0 3 * * *",               // 5-field cron, UTC (or "scheduleExpression")
  "parameters": { }                      // raw values; the SERVER substitutes {{placeholders}}
  // "command" also exists but is DEPRECATED (pre-substituted, legacy clients only)
}

// POST /api/templates/:id/preview  → { score, warnings[], trigger }
{
  "platform": "WINDOWS_TASK_SCHEDULER",
  "schedule": "0 3 * * *"
}
```

`platform` accepts any `PlatformType`: `WINDOWS_TASK_SCHEDULER`, `TASKHUB_NATIVE`,
`CLAUDE_CODE`, `MACOS_LAUNCHD`, `CHATGPT`, `JULES`, `OPEN_CLAW`, `HERMES` — but only
**Windows** and **Cronsole-native** have real compilers today.

## ✍️ Conventions

Every runbook uses the same shape, so you can follow one half-asleep:

- **Numbered steps** — one action each.
- **Expect:** what you should see. If you see something else, that's a finding.
- **Cleanup** — every runbook that creates state removes it. Never leave test tasks in Task Scheduler.
- **Covers:** the test IDs from the other layers, so coverage stays traceable.

> [!IMPORTANT]
> **Two stale-process traps will waste your afternoon** if you don't know them. Before
> concluding "the code is broken":
> 1. **Backend edits don't hot-reload in Docker** (Windows→Linux bind mounts don't propagate
>    inotify). `docker restart taskhub-backend-1` — [#4](../../troubleshooting/README.md#4-backend-source-edits-not-picked-up-in-docker).
> 2. **The .NET agent never hot-reloads.** A new `task:*` command 502s until you republish it
>    — [#7](../../troubleshooting/README.md#7-new-agent-command-502-times-out-until-the-agent-is-republished).

## ➕ Adding a runbook

Add one when you hit something that **can't** be automated, or that burned you once and will
again. Keep it copy-pasteable — a runbook you have to interpret is a runbook nobody runs.

1. Write it as numbered steps with an **Expect:** after each.
2. Cite the test IDs it covers, and flip those rows in the layer README to point here.
3. Add a row to the runbook table above.
4. If a step is really an automatable check, **automate it instead** and delete the step. This
   folder should shrink over time, not grow.

<p align="right">(<a href="#manual-top">back to top</a>)</p>

---

<p align="center">
  <a href="../README.md">← Testing Home</a> ·
  <a href="../functional-testing/README.md">Functional</a> ·
  <a href="../integration-testing/README.md">Integration</a> ·
  <a href="../regression-testing/README.md">Regression</a> ·
  <a href="../uat/README.md">UAT</a>
</p>
