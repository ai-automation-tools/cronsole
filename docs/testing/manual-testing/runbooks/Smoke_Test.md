# 🔥 Smoke Test

> **Covers:** F1.1, F5.6, F6.3 · I6.5 · U2.1
> **Time:** ~10 min · **Needs:** the stack (no Windows-specific steps)

The gateway runbook. If this fails, **stop** — every other runbook assumes it passes. It
answers one question: *is the whole stack actually alive and talking to itself?*

Complete the [preflight](../README.md#-preflight--do-this-once-per-session) first. Steps below
assume `$H` holds your auth header.

---

## 1. Every service is up

```powershell
pwsh .\scripts\taskhub.ps1 status
```

**Expect:** one table, every row up — Postgres, Redis, backend (`:3000`), frontend (`:7373`),
agent. The whole point of this script is that you don't have to wonder which part is down.

> Anything down → `pwsh .\scripts\taskhub.ps1 up`, then re-check. Still down →
> `pwsh .\scripts\taskhub.ps1 logs`.

## 2. Backend answers

```powershell
Invoke-RestMethod http://localhost:3000/api/health
```

**Expect:** a `200`. This is unauthenticated — it only proves the process is answering, not
that the DB or agent is fine.

## 3. Auth gate is closed

```powershell
try { Invoke-RestMethod http://localhost:3000/api/tasks -Headers @{ Authorization = 'Bearer garbage' } }
catch { $_.Exception.Response.StatusCode.value__ }
```

**Expect:** `403`. A `200` here is a **critical finding** — the auth gate is open.

## 4. Authed request works

```powershell
$tasks = Invoke-RestMethod http://localhost:3000/api/tasks -Headers $H
$tasks.Count
```

**Expect:** an array (empty is fine on a clean install). A `403` means token/secret mismatch —
[troubleshooting #2](../../../troubleshooting/README.md#2-403-invalid-or-expired-token-or-agent-rejected).

## 5. Database round-trip

The `/api/tasks` call above already proved Prisma can reach Postgres. Confirm directly:

```powershell
docker exec taskhub-db-1 psql -U cronsole -d cronsole -c 'SELECT COUNT(*) FROM "Task";'
```

**Expect:** a count matching step 4. Table names are **PascalCase and quoted** — Prisma
doesn't map them to snake_case.

## 6. Agent is online

```powershell
Invoke-RestMethod http://localhost:3000/api/tasks/health -Headers $H | ConvertTo-Json -Depth 5
```

**Expect:** `WINDOWS_TASK_SCHEDULER` with health `HEALTHY`.

**If `OFFLINE`:** the most likely cause is the transient-agent trap — a second agent you ran
for testing stole the socket registration and the real agent never re-registered. Fix:

```powershell
docker compose restart backend
```

Windows returns to `HEALTHY` within ~15s. Full explanation:
[troubleshooting #5](../../../troubleshooting/README.md#5-windows-offline-after-running-a-transient-test-agent).

## 7. Sync pulls real tasks

```powershell
Invoke-RestMethod -Method Post http://localhost:3000/api/tasks/sync -Headers $H
Start-Sleep -Seconds 3
(Invoke-RestMethod http://localhost:3000/api/tasks -Headers $H).Count
```

**Expect:** the count reflects tasks the agent actually found. This is the **whole chain**
working: `sync` → server `task:scan` → agent scans → `agent:tasks:list` → DB upsert.

## 8. Frontend loads

Open <http://localhost:7373>.

**Expect:**
- Dashboard renders **dark** (dark is the default; light is the toggle).
- Tasks from step 7 are visible, with real names/schedules.
- The Windows platform shows **online**.
- No red errors in the browser console.

## 9. Live updates land

With the dashboard open, run a sync from a **second** terminal:

```powershell
Invoke-RestMethod -Method Post http://localhost:3000/api/tasks/sync -Headers $H
```

**Expect:** the dashboard updates **without a manual refresh** — the `task:updated` socket
event invalidates the TanStack Query cache. If you have to hit F5, that's a finding.

## 10. Dashboard load time

DevTools → Network → **Disable cache** → Fast 3G → reload.

**Expect:** interactive in **< 2s** (NFR1). Record the number — there's no automated gate on
this, so this reading *is* the measurement. Compare against
[`artifacts/cronsole_performance_2026-07-10.md`](../../../../artifacts/cronsole_performance_2026-07-10.md).

---

## ✅ Pass criteria

- [ ] All services up (1)
- [ ] Backend answers, auth gate closed (2–3)
- [ ] Authed request + DB round-trip agree (4–5)
- [ ] Agent `HEALTHY` (6)
- [ ] Sync pulls real tasks (7)
- [ ] Dashboard renders dark with live data, no console errors (8)
- [ ] Live update lands with no refresh (9)
- [ ] Load < 2s on Fast 3G (10)

## 🧹 Cleanup

None — this runbook is read-only apart from a sync.

---

<p align="center">
  <a href="../README.md">← Manual Testing</a> ·
  <a href="Windows_Task_Lifecycle.md">Windows Task Lifecycle →</a>
</p>
