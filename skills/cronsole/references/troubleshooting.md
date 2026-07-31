# Troubleshooting

Load when something won't build, boot, connect, or authenticate.

> **[`docs/troubleshooting/README.md`](../../../docs/troubleshooting/README.md) is canonical**
> — symptom → cause → fix, with full commands. **Check it first.** This file is the triage
> layer: how to tell these apart fast, and the meta-lessons behind them.

## Triage: read the tell, not the error

Most Cronsole "impossible" behavior is one of seven known traps. The **tell** distinguishes
them faster than the error text does.

| Tell | It's this |
|:---|:---|
| Compiled build works (`npm run build && npm start`), dev crash-loops with `[Object: null prototype]` | **#1** — the dev *runner*. `ts-node` can't parse TS 6. Already fixed: dev runs on **`tsx`**. |
| `403 Invalid or expired token`, or agent rejected at handshake | **#2** — Docker's **dev-only default secrets** vs. your rotated `backend/.env`. |
| Port `LISTENING` but `curl` returns `HTTP 000`; or `EADDRINUSE` on local start | **#3** — Docker's port proxy holds the port while the app inside crashed. **Don't chase the port; read `docker logs`.** |
| `npm run build` passes and offline suites are green, but a live request disagrees with the source | **#4** — `tsx watch` never saw your edit (Windows→Linux bind mount, no inotify). |
| Windows `OFFLINE` forever after you stopped a transient/dogfood agent, though the real agent runs | **#5** — the transient agent displaced the real one's socket registration. |
| `.ps1` fails to parse under `powershell` (5.1) but runs fine under `pwsh` (7); errors point at EOF | **#6** — a **non-ASCII char in a BOM-less UTF-8 script**. |
| New agent command 502s "Agent … timeout" (~15s), but the route **exists** and DB-only paths work | **#7** — the **agent is running the old published exe**. |

## The three meta-lessons

Internalize these and you'll diagnose new problems faster than the table can.

### 1. Two processes run stale, and they reload differently

This is the single most expensive class of confusion in this repo.

- The **backend** is a Docker container with source bind-mounted. Windows→Linux bind mounts
  **don't propagate file-change events**, so `tsx watch` never fires. The container can be
  "up 2 hours" and still be running pre-edit code. → `docker restart taskhub-backend-1`
- The **agent** is a **host process running a published exe**. It **never** hot-reloads. Until
  you rebuild + republish, it has no handler for your new command, never answers, and the
  backend's 15s wait times out to a 502. → republish (admin prompt required)

**Rule: when live behavior contradicts source, suspect the process before the logic.**

### 2. A liveness signal is not a health signal

`LISTENING` doesn't mean "answering" (#3). "Container up" doesn't mean "running your code"
(#4). "Agent process alive" doesn't mean "registered" (#5). Each of these is a proxy that can
be true while the thing it proxies is false.

**Check the thing, not the proxy.** `/api/health` proves the process answers — not that the DB
or agent is fine. That's what `/api/tasks/health` is for.

### 3. The environment lies in exactly one direction

`pwsh` 7 is more permissive than Windows PowerShell 5.1 (#6). The compiled path is more
permissive than the dev runner (#1). A green offline suite is more permissive than a live
request (#4).

**So: verify in the strictest environment that will actually run the code.** A pwsh-based
syntax check passing tells you nothing about 5.1.

## The elevation constraint

Cuts across several traps. The real agent runs **elevated** (RunLevel Highest):

- An **unelevated shell can't `Stop-Process` it** (`Access is denied`) — that's expected, not
  a finding.
- `dotnet publish` **can't overwrite the locked exe** while it runs.
- So: republishing needs an **Administrator** prompt — stop, publish, relaunch.
- For a quick dogfood, **don't fight it** — run a *transient* agent instead, then
  `docker compose restart backend` when you're done to hand the connection back. (That restart
  is the fix for #5, which the transient agent causes.)

## Diagnosing something new

1. **Check `docs/troubleshooting/README.md` first.** Seriously.
2. **Isolate the layer.** DB-only path (Cronsole-native) vs. agent-backed path (Windows) is the
   sharpest split available — if native works and Windows hangs, it's the agent.
3. **Distinguish "route missing" from "handler missing":** a bad id returning your handler's
   `{"error":"Task not found"}` means the route exists (so it's the agent, #7); an Express
   "Cannot GET" means the backend is stale (#4).
4. **Read `docker logs taskhub-backend-1`** before theorizing.
5. **Restart the stale things** and retest before debugging logic.

## Adding an entry

When you solve a new one that **took real digging or is likely to recur**, add it to
`docs/troubleshooting/README.md` while it's fresh. Keep it short and greppable:

1. **Symptom** — exact error text / observable behavior (searchable)
2. **Cause** — the underlying reason **and the tell** that distinguishes it
3. **Fix** — the concrete commands
4. Add a row to the **Quick lookup** table and date it (`*First hit: YYYY-MM-DD.*`)

Then ask whether it can become a **regression test**. Every entry in that file is a bug that
escaped to a human — it's the highest-quality test backlog in the repo.
