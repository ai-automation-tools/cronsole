# 🔌 Agent Resilience

> **Covers:** F5.7, F6.4 · I3.4, I3.5, I3.6, I3.7 · R5.3 · U4.1, U4.5, U4.6, U5.6
> **Time:** ~20 min · **Needs:** the stack

Cronsole is local-first: the agent lives on your machine and **always dials out**. So the
interesting failures aren't crashes — they're **disconnects**, and whether the dashboard tells
you the truth while disconnected. A dashboard that shows stale "online" state is actively
dangerous: you'd trust a Run Now that goes nowhere.

Complete the [preflight](../README.md#-preflight--do-this-once-per-session) and
[Smoke Test](Smoke_Test.md) first. `$H` holds your auth header.

---

## 1. Baseline: agent is healthy

```powershell
Invoke-RestMethod http://localhost:3000/api/tasks/health -Headers $H | ConvertTo-Json -Depth 5
```

**Expect:** `WINDOWS_TASK_SCHEDULER` → `HEALTHY`.

## 2. ⭐ Offline is detected and surfaced

Open the dashboard, then stop the agent. It runs **elevated** (RunLevel Highest), so this
needs an **Administrator** PowerShell:

```powershell
Get-Process Cronsole.Agent -ErrorAction SilentlyContinue | Stop-Process -Force
```

**Expect, within ~60s:**
- The platform badge flips to **Offline**.
- **Run Now is disabled** — not spinning, not silently failing.
- Health reports `OFFLINE`:

```powershell
Invoke-RestMethod http://localhost:3000/api/tasks/health -Headers $H | ConvertTo-Json -Depth 5
```

> An unelevated shell gets `Access is denied` here — that's expected, not a finding. Use an
> admin prompt.

## 3. Actions fail honestly while offline

With the agent still down, force a run via the API:

```powershell
try {
  Invoke-RestMethod -Method Post "http://localhost:3000/api/tasks/<windows-task-id>/run" -Headers $H
} catch {
  $_.Exception.Response.StatusCode.value__
  $_.ErrorDetails.Message
}
```

**Expect:** a clean, **prompt** error naming the agent as unreachable. **Not** a 15s hang, and
**never** a success response. The DB must not record a run that never happened.

## 4. Reconnect is automatic

Restart the stack (this relaunches the agent hidden):

```powershell
pwsh .\scripts\cronsole.ps1 up
```

**Expect:** within ~30s, health returns to `HEALTHY` and the badge flips back **on its own** —
no page refresh, no manual repair.

## 5. Backoff doesn't hammer the server

Stop the **backend** and watch the agent's logs:

```powershell
docker compose stop backend
pwsh .\scripts\cronsole.ps1 logs
```

**Expect:** reconnect attempts spaced by **exponential backoff — 1s → 2s → 4s → … capped at
5min**. A tight retry loop is a finding. Bring it back:

```powershell
docker compose start backend
```

**Expect:** the agent reconnects and **re-registers** on its own.

## 6. ⭐ The transient-agent trap

The one that will bite you during your own testing. Start a second, transient agent:

```powershell
$env:CRONSOLE_AGENT_ID = 'dogfood-agent'
dotnet .\agent\publish\Cronsole.Agent.dll
```

Let it connect, then stop it (Ctrl+C).

**Expect (the current, known behavior):** Windows now reports `OFFLINE` and **stays** that way
— even though the real agent process is still running. The backend maps **one agent socket per
user**; the transient agent became *the* agent, and when it left, the real agent's socket was
still alive from its own point of view, so it never re-registered.

**Recovery** — drop all agent sockets so the real agent reconnects:

```powershell
docker compose restart backend
Invoke-RestMethod http://localhost:3000/api/tasks/health -Headers $H | ConvertTo-Json -Depth 5
```

**Expect:** `HEALTHY` within ~15s. Full write-up:
[troubleshooting #5](../../../troubleshooting/README.md#5-windows-offline-after-running-a-transient-test-agent).

> [!TIP]
> This is **documented behavior, not a passing test.** If you're testing whether it's been
> *fixed*, the pass condition is the opposite: the real agent recovers **without** a backend
> restart.

## 7. Version skew fails loudly

Confirm the agent is running current code. If you've changed agent source, republish it — from
an **Administrator** prompt (the running exe is locked):

```powershell
Get-Process Cronsole.Agent -ErrorAction SilentlyContinue | Stop-Process -Force
dotnet publish ".\agent\Cronsole.Agent" -c Release -r win-x64 --self-contained false -o ".\agent\publish"
pwsh .\scripts\cronsole.ps1 up
```

**Expect:** a new agent command against a **stale** agent produces a clear timeout error, not a
silent no-op. The tell that this is skew and not a missing route: the route **exists** (a bad
id returns `{"error":"Task not found"}`, not an Express "Cannot GET"), and only the
**agent-backed** path times out — a DB-only Cronsole-native path works instantly. See
[troubleshooting #7](../../../troubleshooting/README.md#7-new-agent-command-502-times-out-until-the-agent-is-republished).

## 8. Failure notifications fire

Configure a webhook (generic / Discord / ntfy), then run a task that **exits non-zero**.

**Expect:**
- The notification **arrives**, and is readable — task name, failure, timestamp.
- The UI shows a red failure and the detail log appends **stderr**, so the user learns *why*.
- A **dead** webhook endpoint doesn't take the run down with it — delivery failure is logged,
  not fatal.

Cover both **manual** and **scheduled** native runs — they're separate paths.

## 9. Stale-run pruning

Leave the stack idle after killing an agent mid-run.

**Expect:** the stale-pruning guard clears orphaned "running" state rather than leaving a task
pinned as running forever. Cross-check
[`artifacts/taskhub_resilience_2026-07-10.md`](../../../../artifacts/taskhub_resilience_2026-07-10.md).

## 10. Survives a reboot

Reboot the machine. Log in. **Touch nothing.**

**Expect:** the stack comes up at logon, the agent reconnects, the dashboard shows live data —
and **no console window flashes** during startup. This is the real "does it work for a user"
test: they will reboot, and they won't run a script afterward.

---

## ✅ Pass criteria

- [ ] Offline detected within ~60s; Run Now disabled (2)
- [ ] Offline actions fail promptly and honestly (3)
- [ ] Reconnects automatically within ~30s (4)
- [ ] Backoff is exponential, capped at 5min (5)
- [ ] Transient-agent trap behaves as documented, recovers on backend restart (6)
- [ ] Version skew fails loudly (7)
- [ ] Notifications arrive; dead webhook is non-fatal (8)
- [ ] No task pinned "running" forever (9)
- [ ] Clean reboot → self-healing stack, no flash (10)

## 🧹 Cleanup

```powershell
Remove-Item Env:\CRONSOLE_AGENT_ID -ErrorAction SilentlyContinue
pwsh .\scripts\cronsole.ps1 up
Invoke-RestMethod http://localhost:3000/api/tasks/health -Headers $H | ConvertTo-Json -Depth 5
```

Confirm you're back to `HEALTHY` before moving on — a half-restarted agent will make the next
runbook lie to you.

---

<p align="center">
  <a href="Template_Apply.md">← Template Apply</a> ·
  <a href="../README.md">Manual Testing</a> ·
  <a href="Security_Checks.md">Security Checks →</a>
</p>
