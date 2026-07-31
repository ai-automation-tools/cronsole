<a id="troubleshooting-top"></a>

<h1 align="center">🧯 Troubleshooting</h1>

<p align="center">
  <em>Symptom → cause → fix for problems we've actually hit running Cronsole.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/format-symptom_first-EF4444?style=for-the-badge" alt="Symptom first">
  <a href="../README.md"><img src="https://img.shields.io/badge/↩-docs_home-6B7280?style=for-the-badge" alt="Docs Home"></a>
</p>

---

Hit something weird? **Scan the symptom table**, jump to the entry, apply the fix. If you
solve a *new* problem — especially one that took more than a few minutes or that we're likely
to hit again — **add it here** while it's fresh (template at the bottom).

## 🔎 Quick lookup

| # | Symptom | Likely cause | Jump |
|:--|:---|:---|:--|
| 1 | Backend crash-loops on startup with an opaque `[Object: null prototype] {}` uncaught exception | `ts-node` can't parse the installed TypeScript version | [→](#1-backend-crash-loops-with-object-null-prototype) |
| 2 | Dashboard shows no tasks / `403 Invalid or expired token`; agent handshake rejected | Docker's default secrets don't match your rotated `backend/.env` | [→](#2-403-invalid-or-expired-token-or-agent-rejected) |
| 3 | Port 3000 shows as `LISTENING` but every request returns `HTTP 000` / `EADDRINUSE` on restart | Docker's port proxy holds the port even though the app process died | [→](#3-port-listening-but-http-000--eaddrinuse) |
| 4 | Edited backend source, but the running Docker stack still 404s the new route / serves old behavior | `tsx watch` inside the container never sees the file change (Windows→Linux bind-mount inotify) | [→](#4-backend-source-edits-not-picked-up-in-docker) |
| 5 | After running a second/transient agent for testing, Windows shows `OFFLINE` and won't recover even though the real agent process is still running | The transient agent displaced the real agent's socket registration; the idle real agent won't re-register until its socket drops | [→](#5-windows-offline-after-running-a-transient-test-agent) |
| 6 | A `.ps1` fails to parse under `powershell` (5.1) with `Unexpected token '}'` / `The string is missing the terminator` — but runs fine under `pwsh` (7) | A non-ASCII char (e.g. an em-dash `—`) in a BOM-less UTF-8 script; Windows PowerShell 5.1 reads it as ANSI and decodes it into a curly quote it treats as a string delimiter | [→](#6-ps1-parse-errors-under-windows-powershell-51-only) |
| 7 | A newly added agent command (e.g. a new `task:*` socket op) returns `502` with `... timeout` after ~15s, even though the backend route exists | The **.NET agent is a host process running the old published exe** — it doesn't hot-reload, so it has no handler for the new command and never answers; the backend times out | [→](#7-new-agent-command-502-times-out-until-the-agent-is-republished) |
| 8 | **Every** MCP tool returns `403 Invalid or expired token` — or the `cronsole` tools are **missing entirely** — while the dashboard and `curl` with a real token work fine | `CRONSOLE_TOKEN` is unset, so Claude Code passed the **literal** `${CRONSOLE_TOKEN}` through to the API — nothing is actually expired. Since the server now refuses to start on a literal, the tools go *missing* rather than 403 | [→](#8-every-mcp-tool-returns-403-invalid-or-expired-token) |
| 8a | …and the token **is** set at the User level, you restarted, and it's *still* invisible | A new terminal is not a new environment. A VS Code integrated terminal inherits `Code.exe`'s environment block, snapshotted when VS Code launched — new tabs and host restarts re-inherit the same stale one | [→](#8a-and-restart-from-a-fresh-terminal-does-nothing-under-vs-code) |
| 9 | A new agent command returns a well-formed payload where **every field is empty/false** — no error, no exception, the counts are even right | The agent emitted a C# object directly; the socket serializer does **not** camelCase, so the wire carries `Path`/`TaskCount` while the backend reads `f.path` → `undefined` for every field | [→](#9-agent-payload-arrives-with-every-field-empty) |
| 10 | `DeleteFolder` on a Task Scheduler folder fails with `Access is denied. (0x80070005 (E_ACCESSDENIED))` | Task Scheduler folder deletion requires **elevation**, even for a folder you created and even when it is empty | [→](#10-cannot-delete-a-task-scheduler-folder-e_accessdenied) |
| 11 | After a **System Restore**, `Start-ScheduledTask` says the republish task doesn't exist **and/or** the `cronsole` MCP tools vanish — while the repo, `git status`, and the build are all perfectly clean | Both live on `C:` as per-machine state git can't protect: the scheduled-task registration and the `CRONSOLE_TOKEN` **User** env var. A restore of `C:` wipes them; a repo on another drive survives, so nothing *looks* wrong | [→](#11-after-a-system-restore-the-republish-task-and-mcp-tools-are-gone) |
| 12 | A task created from a template sits in `Running` **forever** (`LastTaskResult` `267009`), burning no CPU — while Cronsole cheerfully reports `lastRunStatus: SUCCESS`, and every test passes | The command is broken **on the target**, which no test checks. Classic cause: `Invoke-WebRequest` without `-UseBasicParsing` needs the **IE engine Windows 11 removed** → `NullReferenceException`, and with no console to write it to, the process blocks instead of exiting | [→](#12-a-template-passes-every-test-and-still-hangs-on-the-target) |
| 13 | The `cronsole` MCP tools are **missing** — and the token is fine: it's set, the host can see it, the backend is healthy, and `node mcp-server/dist/index.js` boots clean by hand | The server is **disabled in the host**, not broken. `disabledMcpjsonServers` in `.claude/settings.local.json` lists it — that's what Claude Code writes for **every** server in `.mcp.json` when you decline the "do you trust this project's MCP servers?" prompt | [→](#13-the-cronsole-mcp-tools-are-missing-while-the-token-is-fine) |
| 14 | You picked a **deliberately rare** cron (annual, Feb 30, a specific date) so a test task couldn't fire on its own — and it fires **hourly, every day**, forever | Any cron the converter doesn't recognize falls back to a **hard-coded hourly** trigger. The schedule is *replaced*, not approximated, and the fallback only ever runs **more** often, never less. The warning now says so outright (fixed 2026-07-15) — but the **score is still `0.7`**, the same as a genuinely-approximate step | [→](#14-a-rare-cron-becomes-an-hourly-trigger) |
| 15 | `run_task` on a **disabled** task hangs ~15s then fails `Agent trigger timeout` — while the agent is connected and healthy, and every other command works | The agent's `task:run` only replied on **success**: any failure (disabled, missing, ACL) wrote to a console nobody reads and emitted nothing, so the backend could only time out and blame the transport. Fixed 2026-07-15 — **needs an agent republish** | [→](#15-run_task-times-out-instead-of-saying-the-task-is-disabled) |
| 16 | The **second** of two identical agent commands within one second is silently dropped — 15s, then `Agent trigger timeout`. A second later, the same command works | Signed commands carried a **second-granular** `ts` and nothing else unique, so two identical commands in the same second were byte-identical — and the agent's **replay guard** couldn't distinguish your re-send from an attack. **Fixed 2026-07-15** with a per-command nonce; needs backend + agent shipped together | [→](#16-a-second-identical-agent-command-within-one-second-is-dropped) |
| 17 | A source file's **diff won't render** / `grep` reports it as `Binary file … matches` — though it looks like normal text | A **literal control byte** (a NUL, a `0x1f`) was pasted into the file (usually a comment or a regex describing that byte), so git classifies it binary and its diff is unreviewable. **Fixed 2026-07-16**: write the byte as an escape (`\x00`); guarded by `scripts/check-control-bytes.mjs` in CI | [→](#17-a-source-file-is-binary-to-git-because-of-a-stray-control-byte) |
| 18 | After adding an **npm dependency**, `docker restart taskhub-backend-1` crash-loops with `ERR_MODULE_NOT_FOUND: Cannot find package 'X'` — even though it's in `package.json` and installed on the host | The compose stack bind-mounts `./backend:/app` **but keeps an anonymous volume for `/app/node_modules`**, so the container's `node_modules` is isolated from the host's. A host `npm install` never reaches it, and `docker restart` re-runs the same missing-dep tree | [→](#18-new-npm-dependency-module_not_found-in-the-container-after-a-restart) |
| 19 | The dashboard can't reach the backend after you **log in**: the container is `Up` but requests get `Connection refused`, and `docker logs` ends with `prisma.user.upsert()` → `Unique constraint failed on the fields: (id)` (`P2002`) | The boot seed keyed the placeholder-user upsert on the **mutable `email`** while always creating the **fixed `id`** — the login flow changed that row's email, so the lookup missed and the upsert fell through to re-create the existing id, crashing `main()` before the HTTP server came up | [→](#19-backend-crash-loops-on-boot-with-p2002-after-you-log-in--frontend-cant-reach-it) |
| 20 | A task you just created in Task Scheduler never appears, no matter how many times you press **Sync Now** — no error, agent online, other tasks refresh fine | **Sync Now can only refresh folders you already track, never discover a new one**: it built its category filter from the tasks already on screen, so a brand-new folder was excluded by the very filter meant to include it. Use **Import** (the only path that calls `/discover`). There is also **no automatic Windows sync** at all | [→](#20-sync-now-never-brings-in-a-task-you-just-created-in-task-scheduler) |
| 20a | …and after you **rename a category**, that whole folder silently stops syncing — no new tasks, no refresh, no error | The server filters on `extractCategory(externalId)` (re-derived from the folder path) while the caller sent the **renameable** stored `category`, so the name matched no folder. **Fixed 2026-07-25**: Sync Now sends `{ scope: 'tracked' }` and the server resolves the folders itself | [→](#20a-and-a-renamed-category-silently-stops-syncing-its-folder) |
| 21 | Templates never update — the registry has no effect and the count never moves — while the app is otherwise perfectly healthy; the log shows `[catalog] sync failed … P2002` on `prisma.user.upsert()` | #19's bug in a **second file the #19 fix missed**: `ensureCatalogOwner()` keyed on the mutable `CATALOG_OWNER_EMAIL` while creating the fixed id. Here the caller **catches** it instead of crashing, so the only symptom is a catalog that silently never changes | [→](#21-templates-never-update-catalog-sync-failed--p2002-on-every-boot) |
| 22 | You delete a Windows task (or a whole folder), sync, and Cronsole **still lists it** — while the sync response reports `missing: 56`, i.e. claims it marked them | The container's **generated Prisma client is stale** and lacks the `MISSING` enum, so `TaskStatus.MISSING` is `undefined` — and **Prisma treats `undefined` in `data` as "leave this field alone"**, so only `nextRunTime` was written while `updateMany` still returned a count. A *wrong* enum value throws; a **missing** one silently no-ops. `prisma migrate` updates the DB, so DB and client drifted apart invisibly (#18's shadowed `node_modules`) | [→](#22-deleted-a-windows-task-synced-and-cronsole-still-shows-it--while-reporting-missing-n) |
| 23 | The dashboard shows a plain **network error** after a reboot / unclean shutdown. Everything looks `Up`, every request to `:3000` is `HTTP 000`, and a backend log ends with `prisma.user.upsert()` → `FATAL: the database system is starting up` (container) or `Can't reach database server at localhost:5432` (host, `logs/backend.err.log`) | **Nothing waited for Postgres to be *ready*, only to *exist*** — after an unclean shutdown it spends seconds in crash recovery refusing queries, and the boot seed dies on the refusal. It stays dead because **`tsx watch` survives the crash**, so the container never exits and `restart: unless-stopped` never fires. Compounded by **two stacks running at once** (host *and* containers) fighting over `:3000`, with `Test-Port` reporting the dead squatter as "backend already up". **Fixed 2026-07-27**: `pg_isready` healthcheck + `condition: service_healthy`, `Wait-Db` in `cronsole.ps1`, and backend/frontend moved behind `profiles: ["docker"]` | [→](#23-network-error-after-a-reboot--the-database-system-is-starting-up) |
| 23a | `cronsole status` prints `[DOWN]` for Postgres, Redis, backend **and** frontend — while `/api/health` returns 200 and the frontend serves 200 | The **same port check as #23, wrong in the other direction**: `Get-NetTCPConnection` needs the NetTCPIP CIM provider and the container check needs a resolvable docker CLI; both were wrapped in `catch { $false }`, so *"the probe could not run"* printed as *"the service is down"*. **Fixed 2026-07-28**: every service is probed by asking the service (`/api/health`, HTTP `GET /`, `pg_isready`, a RESP `PING`), the port is corroboration only, and present-but-unconfirmable reports **`WARN`** with the signal named | [→](#23a-and-the-same-probe-reported-four-services-down-while-all-four-were-serving) |
| 24 | `showDirectoryPicker()` throws `SecurityError: Must be handling a user gesture to show a file picker` — from a handler that demonstrably *is* a click handler | An `await` ran first. The picker needs **transient user activation**, and an awaited network call consumes it before the picker opens. Open the picker **before** the request — which also fails fast when the user cancels, instead of discarding a finished export | [→](#24-showdirectorypicker-throws-must-be-handling-a-user-gesture-after-an-await) |
| 25 | `npx tsc --noEmit` in `frontend/` exits **0**, then CI's `tsc -b` fails on type errors in the same tree | The root `tsconfig.json` is a solution file (`files: []` + references), and a plain `tsc --noEmit` **does not follow project references** — so it compiles an empty program and can never fail. Typecheck with **`npm run build`** (or `npx tsc -b`). Bites hardest when app and node projects have different `types`: a frontend test importing `node:fs` passes the check that checks nothing | [→](#25-npx-tsc---noemit-in-frontend-passes-while-cis-build-fails-on-a-type-error) |
| 26 | `prisma migrate dev` applies the migration then dies on `EPERM: operation not permitted, rename … query_engine-windows.dll.node` | The **running backend holds the query engine DLL open**, so Windows refuses the rename. The migration already ran, leaving the **DB ahead of the generated client** — #22's drift, but loud. Stop the backend, `npx prisma generate`, restart (in the container: `docker compose exec backend npx prisma generate`, per [#18](#18-new-npm-dependency-module_not_found-in-the-container-after-a-restart)) | [→](#26-prisma-generate-fails-with-eperm-operation-not-permitted-rename--query_engine-windowsdllnode) |
| 35 | The checkout-folder rename fails all 10 attempts with `Access to the path … is denied`, moments after `cronsole down` reported the agent, backend and frontend all stopped | **`Stop-Port` kills the owner of the listening socket, not the owner of the folder.** Under `npm run dev` the listener is the innermost node; `tsx watch` and its `cmd.exe` wrapper are its **ancestors**, survive, and keep a CWD handle inside `backend\` — and Windows won't rename a directory that has one. The shutdown report was true, just not the claim that mattered. **Fixed 2026-07-31** (`Stop-DevServerTree`; the migration now names the holders). The other holder is **the shell or AI session you're typing in** — same handle, invisible to any process scan, so close it and re-run from elsewhere | [→](#35-the-checkout-rename-fails-with-access-to-the-path-is-denied--right-after-down-reported-everything-stopped) |
| 35a | The **same** rename failure with the watcher fix already in — and the abort message names the holder: `pid 47312 TaskHub.Agent.exe`, printed two lines under `agent already stopped` | **A process keeps the name it was launched with.** The exe was renamed `TaskHub.Agent` → `Cronsole.Agent`, but this agent had started three days before the rename, so all four `Get-Process -Name 'Cronsole.Agent'` call sites (probe, `down`, republish, migrate) went blind at once — each still reporting success. The tell is `StartTime` predating the rename. **Fixed 2026-07-31**: every stop looks for **both** names, a legacy-named agent probes **WARN not UP**, republish prunes pre-rename leftovers from `agent\publish\`, and the migration's abort path re-enables the launcher tasks itself. *Renaming a binary does not rename the processes already running it — keep the old name in every lookup that **stops** something* | [→](#35a-and-the-holder-was-the-agent-itself-running-under-its-pre-rename-name) |
| 32 | A PowerShell check against the API returns **every** task when it should return one, or prints a header with one **blank** row — while the same endpoint's raw JSON is plainly correct | **`Invoke-RestMethod` writes its array to the pipeline without enumerating it**, so a directly-piped `Where-Object`/`Select-Object` receives one `Object[]` instead of N objects. `$_.prop -eq 'x'` then evaluates against the whole array and returns the *matching elements* — truthy — so everything passes the filter. Assign to a variable first, then filter, and wrap in `@()` before `.Count`. **Worst where a check is meant to prove a row is gone: the broken form prints `0` on no-match, so it looks right and can never fail in the direction it is testing** | [→](#32-a-powershell-check-against-the-api-matches-everything-or-renders-a-blank-row) |
| 34 | A Pages site moves to a new custom domain; the **old** subdomain 404s on both schemes despite its DNS record still resolving to the right GitHub IPs | **Pages redirects only `<user>.github.io/<repo>` to the custom domain — never a second custom domain pointed at the same IPs.** Serving is keyed on the `Host` header matching the repo's `CNAME`; anything else gets no site. DNS looks perfectly healthy the whole time, because the failure is vhost routing one layer above it. Either drop the old record (so it `NXDOMAIN`s rather than 404s) or serve a real redirect from a second repo. **"The record still points there" ≠ "the server will answer for that name"** | [→](#34-the-old-custom-domain-404s-after-moving-a-pages-site-to-a-new-one) |
| 33 | A rename lands, every suite is green, and a working setup quietly stops working — MCP tools vanish, webhooks stop firing, an agent can't find its secret | The rename pass rewrote the **back-compat shim** that existed to survive it (`CRONSOLE_x ?? TASKHUB_x` → `CRONSOLE_x ?? CRONSOLE_x`) — a tautology that compiles and reads correctly — **and rewrote the guarding tests the same way**, so they still pass. Never write the old name as a literal in the thing meant to survive the rename: assemble it (`['TASK','HUB'].join('')`) and mutation-check the fallback | [→](#33-a-rename-pass-silently-disables-the-back-compat-it-just-added--and-rewrites-the-tests-too) |
| 31 | The dashboard loads but every API call fails with *"No 'Access-Control-Allow-Origin' header is present"* — while `curl` against the same route returns 200 | **Read the backend log — it names the refused origin and the allowed list.** Since 2026-07-31 the REST API enforces **`ALLOWED_ORIGINS`** (it used to reflect any origin), and the browser's origin isn't on the list — after a port change, a Settings → API-origin override, or reaching Cronsole over Tailscale/a tunnel. **`curl` works because it sends no `Origin`, and a request without one is always allowed**, so a passing `curl` is not evidence the browser can reach the API. Add the exact origin (scheme + host + port) and restart the backend; the same list gates the `/ui` live-update socket | [→](#31-the-dashboard-loads-but-every-api-call-fails-with-a-cors-error) |
| 30 | A route 500s on real data while `tsc` is green | A **cast on a query result** (`row as SomeInterface`) silenced the compiler at the one boundary that had drifted — a Prisma `select` missing a field the consumer now requires. Delete the cast; Prisma's generated select type is already the strongest check there is. *A cast at a data boundary is a promise the query cannot keep* | [→](#30-a-route-500s-on-real-data-while-tsc-is-green--a-cast-on-a-query-result) |
| 29 | `prisma migrate` refuses to run — "migration was modified after it was applied" — and the only remedy it offers drops the database | Prisma checksums each migration **file**; editing an applied one (even adding a comment) breaks the hash. **Never `migrate reset`** on a local-first app — that is the user's real data. Verify the DB already matches the SQL, re-record the checksum, then use `--create-only` + `migrate deploy` (which also skips `generate`, dodging [#26](#26-prisma-generate-fails-with-eperm-operation-not-permitted-rename--query_engine-windowsdllnode)) | [→](#29-prisma-migrate-refuses-to-run-migration-was-modified-after-it-was-applied--and-offers-to-drop-your-database) |
| 28 | A **restored** task, or the folder it landed in, refuses to delete with `Access is denied` — though you created the original yourself, unelevated | The restore ran through the **elevated agent**, so Windows gave the task (and any folder created for it) an administrator ACE. Delete the task **through Cronsole** (import the folder, then Delete from Windows) or from an elevated Task Scheduler; the folder has no in-app route and needs an elevated `DeleteFolder`. This is the concrete cost of restore's folder carve-out | [→](#28-a-restored-task-or-the-folder-it-landed-in-cant-be-deleted-access-is-denied) |
| 27 | `PayloadTooLargeError: request entity too large` on an upload route; small selections work | `express.json()` caps bodies at **100 kB**. Don't raise it globally — that hands every endpoint a huge request budget. Mount a larger parser **scoped to the path and BEFORE the global one** (`body-parser` skips a request another parser already consumed, so mounting it after does nothing and looks identical to not adding it) | [→](#27-a-route-that-takes-an-upload-413s--and-raising-the-global-body-limit-is-the-wrong-fix) |

---

## 1. Backend crash-loops with `[Object: null prototype]`

**Symptom** — `docker logs taskhub-backend-1` (or `npm run dev` in `backend/`) prints a bare
uncaught exception and exits, restarting forever:

```
node:internal/modules/run_main:123
    triggerUncaughtException(
[Object: null prototype] {
  [Symbol(nodejs.util.inspect.custom)]: [Function: [nodejs.util.inspect.custom]]
}
Failed running 'src/index.ts'
```

The compiled build (`npm run build` then `npm start`) runs **fine** — which is the tell.

**Cause** — the dev runner was `ts-node`, and `ts-node@10.9` does not support TypeScript 6.
It throws that opaque null-prototype object instead of a readable error. Plain `tsc` +
`node dist/index.js` never touches ts-node, so the compiled path works and masks the cause.

**Fix** — run dev/seed through **`tsx`** (version-agnostic), not ts-node. This is already the
committed default:

```jsonc
// backend/package.json
"dev":  "tsx watch src/index.ts",
"seed": "tsx src/seed.ts",
```

If the Docker container still fails after a `package.json` change, its anonymous
`node_modules` volume is shadowing the fresh image — rebuild **and** renew it:

```bash
docker compose up -d --build --force-recreate --renew-anon-volumes backend
```

> [!TIP]
> Any bare `[Object: null prototype]` crash from a TS entrypoint is almost always the dev
> **runner**, not your code or your env. Confirm by building: if `npm run build && npm start`
> works, it's the runner.

*First hit: 2026-07-10.*

---

## 2. `403 Invalid or expired token` (or agent rejected)

**Symptom** — the stack is up, but the dashboard shows no tasks and API calls return
`403 {"error":"Invalid or expired token"}`. Or the agent connects and is immediately
rejected at the pairing handshake.

**Cause** — `docker-compose.yml` bakes in **DEV-ONLY default secrets**
(`JWT_SECRET=dev-jwt-secret-change-in-production`, and defaults for `ENCRYPTION_KEY` /
`AGENT_PAIRING_SECRET`) so `docker compose up` boots out of the box. But the frontend dev
token in `frontend/.env.local` and the agent's `CRONSOLE_PAIRING_SECRET` were generated
against the **rotated** secrets in `backend/.env`. The container's default `JWT_SECRET`
can't verify a token signed with the rotated one → 403. Same story for the pairing secret.

**Fix** — create a **root `.env`** (next to `docker-compose.yml`, gitignored) mirroring the
secret values from `backend/.env`. Compose interpolates it automatically:

```dotenv
JWT_SECRET=<same as backend/.env>
ENCRYPTION_KEY=<same as backend/.env, exactly 32 chars>
AGENT_PAIRING_SECRET=<same as backend/.env>
ALLOWED_ORIGINS=http://localhost:5173
```

Then recreate the backend so it loads the new env (env changes need a recreate, not just a
rebuild):

```bash
docker compose up -d --force-recreate backend
```

**Verify** — `docker exec taskhub-backend-1 printenv JWT_SECRET` should now show your
`backend/.env` value, and `GET /api/tasks` with the dev token returns `200`.

> [!NOTE]
> Whenever you rotate a secret in `backend/.env`, update the root `.env` too, and regenerate
> the frontend dev token (`frontend/.env.local`). See
> [Setup › Docker vs. manual](../setup/README.md#-docker-vs-manual).

*First hit: 2026-07-10.*

---

## 3. Port `LISTENING` but `HTTP 000` / `EADDRINUSE`

**Symptom** — `netstat` shows `:3000` as `LISTENING`, but `curl http://localhost:3000/...`
returns `HTTP 000` (connection made, no response). Or starting the backend locally fails
with `Error: listen EADDRINUSE: address already in use :::3000`.

**Cause** — Docker's port proxy (`com.docker.backend`) keeps the published port bound to the
container **even while the app process inside it has crashed or is mid-restart**. So the port
looks alive, but nothing answers — and a *second* local process can't bind it either.

**Fix** — don't chase the port; check the app. Read `docker logs taskhub-backend-1` to see
why the process died (usually entry #1 or #2 above). To run the backend locally instead of in
Docker, stop the container first so the proxy releases the port:

```bash
docker compose stop backend
cd backend && npm run dev
```

> [!TIP]
> `HTTP 000` from `curl` means "connected but got nothing," which points at a **crashed app
> behind a live proxy**, not a firewall or a wrong URL.

*First hit: 2026-07-10.*

---

## 4. Backend source edits not picked up in Docker

**Symptom** — you edit `backend/src/**`, the source is correct and `npm run build` passes, but
the **running** stack still behaves like the old code: a newly added route 404s
(`Cannot PATCH /api/tasks/:id/schedule`), a changed handler runs the old logic, etc. A live
E2E/API check fails even though every offline test is green.

**Cause** — the backend container runs `npm run dev` = `tsx watch` over the bind-mounted
`./backend:/app` volume. On a **Windows host → Linux container** bind mount, filesystem
change events (inotify) **don't propagate**, so `tsx watch` never notices the edit and keeps
serving the process it started with. The container can be "up 2 hours" and still be running
pre-edit code.

**Fix** — restart the container so it re-reads the mounted source on boot:

```bash
docker restart taskhub-backend-1
# then wait for it to answer (403 = up, auth-gated):
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/tasks -H "Authorization: Bearer x"
```

A plain restart is enough (the source is already mounted — no rebuild needed unless
`package.json`/deps changed, in which case see entry #1's `--renew-anon-volumes`).

> [!TIP]
> The tell: `npm run build` succeeds and the offline unit/integration suites pass, but a
> request against `localhost:3000` disagrees with the source. That gap = the live process is
> stale. Restart before you debug the code.

*First hit: 2026-07-10.*

---

## 5. Windows `OFFLINE` after running a transient test agent

**Symptom** — you start a second agent instance for a dogfood/test (e.g. `dotnet
Cronsole.Agent.dll` with `CRONSOLE_AGENT_ID=dogfood-agent`), do your testing, then stop it —
and now `GET /api/tasks/health` reports `WINDOWS_TASK_SCHEDULER: OFFLINE` and stays that way,
even though the **real** agent process (the elevated `\Cronsole-Stack\CronsoleAgent` scheduled task)
is still running. Polling for a minute-plus doesn't recover it.

**Cause** — the backend maps one agent socket per user (single-user MVP). When the transient
agent connects it becomes *the* Windows agent; when it disconnects, the backend clears the
mapping. The real agent's socket is still alive from **its** point of view, so it doesn't
reconnect — and re-registration only happens on (re)connect. Result: the real agent is
connected-but-unregistered, and the backend has no Windows socket to command.

**Fix** — force the real agent to reconnect by dropping all agent sockets. Restarting the
backend does it (its 30s watchdog reconnects the real agent, which re-registers on connect):

```bash
docker compose restart backend
# then confirm Windows is HEALTHY again:
curl -s http://localhost:3000/api/tasks/health -H "Authorization: Bearer <dev token>"
```

Windows returns to `HEALTHY` within ~15s of the restart.

> [!TIP]
> The real agent runs **elevated** (registered with highest privileges), so an unelevated
> shell **can't** `Stop-Process` it (`Access is denied`). Don't try to kill/republish over
> it for a dogfood — run a transient agent instead, and restart the backend when you're done
> to hand the connection back.

*First hit: 2026-07-11.*

---

## 6. `.ps1` parse errors under Windows PowerShell 5.1 only

**Symptom** — running a script with the stock `powershell` (Windows PowerShell 5.1) fails to
parse, even though it's syntactically fine and runs under `pwsh` (7):

```
Unexpected token '}' in expression or statement.
The string is missing the terminator: ".
Missing closing '}' in statement block or type definition.
```

The reported line/column point at the *end* of the file (a late `}` or the last string),
not the real culprit — the parser got desynced earlier and only noticed at EOF.

**Cause** — a **non-ASCII character in a BOM-less UTF-8 script**. The usual offender is an
**em-dash `—`** (U+2014) pasted into a comment or `Write-Host` string. Windows PowerShell 5.1
reads a file with no byte-order mark as the system **ANSI** codepage (Windows-1252), so the
em-dash's UTF-8 bytes (`E2 80 94`) decode to three characters — one of which is a **curly
quote** (`"`, U+201D). PowerShell treats curly quotes as valid string delimiters, so it thinks
a string opened and never closed, and every brace after it is misread. `pwsh` 7 defaults to
UTF-8, so it never sees the problem — which is why a pwsh-based syntax check passes.

**Fix** — keep PowerShell (and VBScript) scripts **pure ASCII**. Replace em-dashes with `-`:

```powershell
# find non-ASCII chars in a script
([System.IO.File]::ReadAllText($f).ToCharArray() | Where-Object { [int]$_ -gt 127 } |
  Sort-Object -Unique | ForEach-Object { 'U+{0:X4}' -f [int]$_ })

# replace em-dashes, rewrite as UTF-8 without BOM
$t = [System.IO.File]::ReadAllText($f) -replace [char]0x2014, '-'
[System.IO.File]::WriteAllText($f, $t, (New-Object System.Text.UTF8Encoding($false)))
```

Then verify **under 5.1 specifically** (not just pwsh):

```powershell
& 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -NoProfile -Command "
  `$e=`$null; [System.Management.Automation.Language.Parser]::ParseFile('$f',[ref]`$null,[ref]`$e)
  if(`$e){ `$e.Message } else { 'OK' }"
```

> [!TIP]
> A BOM would also fix it (5.1 auto-detects UTF-8 with a BOM), but plain ASCII is the most
> portable — it can't be corrupted by any editor/encoding and stays greppable.

*First hit: 2026-07-13.*

---

## 7. New agent command 502-times-out until the agent is republished

**Symptom** — you add a new agent socket command (a `task:*` op like `task:export`),
wire up the backend route + connector, restart the backend, and the endpoint now
*exists* (no 404) — but it hangs ~15s and returns:

```json
{ "error": "Agent export timeout" }
```
(HTTP 502; the message varies per command — "Agent … timeout".)

**Cause** — two separate processes run old code, and they reload differently:

1. The **backend** is a Docker container (`taskhub-backend-1`, `npm run dev`) with
   the source bind-mounted. Windows→Linux bind mounts don't propagate file-change
   events, so `tsx watch` never sees your edit — the new **route** 404s. See
   [entry #4](#4-backend-source-edits-not-picked-up-in-docker). Fix: `docker compose restart backend`.
2. The **.NET agent** is a **host process** running the published exe
   (`agent\publish\Cronsole.Agent.exe`), launched by the stack / self-heal task. It
   does **not** hot-reload at all. Until you rebuild + republish it, it has no
   handler for the new command, never emits the response, and the backend's 15s
   wait times out to a 502.

The tell that distinguishes this from entry #4: the route **exists** (a bad id
returns your handler's `{"error":"Task not found"}`, not an Express "Cannot GET"),
and only the **agent-backed** path (Windows tasks) times out — a DB-only path
(Cronsole-native) works immediately.

**Fix** — republish the agent. It runs at **RunLevel Highest**, so an unelevated
shell can't stop it and `dotnet publish` can't overwrite the locked exe.

### The easy way — the on-demand republish task (recommended)

Register it **once** from an **Administrator** prompt:

```powershell
.\scripts\startup-task\Register-RepublishTask.ps1
```

After that, republish from **any** prompt — no elevation, no UAC:

```powershell
Start-ScheduledTask -TaskPath '\Cronsole-Stack\' -TaskName 'CronsoleRepublish'
Get-Content "$env:TEMP\cronsole-republish.log" -Tail 20   # it logs; read it, don't assume
```

`\Cronsole-Stack\CronsoleRepublish` is a **no-trigger** task at RunLevel Highest that runs
[`scripts/Republish-Agent.ps1`](../../scripts/Republish-Agent.ps1) (stop → publish →
relaunch), hidden via `run-hidden.vbs`. It only ever runs when explicitly started.

> [!NOTE]
> This is a **dev tool** and is deliberately not registered by `Register-CronsoleStack.ps1`
> or any installer. It is, by construction, a way to run code elevated without a UAC
> prompt — but it runs one fixed script from this repo, and `\Cronsole-Stack\CronsoleStack`
> already runs `cronsole.ps1` elevated on a recurring trigger, so anyone who can write to
> this repo already has elevated execution here. It adds an entry point, not a capability.
> Don't register it on a machine where the repo is writable by someone who shouldn't have
> admin. Remove with `Register-RepublishTask.ps1 -Unregister`.

### The manual way

In an **Administrator** PowerShell:

```powershell
# 1. Stop the running agent so its exe can be replaced
Get-Process Cronsole.Agent -ErrorAction SilentlyContinue | Stop-Process -Force
# 2. Rebuild + publish (now includes the new command handler)
dotnet publish ".\agent\Cronsole.Agent" -c Release -r win-x64 --self-contained false -o ".\agent\publish"
# 3. Relaunch the stack (starts the new agent hidden)
& ".\scripts\cronsole.ps1" up
```

Step 1 is the one that matters: skip it and step 2 fails on the locked exe, or worse
appears to succeed while the old process keeps running.

### Verify it took — don't assume

```powershell
# The published dll must be NEWER than the newest source file.
Get-Item ".\agent\publish\Cronsole.Agent.dll" | Select-Object LastWriteTime
Get-ChildItem ".\agent\Cronsole.Agent" -Recurse -Filter *.cs |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1 LastWriteTime
```

> [!TIP]
> An unelevated `Get-Process Cronsole.Agent` returning **nothing does not mean the agent is
> down** — it runs elevated and can be invisible to your shell. Ask the backend instead:
> `GET /api/tasks/health` should show `WINDOWS_TASK_SCHEDULER` as `HEALTHY` with a recent
> `lastSync`. That is the authoritative signal.

> [!NOTE]
> Any change to the **backend** signature side of a signed command (e.g. a new
> `SignableCommand` variant) must ship **with** the agent — deploy both together,
> or the mismatch surfaces as a rejected/timed-out command. Read-only commands
> (like `task:export`) aren't signed, but still need the agent republished for the
> handler to exist.

*First hit: 2026-07-13.*

---

## 8. Every MCP tool returns `403 Invalid or expired token`

**Symptom** — the backend is healthy and the dashboard works, but *every* Cronsole MCP
tool call fails immediately:

```
Cronsole API error (HTTP 403): Invalid or expired token
```

**Cause** — `CRONSOLE_TOKEN` is **not set in the environment the MCP host was launched
from**, so it was never expanded. `.mcp.json` references the token as
`"CRONSOLE_TOKEN": "${CRONSOLE_TOKEN}"`, and Claude Code
[documents](https://code.claude.com/docs/en/mcp) that an unset variable is passed
through as its **literal text** (`${CRONSOLE_TOKEN}`) with only a warning. The server
then sends `Authorization: Bearer ${CRONSOLE_TOKEN}` and the API rejects it.

The message is misleading: nothing is expired, and the JWT is not malformed — the
variable is simply unset. Don't rotate secrets or re-mint a token before checking this.

The tell that distinguishes it from [entry #2](#2-403-invalid-or-expired-token-or-agent-rejected)
(Docker's secrets not matching `backend/.env`):

- **Only the MCP server** 403s. The dashboard and `curl` with a real token both work —
  entry #2 breaks *everything*, including the agent handshake.
- A **missing** `Authorization` header returns `401 Access token required`, not `403`.
  Getting `403` means a token *was* sent — it just wasn't a JWT. Reproduce the exact
  failure with:

  ```bash
  curl -s -H 'Authorization: Bearer ${CRONSOLE_TOKEN}' http://localhost:3000/api/tasks
  # {"error":"Invalid or expired token"}  ← identical to what the MCP tools return
  ```

**Fix** — set the variable in your environment, then **restart the MCP host** (it
expands `.mcp.json` at launch). Never paste the literal token into `.mcp.json` — the
repo's convention is that it holds only `${ENV}` references.

```powershell
# Mint a token inside the backend container, so it's signed with the JWT_SECRET
# the running backend actually uses (not whatever your shell has).
$token = (docker exec taskhub-backend-1 node -e "console.log(require('jsonwebtoken').sign({id:'<userId>',email:'<email>'}, process.env.JWT_SECRET, {expiresIn:'365d'}))").Trim()
[Environment]::SetEnvironmentVariable('CRONSOLE_TOKEN', $token, 'User')   # persistent
```

Since 2026-07-14 `configFromEnv()` detects an unexpanded `${...}` literal and refuses
to start with an explicit message, so this now fails loudly at launch rather than as a
403 on every call. If you see that startup error, the fix above is still the answer.
**Note the symptom moved:** because the server now refuses to start, the tools go
*missing* rather than 403ing. `/mcp` showing no `cronsole`, or a `ToolSearch` for
`mcp__cronsole__*` finding nothing, can be this same bug wearing a quieter mask —
but **missing tools do not identify the token as the cause**, because a server
disabled in the host looks exactly the same. Rule that out first
([#13](#13-the-cronsole-mcp-tools-are-missing-while-the-token-is-fine)); it's one
command, and it's the cheaper hypothesis.

### 8a. …and "restart from a fresh terminal" does nothing under VS Code

**A new terminal is not a new environment.** A process inherits its parent's environment
block *at spawn*, and the parent of a VS Code integrated terminal is `Code.exe` — which
snapshotted its environment whenever VS Code launched, possibly days ago. Opening a new
tab, or even restarting Claude Code, re-inherits that same stale block. The token is set
at the User level and *still* invisible. The advice above ("restart from a fresh
terminal") is only true for a terminal launched fresh from Explorer or the Start menu.

**Diagnose it — don't guess which process is stale.** Walk the ancestry and compare start
times against when you set the variable:

```powershell
$cur = $PID
for ($i=0; $i -lt 7 -and $cur; $i++) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId = $cur"; if (-not $p) { break }
  "$($p.Name) (pid $cur) started $((Get-Process -Id $cur -EA SilentlyContinue).StartTime)"
  $cur = $p.ParentProcessId
}
```

Any ancestor that started **before** you set the variable is the culprit — everything
below it inherits the old block. Confirm the variable is genuinely persisted, and that
the process just can't see it:

```powershell
[Environment]::GetEnvironmentVariable('CRONSOLE_TOKEN','User')   # persisted value
$env:CRONSOLE_TOKEN                                              # what this process sees
```

**Fix — inject it into the current shell, then relaunch the host from that shell.** This
works without closing VS Code and losing your window state:

```powershell
$env:CRONSOLE_TOKEN = [Environment]::GetEnvironmentVariable('CRONSOLE_TOKEN','User')
claude
```

The alternative is to fully quit VS Code (**all** windows — one lingering window keeps
the old `Code.exe` alive) and reopen it. Same for Windows Terminal: a new tab inherits
from the running `WindowsTerminal.exe`, so tabs don't refresh the environment either.

*First hit: 2026-07-14. Entry 8a added 2026-07-15, after a correct restart failed to fix
it — Claude Code was genuinely fresh, but its VS Code grandparent was 7 hours old.*

---

## 9. Agent payload arrives with every field empty

**Symptom** — you add a new agent command, republish, and the round trip *works*: no
error, no timeout, no exception, and even the **count is right**. But every field is
blank:

```jsonc
// GET /api/tasks/folders
{ "folders": [ { "path": "", "taskCount": 0, "writable": false },   // x161
               { "path": "", "taskCount": 0, "writable": false } ] }
```

**Cause** — the agent emitted a **C# object directly**:

```csharp
var folders = _scheduler.ListFolders();                    // List<AgentFolderInfo>
await _socket.EmitAsync("task:folders_list", new[] { new { folders = folders } });
```

The socket serializer does **not** camelCase. So the wire carries the C# property names —
`Path`, `TaskCount`, `Writable` — while the backend reads `f.path`, `f.taskCount`,
`f.writable`. Every lookup is `undefined`, and the connector's defensive mapping
(`String(f.path ?? '')`, `!!f.writable`) turns each one into a plausible empty value.

Nothing throws. You get a **well-formed payload of empty values** — the confident lie, in
its purest form. Worse, it reads as a *product* answer ("no folder on this machine is
usable") rather than a bug.

**Fix** — project every emit into an anonymous type with **explicit lowercase names**, the
way `task:full_list` already does:

```csharp
var folders = _scheduler.ListFolders()
    .Select(f => new { path = f.Path, taskCount = f.TaskCount, writable = f.Writable })
    .ToList();
```

> [!WARNING]
> **The mocked tests cannot catch this**, and that is the real lesson. The agent's tests
> mock `ITaskScheduler`; the backend's mock the socket. Neither crosses the real JSON
> boundary, so **both sides pass while disagreeing about the wire format**. Assert the
> **serialized** shape instead — see `TaskFolders_Event_EmitsCamelCaseKeysTheBackendCanRead`,
> which checks the lowercase keys are present, the PascalCase ones are not, and the values
> survive. A green suite is not evidence that two processes agree.

**The tell that separates this from a stale agent** ([#7](#7-new-agent-command-502-times-out-until-the-agent-is-republished)):
a stale agent **times out** (no handler). This *answers* — instantly, and with the right
row count. If the shape is right and the content is empty, suspect casing, not staleness.

*First hit: 2026-07-14 (`task:folders`, found only by driving it against a real machine —
161 folders, all blank).*

---

## 10. Cannot delete a Task Scheduler folder (`E_ACCESSDENIED`)

**Symptom** — removing an **empty** Task Scheduler folder fails, even though you created it
and even though your shell can see it:

```
Access is denied. (0x80070005 (E_ACCESSDENIED))
```

**Cause** — Task Scheduler **folder** deletion requires elevation. Task *deletion* through
Cronsole works fine (the agent runs elevated and does it for you), but nothing hands your
unelevated shell the right to remove the containing folder.

**Fix** — from an **Administrator** prompt:

```powershell
$svc = New-Object -ComObject Schedule.Service; $svc.Connect()
$svc.GetFolder('\Parent').DeleteFolder('Child', 0)   # deepest first
$svc.GetFolder('\').DeleteFolder('Parent', 0)
```

The folder must be empty (no tasks **and** no subfolders) or the call fails for that reason
instead.

> [!NOTE]
> **This is why Cronsole refuses to create folders.** It creates exactly one — its own
> `\Cronsole`, the same one it prunes when the last task leaves. Any other folder it created
> would be a **one-way door**: Cronsole could make it but never remove it, leaving litter only
> you could clear from an elevated prompt. *Never create what you cannot remove.* A folder
> you made is yours and is deliberately left alone — the fix was to stop creating them, not
> to start deleting them.

*First hit: 2026-07-14 (a dogfood left `\ManualTest`, `\MicrosoftEdgeBackups`, and `\Work`
behind; they had to be removed by hand).*

---

## 11. After a System Restore, the republish task and MCP tools are gone

**Symptom** — one or both, with a repo that looks completely healthy (`git status` clean, the
build fine, the agent running):

```
Start-ScheduledTask : No MSFT_ScheduledTask objects found with property 'TaskName' equal to
'CronsoleRepublish'
```

...and/or every `cronsole` MCP tool is simply **missing** from the host — not erroring, not
403-ing (that's [#8](#8-every-mcp-tool-returns-403-invalid-or-expired-token)), just absent.

**Cause** — both are **per-machine state on `C:` that git cannot protect**:

| Wiped | Where it actually lives |
|:---|:---|
| `\Cronsole-Stack\CronsoleRepublish` (and the other `\Cronsole-Stack\` tasks) | Task Scheduler store on `C:` |
| `CRONSOLE_TOKEN` | `HKCU\Environment` (User env var) on `C:` |

The *scripts* that register the task are committed and survive; only the **registration** is
lost. Likewise the MCP server, its `dist/`, and `.mcp.json` all survive — only the token is
gone. So a restore of `C:` leaves a repo on `D:` untouched and every symptom points somewhere
other than the real cause. The token loss is silent by design: since the 2026-07-14 hardening,
`configFromEnv()` **refuses to start** rather than forward a literal `${CRONSOLE_TOKEN}`, so the
tools disappear instead of returning a misleading 403.

**Fix** — re-register the task (once, **elevated** — a UAC prompt is expected):

```powershell
.\scripts\startup-task\Register-RepublishTask.ps1
```

Re-mint the token and persist it. Mint it **inside the running container** so it's signed with
the secret the live backend actually uses, rather than a file that may not be what's loaded:

```powershell
$token = docker exec -w /app taskhub-backend-1 node -e "console.log(require('jsonwebtoken').sign({id:'<userId>',email:'<email>'}, process.env.JWT_SECRET, {expiresIn:'30d'}))"
[Environment]::SetEnvironmentVariable('CRONSOLE_TOKEN', $token.Trim(), 'User')
```

Confirm it authenticates *before* blaming MCP — this separates an auth problem from an MCP one:

```powershell
Invoke-RestMethod -Uri 'http://localhost:3000/api/tasks' -Headers @{ Authorization = "Bearer $token" }
```

Then **restart your MCP host from a fresh terminal**. Setting a User env var does not reach an
already-running process, so restarting the host inside an old terminal won't pick it up.

> [!TIP]
> **The tell:** if several unrelated-looking things broke at once and the repo is clean, ask
> what lives on `C:` rather than in git. Scheduled tasks, User env vars, and anything under
> `%TEMP%` are all outside the repo's blast radius — and outside its protection.

*First hit: 2026-07-15 (a System Restore took `\Cronsole-Stack\CronsoleRepublish` and `CRONSOLE_TOKEN`
with it; the repo on `D:` was untouched, so the two failures looked unrelated).*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 12. A template passes every test and still hangs on the target

**Symptom** — a task created from a template never finishes. It sits in `Running`
indefinitely while consuming no CPU, and Cronsole's UI reports the run as **`SUCCESS`**:

```
state       : Running
last result : 267009   (0x00041301 = SCHED_S_TASK_RUNNING)
cpu(s)      : 0.484375   <- frozen; it is blocked, not working
```

Meanwhile `npm test` is green — including the whole-catalog **resolvability** sweep.

**Cause** — two things compounding:

1. **The command is broken on the target.** Resolvability proves a `commandTemplate`
   *tokenizes and substitutes*; it does **not** prove the command runs. The concrete case:
   `Invoke-WebRequest` in **Windows PowerShell 5.1** parses responses with the **Internet
   Explorer engine**, which **Windows 11 no longer ships**. The call dies on
   `Invoke-WebRequest : Object reference not set to an instance of an object.`
   (`System.NullReferenceException`).
2. **A scheduled run has no console.** Interactively that error prints and the process
   exits. Under Task Scheduler there is nowhere to write it, so the process **blocks
   forever** rather than failing. `Cronsole` reports `SUCCESS` because the agent only
   observes that the task *started* — it never claimed the command *worked*.

The tell: `Running` + flat CPU = blocked. A task that is genuinely working accrues CPU.

**Fix** — for this class of command:

```powershell
# broken on Windows 11 — needs the IE engine
powershell.exe -Command "Invoke-WebRequest -Uri 'https://…' -Method GET"

# correct
powershell.exe -NoProfile -Command "Invoke-WebRequest -Uri 'https://…' -Method GET -UseBasicParsing"
```

- **`Invoke-WebRequest` → always `-UseBasicParsing`.** Prefer **`Invoke-RestMethod`** for
  JSON/XML: it parses directly and never touches IE (verified working on 5.1 here).
- **`powershell.exe` → always `-NoProfile`** so an unattended run doesn't depend on the
  user's profile.

To clear a stuck one: `Stop-ScheduledTask -TaskPath '\Cronsole\' -TaskName '<name>'`.

> [!IMPORTANT]
> **A green suite is not evidence a template works.** The only proof is applying it and
> watching the task actually run to completion. This bug shipped in a **core** template —
> one of the 5 every fresh install gets — on a `*/15 * * * *` default, so it would have
> stranded a `powershell.exe` every 15 minutes on a new user's machine, forever, while the
> dashboard showed `SUCCESS`.

*First hit: 2026-07-15 (found by the first live end-to-end exercise of the MCP
`create_task_from_template` + `run_task` tools — the read-only tests that preceded it could
not have surfaced it).*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 13. The `cronsole` MCP tools are missing while the token is fine

**Symptom** — `mcp__cronsole__*` is absent from the tool list and `/mcp` doesn't list
`cronsole` at all. Unlike [#8](#8-every-mcp-tool-returns-403-invalid-or-expired-token),
**every downstream check passes**:

```powershell
[Environment]::GetEnvironmentVariable('CRONSOLE_TOKEN','User')   # set
$env:CRONSOLE_TOKEN                                              # the host sees it too
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health   # 200
node ./mcp-server/dist/index.js                                 # boots clean by hand
```

That last one is the discriminator: **if the server answers `initialize` when you run it
yourself, the server is not the problem** — the host never started it.

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}' \
  | node ./mcp-server/dist/index.js
# Cronsole MCP server running on stdio
# {"result":{...,"serverInfo":{"name":"cronsole","version":"1.0.0"}},"jsonrpc":"2.0","id":1}
```

**Cause** — the server is **disabled in the host**, not broken. Claude Code prompts once
per project: *"this project defines MCP servers, do you trust them?"* Declining writes
**every** server in `.mcp.json` into `disabledMcpjsonServers` in
`.claude/settings.local.json` — and that file is **gitignored per-machine state** (§8a of
`CLAUDE.md`), so nothing in the repo hints that it happened:

```json
{
  "disabledMcpjsonServers": [
    "cronsole", "playwright", "nanobanana", "serper",
    "github", "notion", "context7", "elevenlabs"
  ]
}
```

The tell: **all** of the project's MCP servers are missing at once, not just `cronsole`. One
broken server fails alone; a declined trust prompt takes the whole file with it. If
`context7` and `github` are gone too, stop debugging `cronsole`.

**Fix** — remove the server from the list and **restart the host** (the list is read at
launch):

```powershell
# check first — this is the one-line diagnosis
node -e "console.log(require('./.claude/settings.local.json').disabledMcpjsonServers)"
```

Then delete the entry (or the whole key, to restore all of them) and relaunch. Re-approving
via the trust prompt works too, but only fires on first encounter — once the answer is
recorded, editing the file is the way back.

> [!WARNING]
> **This masks #8 and #8a completely.** A disabled server never runs, so a broken
> `CRONSOLE_TOKEN` produces the *identical* symptom — missing tools — and you can spend a
> session fixing an environment variable that was never the blocker. **Check
> `disabledMcpjsonServers` first**: it's one command, it's the cheaper hypothesis, and it
> rules out the whole token branch before you touch it.

*First hit: 2026-07-15, after #8a's env fix landed correctly and the tools were still gone.
Both faults were real and stacked — the token was genuinely unset **and** the server was
disabled — which is exactly why the missing-tools symptom can't be used to identify either
one.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 14. A rare cron becomes an hourly trigger

**Symptom** — you choose a deliberately infrequent schedule so a test task can't fire on its
own, and it fires **every hour, every day** instead:

```powershell
# asked for: once a year, Jan 1 at 04:00 UTC
create_task_from_template … schedule: '0 4 1 1 *'

# got:
DaysInterval : 1                       # <- daily
Repetition   : PT1H / P1D              # <- repeating hourly, all day
StartBoundary: 2026-07-14T17:00:00-07:00
```

The conversion *did* report itself as lossy — `confidence: 0.7` — but until 2026-07-15 the text
read `"Complex cron expression will be converted to a fallback interval trigger; execution times
might not align 100%."`, which is why it slipped past: that phrasing describes **drift** (the
right schedule, slightly off), so you accept it and move on.

> [!NOTE]
> **Fixed 2026-07-15 — the warning now names the cost**, because a warning nobody acts on isn't
> a warning:
>
> > *"This cron expression cannot be expressed as a Windows trigger, so the schedule will be
> > **REPLACED** — not approximated — with a fixed hourly trigger: every hour from 00:00, about
> > 24 runs a day (~8,760 a year). The original expression is discarded entirely, and the
> > replacement only ever runs **MORE** often than you asked."*
>
> **The score is still `0.7`, and that remains a trap**: it's the *same* score as a `*/7` step,
> which really is approximate (its trigger *is* derived from your input). Wording distinguishes
> them; the number doesn't. So a caller thresholding on `>= 0.7` still accepts a replacement —
> **read the trigger, not the score.**

**Cause** — the cron→trigger converter pattern-matches a handful of shapes (daily, weekly,
monthly, minute step, hour step). Anything else hits a single **hard-coded fallback** in
[`backend/src/utils/scheduler-conversion.ts`](../../backend/src/utils/scheduler-conversion.ts):

```ts
// Fallback / Complex cron — NOT derived from the input.
return { confidence: 0.7, trigger: { type: 'Time', startBoundary: '00:00',
  repetition: { interval: 'PT1H', duration: 'P1D' } }, warnings };
```

That fallback is **not derived from your cron at all** — it's the same hourly trigger for
every unrecognized expression. So the schedule isn't approximated, it's **discarded**. For
`0 4 1 1 *` that's 1 run/year → **8,760 runs/year**.

The asymmetry is the dangerous part: **the fallback only ever runs more often than you asked,
never less.** A "safe, rare" schedule is exactly the input most likely to miss the pattern
list, so reaching for a rare cron *to be careful* is what triggers the surprise.

**Fix** — for a task that genuinely must not self-fire, don't encode that in the cron. Use a
schedule the converter recognizes and **disable** the task, or delete it when done:

```powershell
# confirm what you'll actually get, BEFORE creating it
convert_schedule '0 4 1 1 *'    # score 0.7 -> read the trigger, not just the score

# inspect what was really registered
Get-ScheduledTask -TaskPath '\Cronsole\' -TaskName '<name>' | Select-Object -Expand Triggers
```

> [!IMPORTANT]
> **Read the returned `trigger`, not the confidence score.** `0.7` with a warning looks like
> a rounding error and is in fact a different schedule. This is the same lesson as
> [#12](#12-a-template-passes-every-test-and-still-hangs-on-the-target) and the Monday-only
> `1-5` bug, one layer up: the system told the truth in a register quiet enough to ignore.
> `convert_schedule` renders the trigger in its text output (2026-07-15) precisely so this is
> visible — use it.
>
> **Better still, look at the dates (2026-07-31).** **Tools → Schedule tester** in the app, and
> `convert_schedule` over MCP, now print the upcoming run times — and *both* lists when they
> disagree: `0 4 1 1 *` shows one run next January under "what you asked for" beside an hourly
> list under "what will actually run". A trigger description still asks you to know what
> `PT1H` costs; two disagreeing lists of dates do not. Note what neither will show you: an
> **approximated** step gets no dates at all, because Windows' continuous repetition can't be
> read off a cron round-trip and a guess there would defeat the purpose.

*First hit: 2026-07-15 (picked `0 4 1 1 *` as a "can't possibly fire" schedule for a live MCP
test task; it registered as daily-with-hourly-repetition and would have pinged every hour
until deleted).*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 15. `run_task` times out instead of saying the task is disabled

**Symptom** — running a **disabled** task hangs for ~15 seconds and then fails with a message
about the *agent*, while the agent is connected, healthy, and handling everything else fine:

```
run_task → (15013ms) HTTP 500: Agent trigger timeout
```

So you go and debug the agent connection. The agent is not the problem. The task is disabled.

**Cause** — `task:run` in
[`agent/Cronsole.Agent/AgentService.cs`](../../agent/Cronsole.Agent/AgentService.cs) only replied on
**success**. Every failure path emitted nothing at all:

```csharp
bool success = _scheduler.RunTask(taskPath);
if (success) { /* emit task:executed */ }
else { Console.WriteLine($"Task {taskPath} not found for running."); }   // <- no emit
// ...and the catch (a disabled task makes task.Run() throw) also just logged.
```

The agent writes that to a console **nobody is attached to** (it's launched hidden). With no
reply, the backend's `runTask` can only hit its own 15s timeout and resolve with the only thing
it knows: `Agent trigger timeout`. That message names the **transport** as the culprit for what
is actually a **task-state** problem with a one-click fix.

Windows itself is perfectly clear about it — `task.Run()` on a disabled task throws
`COMException 0x80041326 "The task is disabled."` in ~7ms. The information existed the whole
time; the agent just dropped it on the floor.

**Fix** *(shipped 2026-07-15)* — `task:run` now answers on every accepted path, like
`task:delete` and `task:set_status` already did:

```
run_task → (23ms) The task is disabled, so Windows refused to run it.
                  Enable the task first, then run it again.
```

**The rule this encodes:** *an accepted command always answers, and a failure answer carries the
reason.* The **one** case that stays silent is a command that fails signature verification — a
forger should learn nothing, and the server's timeout is the correct outcome there.

> [!IMPORTANT]
> **Needs an agent republish** to take effect — see [#7](#7-new-agent-command-502-times-out-until-the-agent-is-republished).
> `Start-ScheduledTask -TaskPath '\Cronsole-Stack\' -TaskName 'CronsoleRepublish'`

> [!TIP]
> **Getting the agent's console when it's launched hidden.** This was only diagnosable by
> *seeing what the agent printed*, and the elevated instance discards stdout. Run the published
> exe in the foreground yourself — it connects and **replaces** the elevated one in the backend's
> agent registry, so it handles your commands and you can read its output:
> ```bash
> cd agent/publish && ./Cronsole.Agent.exe   # Ctrl+C, then republish to restore the real one
> ```

*First hit: 2026-07-15 (found by driving the new `set_task_status` + `run_task` MCP tools live —
disabling a task and then running it is a sequence the UI never made easy).*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 16. A second identical agent command within one second is dropped

**Symptom** — run the same task twice quickly (a double-click, a loop, a script) and the
**second** call hangs 15s and fails `Agent trigger timeout`. Wait a second and it works:

```
run #1  (39ms)     Started successfully
run #2  (15032ms)  HTTP 500: Agent trigger timeout     # <- same task, 0.3s later
run #3  (21ms)     Started successfully                # <- same task, 1.5s later
```

Nothing about the task changed between #2 and #3. Only the clock did.

**Cause** — the agent's console gives it away:

```
REJECTED unsigned/invalid task:run for \Cronsole\<name>
```

Signed agent commands carry a **second-granular** `ts`, and the signature is over
`(message, ts)`. Two identical commands inside the same second are therefore **byte-identical**
— same `ts`, same `sig` — which is indistinguishable from a captured packet being replayed. The
agent's replay guard does its job and drops it, silently and correctly. The silence is right for
a forgery and wrong for you, and the backend once again reports the only thing it can: a timeout.

**This bites hardest when you're testing**, because a test script fires commands back-to-back far
faster than a human clicks — so it looks like "the second call is broken" rather than "the clock
didn't tick".

**Fix** *(shipped 2026-07-15)* — every signed command now carries a **per-command nonce**, inside
the signed message, immediately before `ts`:

```
task:run|\Cronsole\MyTask|3f9a…c2|1700000000
                         ^^^^^^ fresh 16 random bytes per emit
```

That restores the property the replay guard always assumed: **a legitimate re-send is never
byte-identical, while a replayed frame still is.** Verified live — five back-to-back `run_task`
calls now complete in 27–60ms each, where the second used to hang 15s.

The nonce is **inside** the signature, not merely alongside it, for the same reason `folder` and
`trigger` are: an unsigned nonce could be rewritten in flight, letting an attacker turn a captured
frame into a "fresh" command and defeating the guard entirely.

**The agent's replay cache did not change.** It keys on `(ts, sig)`, and once the nonce is in the
message the signature is already unique per instance — so its existing key stops colliding on its
own. The enforcement that a nonce always exists lives in the `*Message` helpers, which take it as
a **required** parameter: you cannot build a signed message without one.

> [!IMPORTANT]
> **Backend and agent must ship together** — a message-string change on one side alone rejects
> every command. Restart the backend *and* republish the agent
> ([#7](#7-new-agent-command-502-times-out-until-the-agent-is-republished)). There is deliberately
> no back-compat shim: an optional nonce would mean two valid message forms, weakening the
> guarantee to serve a version skew the project doesn't support. A skewed agent fails closed.
>
> If you write anything that signs commands (`agent/test-server/index.js` is one), it must add the
> nonce too — the agent's rejection is **silent**, so a stub that forgets it just looks like the
> agent stopped responding.

> [!WARNING]
> **Don't "fix" this by making the agent reply to a rejected command.** The silence on an
> unverifiable command is a deliberate security property, not an oversight. The bug was that a
> *legitimate* command could be byte-identical to a replay — the fix is uniqueness, not chattiness.

*First hit: 2026-07-15 (a probe fired `run_task` twice ~0.3s apart while isolating #15, and the
replay guard ate the second — which I initially misread as "running a disabled task hangs",
because "disabled" was the variable I had changed. It wasn't the cause. Two bugs, one symptom:
both surface as `Agent trigger timeout`, which is why that message deserves suspicion rather
than belief.)*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 17. A source file is binary to git because of a stray control byte

**Symptom** — a file that is plainly source code won't show a diff, and tools treat it as binary:

```
$ grep -n "toMatch" mcp-server/src/__tests__/tools.test.ts
Binary file mcp-server/src/__tests__/tools.test.ts matches
```

`git diff` on it shows `Binary files a/… and b/… differ` instead of line changes — so a review of
that file (including a security-relevant one) sees **nothing**.

**Cause** — a **literal control byte** somewhere in the file. git's heuristic: a NUL in the first
few KB ⇒ binary. It gets there by pasting the *actual* byte where the code *describes* it — a NUL
used as a separator, a `0x1f` (Unit Separator) in a comment showing a canonical format, or a raw
NUL inside a regex like `.not.toMatch(/␀/)`. The runtime string is correct; the **source** is
poisoned. The tell: `grep`/`git` call it binary while your editor renders it as normal text (the
editor silently drops or glyph-substitutes the control byte).

Find them across the repo:

```bash
node scripts/check-control-bytes.mjs        # exits 1 and lists file + line + byte
```

**Fix** *(swept + guarded 2026-07-16)* — write the byte as an **escape**, never raw. The string is
byte-identical and the file stays text:

```diff
- expect(text(r)).not.toMatch(/<NUL>/);     // raw 0x00 → file is binary
+ expect(text(r)).not.toMatch(/\x00/);      // same regex, plain text
```

`\x00` in a JS/TS regex, `\x1f` in a C# string/comment, `\0` in a string literal. For a
comment, just describe the byte in words. The guard `scripts/check-control-bytes.mjs` runs in CI
(the `repo-hygiene` job) and fails on any control byte but TAB/LF/CR; genuinely-binary files are
skipped by extension, and the two UTF-16 Task Scheduler XML exports (which legitimately carry
NULs) are on an explicit allowlist in the script.

> [!NOTE]
> When rewriting the byte with a script, verify the byte is actually gone by **re-reading the file
> and counting** — a naïve in-place edit can appear to succeed while the byte survives. `node -e`
> that reads the file back and asserts zero control bytes is the reliable check.

### It recurred — and the fix has the same trap inside it

**2026-07-28**: `backend/src/services/bulkExport.ts` shipped with a literal NUL and `0x1f` in a
filename-sanitizing regex, written as `[…|<NUL>-<0x1F>]` where `[…|\x00-\x1f]` was intended. CI's
`repo-hygiene` job caught it — **the guard works** — but it went unnoticed for six commits because
the local test suites were green and nobody looked at Actions. *Run the hygiene check locally, or
watch CI, before assuming a green `npm test` means a green build.*

The instructive part is the fix. Three attempts "succeeded" (exit 0, file rewritten) and changed
nothing, because **the `\\x00` in the replacement collapsed to a real NUL** somewhere in the
shell/tool pipeline — so each pass replaced the control bytes with identical control bytes. It
looks exactly like a failed write, and sends you hunting for file locks and watchers.

The reliable move is to **never type a backslash escape into the pipeline at all** — build it from
its code point:

```python
BS = bytes([92])                 # backslash, immune to escape collapsing
repl = BS + b'x00-' + BS + b'x1f'   # the TEXT  \x00-\x1f
```

Then re-read the file and assert zero control bytes. A replacement that can be silently rewritten
in transit is not a replacement you can trust.

*First hit: 2026-07-15 (`backend/src/ws/agentAuth.ts`, a NUL separator whose diff couldn't be
read). Repo-wide sweep 2026-07-16 found two more — `mcp-server/src/__tests__/tools.test.ts` and
`agent/Cronsole.Agent.Tests/AgentAuthenticatorTests.cs` — and added the CI guard. Recurred
2026-07-28 in `bulkExport.ts` (above). The failure is silent and only bites the reviewer, which is
why it survived so long.)*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 18. New npm dependency: MODULE_NOT_FOUND in the container after a restart

**Symptom** — you add a backend dependency (`npm install express-rate-limit`), it's in
`package.json` and works in the host's tests, but the Dockerized backend crash-loops:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'express-rate-limit'
  imported from /app/src/middleware/authLimiter.ts
```

Confusingly, **code** changes on the same restart *are* picked up ([#4](#4-backend-source-edits-not-picked-up-in-docker) / a plain
`docker restart` normally loads new source) — it's only the new *dependency* that's missing.

**Cause** — the compose service bind-mounts the source but **shadows `node_modules` with an
anonymous volume** so the container's dependencies stay independent of the host's:

```yaml
volumes:
  - ./backend:/app          # your source, live
  - /app/node_modules       # ← container's own node_modules, NOT the host's
```

That second line is deliberate (host and Linux-container native modules differ), but it means a
**host `npm install` never reaches the container**. `docker restart` re-runs the same image
`node_modules`, which predates your new package.

**Fix** — install *inside* the container, then restart:

```bash
docker compose exec backend npm install      # syncs to the updated package.json
docker restart taskhub-backend-1
```

Or rebuild the image (its build step runs `npm install`, so a fresh build never hits this):

```bash
docker compose build backend && docker compose up -d backend
```

The same applies to the **frontend** container for a new frontend dependency. This only bites
when adding a dep to an **already-running** stack — a from-scratch `docker compose up --build`
is fine.

*First hit: 2026-07-16 (adding `express-rate-limit` for the login rate-limiter — the backend
restarted into a crash-loop until the dep was installed in the container).*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 19. Backend crash-loops on boot with `P2002` after you log in — frontend can't reach it

**Symptom** — the dashboard at `http://localhost:5173` can't reach the backend. The container
shows `Up`, the port is mapped, but every request returns nothing (`curl` → `HTTP 000` /
`Connection refused` even from *inside* the container). The backend log ends with:

```
Invalid `prisma.user.upsert()` invocation in /app/src/index.ts
Unique constraint failed on the fields: (`id`)
  code: 'P2002', meta: { modelName: 'User', target: [ 'id' ] }
```

**Cause** — the boot seed's placeholder-user upsert was keyed on the **mutable** `email`
(`where: { email: 'mike@example.com' }`) while always creating the **fixed** `id:
'cli_user_placeholder'`. The single-user login flow (2026, commit `2975fd3`) lets that row's
email change to your real address. Once it does, the email lookup misses → the upsert falls
through to *create* the fixed id → it already exists → `P2002` → `main()` throws → the HTTP
server never comes up. The container stays `Up` (tsx is alive) but nothing serves.

Check the DB to confirm the row's email drifted:

```bash
docker exec taskhub-db-1 psql -U cronsole -d cronsole -t \
  -c 'SELECT id, email FROM "User";'
# cli_user_placeholder | mikeschecht@gmail.com   ← not mike@example.com anymore
```

**Fix** — key the seed upsert on the stable primary key, not the user-editable email
(`backend/src/index.ts`):

```ts
await prisma.user.upsert({
  where: { id: 'cli_user_placeholder' },   // was: { email: 'mike@example.com' }
  update: {},
  create: { id: 'cli_user_placeholder', email: 'mike@example.com', name: 'Mike', password: '' },
});
```

Then `docker compose restart backend`. General rule: **seed/upsert on the immutable identity,
never on a field the app lets the user change** — otherwise the seed orphans itself on first edit.

*First hit: 2026-07-16 (the login feature had changed the placeholder user's email; every boot
crashed until the seed was re-keyed on `id`).*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 20. "Sync Now" never brings in a task you just created in Task Scheduler

**Symptom** — you create a task in Windows Task Scheduler, press **Sync Now** in the dashboard,
and it doesn't appear. No error; the toast says `Tasks synced.` The agent is online, `/doctor` is
clean, and other tasks refresh normally. Pressing it repeatedly changes nothing.

The distinguishing detail: whether the new task shows up depends on **which folder** it's in.
A new task in a folder you already track *does* arrive. A task in a **brand-new folder** never does.

**Cause** — **Sync Now can only ever refresh folders you already track — it cannot discover a new
one.** `POST /api/tasks/sync` filters the agent's full enumeration down to an include-set of
categories, and Sync Now used to build that set from the tasks already on screen:

```ts
// frontend/src/Dashboard.tsx — the old onSyncNow
const cats = Array.from(new Set((tasks ?? []).map(t => t.category || 'Uncategorized')));
syncMutation.mutate(cats);
```

That's a closed loop: no task in `\IAM\` → `IAM` isn't in `cats` → the server filters `IAM` out
→ still no task in `\IAM\`. The button's own tooltip says as much ("Re-pull status and schedules
for the tasks you already track"), but the failure is silent, so it reads as a broken sync.

Confirm it in one call — the agent sees the folder even though the dashboard doesn't:

```bash
curl -s -H "Authorization: Bearer $CRONSOLE_TOKEN" localhost:3000/api/tasks/discover
# WINDOWS_TASK_SCHEDULER → [... {"name":"IAM","count":1}, {"name":"Edge-Radar-MikesAILab","count":25} ...]
```

If the folder is listed there, nothing is broken: discovery works, the agent is fine, and the
task simply hasn't been imported.

**Fix** — use **Import**, not Sync Now. Import is the only path that calls `/discover` and lets
you tick a category you don't yet have. Two things to know when you do:

- `Microsoft` and `Uncategorized` are **unchecked by default** (`ImportModal.tsx`). Root-level
  tasks (`\MyTask`, no folder) are `Uncategorized`, so they need an explicit tick.
- Ticking is **all-or-nothing per category**. `Uncategorized` on a typical machine means ~38
  tasks, most of them OS/vendor updaters (Opera, Zoom, OneDrive, AMD, Adobe). `Microsoft` means
  ~257. Once tracked, they come back on **every** subsequent sync.

There is **no automatic Windows sync** — no poll, no interval. `NativeScheduler` runs
Cronsole-native jobs and `catalogSync` refreshes templates; neither touches Task Scheduler. A
task created natively is invisible until *you* sync. That's deliberate (selective import), not
a bug — but it means "I made it an hour ago and it's still not there" is expected, not a fault.

> [!NOTE]
> **Since 2026-07-27 the dashboard tells you this itself.** Sync Now no longer just says
> `Tasks synced.` — when the platform reports tasks outside the folders you track, the toast
> names them: *"Synced. 26 tasks in 2 folders aren't imported — use Import to add them."*
> `POST /api/tasks/sync` carries the numbers per platform:
>
> ```jsonc
> { "platform": "WINDOWS_TASK_SCHEDULER", "count": 352, "missing": 0,
>   "untracked": { "count": 95, "folders": ["IAM", "…"], "systemCount": 257 } }
> ```
>
> `systemCount` (the `\Microsoft\` tasks) is reported **separately and excluded from `count`**
> on purpose: a real machine has ~257 of them, so counting them would pin the message at a
> number that never moves — and a warning that never changes is one you stop reading. The fence
> was always correct; only its invisibility was the defect.

### 20a. …and a *renamed* category silently stops syncing its folder

A sharper edge of the same bug, fixed 2026-07-25. Categories are renameable (click the label on
a task card) and `upsertTasks` deliberately preserves the override — but the server filters on
`TaskService.extractCategory(externalId)`, which is re-derived from the **folder path** and knows
nothing about your rename. So a Sync Now that echoed stored categories sent a name matching no
folder, and that folder dropped out of the sync entirely: it stopped picking up new tasks **and**
stopped refreshing, with no error. A folder holding a single renamed task went dark completely.

**Fix** — Sync Now no longer sends category names at all. It sends `{ scope: 'tracked' }`, and the
server resolves the include-set itself from the tracked tasks' native paths
(`TaskService.trackedCategories`), which is immune to renames by construction:

```bash
curl -X POST -H "Authorization: Bearer $CRONSOLE_TOKEN" -H 'Content-Type: application/json' \
  localhost:3000/api/tasks/sync -d '{"scope":"tracked"}'
```

`categories` and `scope` are mutually exclusive (400 if you pass both). **General rule: a
user-editable label must never be the key you filter or look up by** — the same shape as
[#19](#19-backend-crash-loops-on-boot-with-p2002-after-you-log-in--frontend-cant-reach-it),
where a mutable email was the key to an upsert.

> [!WARNING]
> There is **no "untrack"**. `DELETE /api/tasks/:id` on a Windows task deletes the **real Task
> Scheduler entry** via a signed `task:delete` — so it is *not* a way to tidy up an over-broad
> import. Removing rows you shouldn't have imported (e.g. the 257 `Microsoft` ones) means
> deleting them straight from the DB, which leaves Windows untouched:
> `docker exec taskhub-db-1 psql -U cronsole -d cronsole -c "DELETE FROM \"Task\" WHERE platform='WINDOWS_TASK_SCHEDULER' AND \"externalId\" LIKE '\\Microsoft\\%';"`

*First hit: 2026-07-25 (new tasks in `\IAM\` and `\Edge-Radar-MikesAILab\` were invisible after
repeated Sync Now; `/discover` showed the agent had been reporting all of them the whole time).*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 21. Templates never update: `[catalog] sync failed … P2002` on every boot

**Symptom** — the Templates tab is frozen: registry changes never arrive, a rebuilt/republished
registry has no effect, and the template count never moves. The app is otherwise **completely
healthy** — the dashboard works, tasks run, nothing crash-loops. Only visible in the log:

```
[catalog] sync failed: PrismaClientKnownRequestError:
Invalid `prisma.user.upsert()` invocation in /app/src/catalog/catalogSync.ts:48:21
Unique constraint failed on the fields: (`id`)
  code: 'P2002', meta: { modelName: 'User', target: [ 'id' ] }
```

**Cause** — [#19](#19-backend-crash-loops-on-boot-with-p2002-after-you-log-in--frontend-cant-reach-it)
in a **second file that the #19 fix didn't touch**. `ensureCatalogOwner()` keyed its upsert on
the **mutable** `CATALOG_OWNER_EMAIL` (`mike@example.com`) while creating the **fixed**
`CATALOG_OWNER_ID` (`cli_user_placeholder`) — the same row the single-user login flow renames to
your real address. Once you log in, the email lookup misses, the upsert falls through to *create*
an id that already exists, and `P2002` throws.

The difference from #19 — and why this one hides for months — is that the caller **catches** it
(`[catalog] sync failed:`) instead of crashing boot. So the backend comes up clean, everything
looks fine, and the only symptom is a catalog that quietly never changes again. **A swallowed
error on a background refresh is invisible in exactly the way a crash isn't.**

Confirm the email drifted:

```bash
docker exec taskhub-db-1 psql -U cronsole -d cronsole -c 'SELECT id, email FROM "User";'
# cli_user_placeholder | mikeschecht@gmail.com   ← not mike@example.com anymore
```

**Fix** — key on the immutable id (`backend/src/catalog/catalogSync.ts`):

```ts
await prisma.user.upsert({
  where: { id: CATALOG_OWNER_ID },      // was: { email: CATALOG_OWNER_EMAIL }
  update: {},
  create: { id: CATALOG_OWNER_ID, email: CATALOG_OWNER_EMAIL, name: 'Mike' }
});
```

Then `docker compose restart backend` and confirm the success line, which is the whole point of
checking rather than assuming: `[catalog] synced 5 core templates from "bundled".`

**When you fix a bug of this shape, grep for the pattern instead of fixing the one instance:**
`grep -rn "upsert" backend/src | grep -v "where: { id"`. #19 shipped a correct fix to one call
site and left an identical one live for nine days.

*First hit: 2026-07-25 (found incidentally while restarting the backend for unrelated work —
the catalog had been silently dead since the login feature first changed the placeholder email).*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 22. Deleted a Windows task, synced, and Cronsole still shows it — while reporting `missing: N`

**Symptom** — you delete tasks (or a whole folder) in Task Scheduler, press Sync, and they're
**still listed** in Cronsole as `ACTIVE`/`DISABLED`. The sync response looks *correct*:

```json
{"platform":"WINDOWS_TASK_SCHEDULER","count":349,"missing":56}
```

`missing: 56` says 56 tasks were marked MISSING. The database says otherwise — **nothing changed**:

```bash
docker exec taskhub-db-1 psql -U cronsole -d cronsole -t \
  -c "SELECT status, count(*) FROM \"Task\" WHERE platform='WINDOWS_TASK_SCHEDULER' GROUP BY 1;"
#  ACTIVE   | 298      ← identical before and after the sync
#  DISABLED | 107
```

Not a caching or UI problem: the API confidently reports work it did not do.

**Cause** — the **generated Prisma client inside the container is stale** and predates the
`MISSING` enum, so `TaskStatus.MISSING` is `undefined`. Then:

> **Prisma treats `undefined` in a `data` payload as "leave this field alone."**

So `data: { status: TaskStatus.MISSING, nextRunTime: null }` degraded to
`data: { nextRunTime: null }` — it cleared `nextRunTime`, left `status` untouched, and
`updateMany` still returned **56 matched rows**, which the route faithfully reported as
`missing: 56`. A *wrong* enum value would have thrown; a **missing** one silently no-ops. That
asymmetry is the whole trap.

Why the client was stale is [#18](#18-new-npm-dependency-module_not_found-in-the-container-after-a-restart)'s
mechanism: compose shadows `node_modules` with an anonymous volume, so a host `prisma generate`
never reaches the container. `prisma migrate` talks to the **database**, so the DB enum gained
`MISSING` while the container's client did not — the two drifted apart invisibly. Confirm by
comparing them directly, which is the diagnostic worth remembering:

```bash
# what the DATABASE knows
docker exec taskhub-db-1 psql -U cronsole -d cronsole -t -c 'SELECT unnest(enum_range(NULL::"TaskStatus"));'
#  ACTIVE / DISABLED / UNKNOWN / DELETED / MISSING

# what the CONTAINER'S CLIENT knows
docker exec taskhub-backend-1 node -e "const {TaskStatus}=require('@prisma/client'); console.log(TaskStatus)"
#  { ACTIVE, DISABLED, UNKNOWN, DELETED }   ← no MISSING
```

**Fix** — regenerate inside the container, then restart:

```bash
docker compose exec backend npx prisma generate
docker restart taskhub-backend-1
docker exec taskhub-backend-1 node -e "const {TaskStatus}=require('@prisma/client'); console.log(TaskStatus.MISSING)"  # MISSING
```

Verify against the **database**, not the response — the response looked right the whole time.
The same sync then reported the same `missing: 56` *and* actually wrote it.

**Guards added 2026-07-25** so it can't lie again: `missingTaskStatusMembers()` +
`warnOnStaleGeneratedClient()` in `backend/src/db.ts` print a loud boot banner (non-fatal — a
stale enum breaks the features that write it, not the whole app), and
`TaskService.reconcileMissingTasks` now **throws** rather than performing a partial write, so the
sync route surfaces an honest per-platform error instead of a false count. A unit test asserts
the *real* generated client is current, which is the one check the mocked suites could never make.

> [!IMPORTANT]
> **Why every test stayed green for nine days:** the unit suites `vi.mock('@prisma/client')`, so
> `TaskStatus.MISSING` was whatever the mock declared — always defined. The mock asserted the
> code's intent while the container disagreed with it. **When a bug lives in the generated client,
> a suite that mocks that client cannot see it** — the same shape as
> [#9](#9-agent-payload-arrives-with-every-field-empty) and the MCP suite's stubbed HTTP client.
> After a schema change, drive the real path once.

*First hit: 2026-07-25 (a user deleted a whole Task Scheduler folder, synced repeatedly, and the
tasks never left the dashboard — while the API reported them as marked MISSING every time. The
MISSING feature had never once worked in this Docker stack since shipping 2026-07-16.)*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 23. Network error after a reboot — `the database system is starting up`

**Symptom** — the dashboard shows a plain **network error**; nothing loads. The stack looks
fine: `docker ps` shows every container `Up`, port 3000 is mapped. But every request returns
nothing:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/tasks   # → 000
```

`docker logs taskhub-backend-1` ends with:

```
PrismaClientInitializationError:
Invalid `prisma.user.upsert()` invocation in /app/src/index.ts:78:21
Error querying the database: FATAL: the database system is starting up
```

**Cause** — a **boot-order race**, not a code bug. Nothing waits for Postgres to be *ready*,
only for it to *exist*. After an unclean shutdown (host reboot, `docker compose kill`, a hard
power-off) Postgres runs crash recovery first — several seconds of `database system was not
properly shut down; automatic recovery in progress` — during which it answers every connection
with `FATAL: the database system is starting up`. The backend's boot seed (`main()`) queries
immediately, gets that error, throws, and dies.

**It bites in two places, with two different error strings — check both:**

| Backend | Gate that was missing | Error in the log |
|:---|:---|:---|
| **Container** | `depends_on: [db]` waits for the container to **start**, not to be **healthy** | `FATAL: the database system is starting up` |
| **Host** (`cronsole.ps1`) | `compose up -d db redis` returns immediately; the host backend was launched on the next line | `Can't reach database server at localhost:5432` (in `logs/backend.err.log`) |

The reason it stays dead is the nastiest part: **`tsx watch` survives the crash**. The
supervisor keeps running and waits for a file change, so the *container* never exits — which
means `restart: unless-stopped` sees a healthy container and never restarts it. The port proxy
holds `:3000` ([#3](#3-port-listening-but-http-000--eaddrinuse)), so the port looks alive with

The reason it stays dead is the nastiest part: **`tsx watch` survives the crash**. The
supervisor keeps running and waits for a file change, so the *container* never exits — which
means `restart: unless-stopped` sees a healthy container and never restarts it. The port proxy
holds `:3000` ([#3](#3-port-listening-but-http-000--eaddrinuse)), so the port looks alive with
nothing behind it, indefinitely.

Confirm it was recovery, not corruption:

```bash
docker logs taskhub-db-1 | grep -E "recovery|starting up|ready to accept"
# ... database system was not properly shut down; automatic recovery in progress
# ... FATAL:  the database system is starting up      ← the backend's query, refused
# ... database system is ready to accept connections  ← ~9s later, too late
```

**Immediate fix** — the DB is healthy by the time you look, so a restart is all it takes:

```bash
docker restart taskhub-backend-1
```

**Durable fix (applied 2026-07-27)** — gate the backend on DB *readiness*, in
`docker-compose.yml`:

```yaml
  db:
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U cronsole -d cronsole"]
      interval: 5s
      timeout: 5s
      retries: 12
      start_period: 10s

  backend:
    depends_on:
      db:
        condition: service_healthy   # was: - db
      redis:
        condition: service_started
```

Verify by reproducing the race deliberately — `kill` is an unclean stop, so the next boot
really does run recovery:

```bash
docker compose kill db backend && docker compose --profile docker up -d
#  Container taskhub-db-1  Waiting
#  Container taskhub-db-1  Healthy      ← compose now blocks here
#  Container taskhub-backend-1  Starting
```

For the **host** backend the same gate lives in `scripts/cronsole.ps1` as `Wait-Db`, which polls
the db container's health before launching it. `cronsole up` now prints `db ready (accepting
connections)` before `started backend` — if you don't see that line, you're on the old script.

### The deeper cause: two stacks were running at once

The race is what killed it, but **duplicate stacks are what made it confusing and hard to
see.** This repo can run the backend/frontend two ways, and both were live:

- **The design** (`scripts/cronsole.ps1`, and the sign-in Scheduled Task): Docker runs **db +
  redis only**; backend, frontend, and agent are **host** processes.
- **A stray `docker compose up -d`**, which used to start `backend` and `frontend` containers too.

The container grabbed `:3000` first. The host backend then couldn't bind it and died. When the
container *also* died on the DB race, the port was left held by a dead process — and because
`cronsole.ps1` tested liveness with `Test-Port 3000`, it reported **`backend already up`** and
refused to start the real one. Every layer was reporting something true and the sum was a lie.

**Fixed 2026-07-27:** `backend` and `frontend` are now `profiles: ["docker"]`, so a plain
`docker compose up -d` starts **db + redis only** and cannot collide with the host stack. The
containerized variant is explicit: `docker compose --profile docker up -d`. `cronsole status`
also now calls out the specific state that hid this — `:3000` bound while `/api/health` fails.

> [!TIP]
> **A crashed process behind a live supervisor never trips `restart:`.** Any dev container whose
> command is a watcher (`tsx watch`, `nodemon`, `vite`) will sit `Up` and idle after the app
> inside it dies. "Container is `Up`" is not "app is serving" — ask the app
> ([#3](#3-port-listening-but-http-000--eaddrinuse)).

> [!IMPORTANT]
> **Never probe your own service with a bare port check.** A bound port proves *something*
> holds it, not that your app is behind it — and the failure mode it hides is the one where a
> dead process squats the port your live process needs. Probe the **health endpoint**.

*First hit: 2026-07-27 (reported as "Cronsole is giving me a network error". The UI itself loaded
fine — it's served by a **host** Vite dev server, independent of the dead backend — which is
exactly why it presented as a network error rather than a blank page. The frontend moved off
Vite's default `5173` to `7373` in the same change, since the two frontends had been fighting
over it.)*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

### 23a. …and the same probe reported four services DOWN while all four were serving

**Symptom** — `cronsole status` prints `[DOWN]` for Postgres, Redis, the backend **and** the
frontend, and `=> DOWN` at the bottom — while `curl http://localhost:3000/api/health` returns
**200** and the frontend returns **200** in a browser. Everything works; the control surface
says nothing does.

**Cause** — the same one as #23, pointing the other way. Every row was a **port check**, and a
port check has two ways to be wrong:

| | What the probe saw | What it printed | Truth |
|:---|:---|:---|:---|
| #23 | `:3000` is bound | "backend already up" | a dead container's proxy held it |
| #23a | `Get-NetTCPConnection` threw | "backend is DOWN" | the backend was serving fine |

`Get-NetTCPConnection` needs the **NetTCPIP CIM provider**, and `Test-Container` needs a
resolvable **docker CLI**. Neither is available in every shell or sandbox. Both probes were
wrapped in `catch { $false }` — so *"I could not run the probe"* and *"the service is down"*
came out as the same word. Four services reported down, none of them was.

**Fix (shipped 2026-07-28)** — ask the service, not the port:

| Service | Probe | Corroboration |
|:---|:---|:---|
| Backend | `GET /api/health` | TCP connect to `:3000` |
| Frontend | `GET /` | TCP connect to `:7373` |
| Postgres | docker healthcheck, else `pg_isready` | TCP connect to `:5432` |
| Redis | **RESP `PING` over the socket** (no docker needed) | TCP connect to `:6379` |
| Agent | the `Cronsole.Agent` process | — (it binds nothing; it dials **out**) |

Three things make this honest rather than just different:

1. **A third state.** Present-but-unconfirmable is `[WARN]`, never a confident UP or DOWN.
2. **The signal is printed next to every row** (`GET /api/health -> 200`). A claim without its
   evidence is useless exactly when the claim is wrong.
3. **The port probe attempts a real TCP connect** before falling back to the listener table, so
   a missing CIM provider no longer looks like an absent service.

> [!IMPORTANT]
> **A control surface that is wrong in both directions is worse than no control surface**,
> because it is consulted first and believed. If a probe can fail for reasons unrelated to the
> service, it must be able to say *"I don't know"* — collapsing that into "down" (or "up") is
> the confident lie, aimed at the person debugging.

*First hit: 2026-07-28, found by an outside review pass whose shell had neither the CIM provider
nor a resolvable docker path. Worth noting the generalization from #23 — "never probe your own
service with a bare port check" — was already written down; the script just hadn't been changed
to follow it. A rule in a doc is not a rule in the code.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 24. `showDirectoryPicker()` throws "must be handling a user gesture" after an `await`

**Symptom** — the bulk export's folder picker never opens. The console shows:

```
SecurityError: Failed to execute 'showDirectoryPicker' on 'Window':
Must be handling a user gesture to show a file picker.
```

…from code that is unambiguously inside a click handler. Adding more logging confirms the
handler runs, the function is called, and the browser still refuses.

**Cause** — the File System Access API requires **transient user activation**: a short-lived
window of "the user just did something" that a click grants and that **expires**. Any `await`
before the picker call can consume it. The natural shape is the trap:

```ts
// WRONG — activation is gone by the time the request resolves
const res = await api.post('/tools/export/tasks', body);   // network round-trip
const dir = await showDirectoryPicker();                   // SecurityError
```

This is easy to misdiagnose because nothing about the error mentions timing — it says
"gesture", so you go looking at your event wiring, which is fine.

**Fix** — open the picker **first**, then fetch:

```ts
// RIGHT — the picker rides the click's activation; the request comes after
const dir = await pickDirectory();
if (!dir) return;                       // cancelled: nothing else has happened yet
const res = await api.post('/tools/export/tasks', body);
```

Two bonuses fall out of the correct order: cancelling costs nothing (no export has run), and
the user picks a destination before waiting instead of after.

> [!TIP]
> Treat user activation as a **budget spent by the first `await`**, not as a property of being
> inside a handler. The same rule governs `requestFullscreen`, clipboard writes, and popups.

Also worth knowing while working on this path:

- **`showDirectoryPicker` is Chromium-only**, so the ZIP fallback is not optional decoration —
  it is the whole experience on Firefox and Safari. It needs a **secure context**, which
  `localhost` satisfies, so a local-first app gets the good path without HTTPS.
- **Cancelling the dialog throws `AbortError`** rather than returning null. Treat it as "no",
  not as a failure worth surfacing.
- **The native dialog cannot be driven by browser automation.** Test the *writing* logic
  against a fake directory handle and accept the dialog itself as a manual check, rather than
  pretending the path is covered.

*First hit: 2026-07-28, building the Tools tab's bulk export.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 25. `npx tsc --noEmit` in `frontend/` passes while CI's build fails on a type error

**Symptom** — you typecheck the frontend locally, it exits **0**, you push, and CI's
`Frontend lint and build` job fails on `tsc -b` with type errors in the very code you just
"checked". The errors are real and reproduce instantly with `npm run build`.

**Cause** — **`npx tsc --noEmit` in `frontend/` checks nothing at all.** The root
`tsconfig.json` is a solution file:

```json
{ "files": [], "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" }] }
```

`files: []` means zero root files, and a plain `tsc --noEmit` invocation **does not follow
project references** — so it compiles an empty program and exits 0. Every time. Verified by
planting `const x: number = 'nope';` in `src/hooks/useTheme.ts`: `npx tsc --noEmit` → exit 0,
`npx tsc -b` → `TS2322`.

**Fix** — typecheck the way CI does:

```powershell
cd frontend
npm run build      # tsc -b && vite build  <- the real check
# or just the type half:
npx tsc -b
```

**The concrete class of bug this hides:** the two projects have *different* `types`.
`tsconfig.app.json` is `["vite/client"]` (browser) and `tsconfig.node.json` is `["node"]`.
A test file under `src/` that imports `node:fs` compiles fine under a config that checks
nothing and fails under the app project. Read a repo file from a frontend test with Vite's
`?raw` import instead — `import html from '../../../index.html?raw'` — which needs no node
types and is what the bundler does anyway.

> [!IMPORTANT]
> **A verification command that can't fail isn't verification.** This is the same rule the
> catalog learned in [#12](#12-a-template-passes-every-test-and-still-hangs-on-the-target) and
> the MCP suite learned by mutation testing, aimed one level up — at the *command you check
> with* rather than the tests it runs. If a check has never failed for you, break something on
> purpose once and confirm it goes red.

*First hit: 2026-07-28, clearing P1 — the local typecheck was green and CI was not, on the same
tree. Cheap to hit and cheap to avoid, but it costs a full CI round-trip every time.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 26. `prisma generate` fails with `EPERM: operation not permitted, rename … query_engine-windows.dll.node`

**Symptom** — after a schema change, `npx prisma migrate dev` applies the migration and then dies
on the generate step:

```
EPERM: operation not permitted, rename
'…\node_modules\.prisma\client\query_engine-windows.dll.node.tmp37704' ->
'…\node_modules\.prisma\client\query_engine-windows.dll.node'
```

**Cause** — the **running backend has the query engine DLL open**, and Windows won't let Prisma
rename over a loaded file. Nothing is corrupt; the write simply didn't happen.

**Why it matters more than a failed command** — the migration already ran. So the **database has
the new schema and the generated client does not**, which is the same drift that made the MISSING
feature a silent no-op for nine days ([#22](#22-deleted-a-windows-task-synced-and-cronsole-still-shows-it--while-reporting-missing-n)).
Here the failure is at least loud, and the new-model case fails loudly at runtime too
(`prisma.taskExclusion` is `undefined` → `TypeError`). A new **enum value** would not — Prisma
drops `undefined` from a `data` payload and reports success.

**Fix** — stop the backend, generate, restart:

```powershell
# host stack (scripts/cronsole.ps1 runs backend/frontend on the host)
Get-NetTCPConnection -State Listen -LocalPort 3000 | Select-Object -First 1 |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
cd backend; npx prisma generate
pwsh scripts\cronsole.ps1 up
```

In the **containerized** variant the DLL lives inside the container and `node_modules` is a
shadowed volume, so the host command never reaches it — see [#18](#18-new-npm-dependency-module_not_found-in-the-container-after-a-restart)
and use `docker compose exec backend npx prisma generate && docker restart taskhub-backend-1`.

> [!TIP]
> **After any schema change, prove the client actually regenerated** rather than assuming the
> command that printed an error didn't matter:
> `node -e "console.log(Object.keys(require('@prisma/client').PrismaClient.prototype))"`, or just
> touch the new model/enum once. "Migration applied" and "client regenerated" are two events, and
> only one of them is loud when it fails.

*First hit: 2026-07-28, adding the `TaskExclusion` model for untrack.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 27. A route that takes an upload 413s — and raising the global body limit is the wrong fix

**Symptom** — a restore of a real backup (95 tasks of Task Scheduler XML, base64-encoded) is
rejected before the route runs:

```
PayloadTooLargeError: request entity too large
```

Small selections work fine, which makes it look like a bug in the feature rather than a ceiling.

**Cause** — `express.json()` defaults to a **100 kB** limit. That is generous for every other
route in this API and nowhere near enough for one that uploads files.

**The wrong fix, and why** — raising the *global* parser (`express.json({ limit: '32mb' })` in
`createApp`) makes the error go away and hands **every endpoint in the API** a 32 MB request
budget, including unauthenticated ones. A body cap is a cheap denial-of-service control; widening
it for all routes to unblock one is trading a real guard for convenience, and nothing will ever
fail to tell you that you did.

**Fix** — mount a second, larger parser **scoped to the one path**, *before* the global one:

```ts
// backend/src/app.ts
app.use('/api/tools/restore', express.json({ limit: '32mb' }));
app.use(express.json());
```

**The ordering is load-bearing and non-obvious.** `body-parser` short-circuits on a request another
parser already consumed (it checks `req._body`), so the scoped parser must run **first** — put it
after the global one and it never fires, because the 100 kB parser has already read the stream and
thrown. The symptom of getting this backwards is identical to not having added it at all, which is
what makes it worth a note: you will have written the right code and still see the same 413.

**Generalization** — *a limit that exists for security should be relaxed at the narrowest scope that
unblocks the work, never at the widest one that makes the error stop.* And when middleware order
decides whether your code runs at all, assert it: the integration test posts a body over 100 kB and
requires a `502` (agent offline — the route ran) rather than a `413`, so the wiring cannot silently
regress.

*First hit: 2026-07-28, building the restore route.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 28. A restored task (or the folder it landed in) can't be deleted: "Access is denied"

**Symptom** — you restore a task from a backup, then try to remove it the way you created it:

```powershell
Unregister-ScheduledTask -TaskPath '\MyFolder\' -TaskName 'Probe'
# Unregister-ScheduledTask : Access is denied.

$svc.GetFolder('\').DeleteFolder('MyFolder', 0)
# Access is denied. (0x80070005 (E_ACCESSDENIED))
```

The confusing part: **you created the original task yourself, unelevated, and could delete it fine.**
The restored copy looks identical in Task Scheduler and refuses.

**Cause** — the restore is performed by the **Cronsole agent, which runs elevated**. Windows adds an
ACE for the registering context, so the task — and any folder created for it — end up owned by an
administrator. An unelevated prompt can read them and cannot remove them. This is the same
condition [`FriendlyDeleteError`](../../agent/Cronsole.Agent/AgentService.cs) already explains for
`task:delete`; restore just makes it reachable for tasks you used to own outright.

**Fix — for the task:** delete it *through Cronsole*, which routes the delete back through the same
elevated agent that created it. Import the folder (Dashboard → Import), then Delete from Windows.
Or open Task Scheduler **as administrator** and delete it there.

**Fix — for the folder:** there is no in-app route. Cronsole only ever prunes its own `\Cronsole`, on
purpose ("never delete what isn't yours"), so a folder restore created has to go from an elevated
prompt:

```powershell
# Run as Administrator
$svc = New-Object -ComObject Schedule.Service; $svc.Connect()
$svc.GetFolder('\').DeleteFolder('MyFolder', 0)
```

**Worth knowing before you restore** — this is the concrete cost of restore's carve-out to *"Cronsole
creates exactly one folder"*. Recreating a folder tree is the right call for a restore (the
alternative refuses every task in the archive on a reinstalled machine), but **a folder created that
way is a one-way door for anyone without elevation** — a sharper version of the original rationale,
which only assumed the folder would be annoying to remove, not that it would need admin. The restore
UI says so on the checkbox and again in the plan, so it is a decision rather than a surprise.

*First hit: 2026-07-28, live-verifying restore against real Task Scheduler.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 29. `prisma migrate` refuses to run: "migration was modified after it was applied" — and offers to drop your database

**Symptom** — any `prisma migrate dev`, including one that adds a harmless index, stops before doing
anything:

```
The migration `20260728203202_add_task_exclusions` was modified after it was applied.
We need to reset the "public" schema at "localhost:5432"

You may use prisma migrate reset to drop the development database.
All data will be lost.
```

**Cause** — Prisma stores a **sha256 of each migration file** in `_prisma_migrations.checksum` and
re-checks it on every run. Editing an applied migration file changes the hash. In our case the SQL
was never touched: an explanatory comment header was added to the file *after* it ran, while
documenting the feature. Different bytes, same behavior — and Prisma cannot tell those apart.

**Do not run `prisma migrate reset`.** It is the only remedy Prisma suggests and it drops the
development database. On a local-first app that is the user's real data: their tasks, their login,
their history.

**Fix — verify first, then re-record the checksum.** The safe move is to prove the database already
matches what the file describes, and only then tell Prisma the file is the one that was applied:

```bash
# 1. Does the DB actually contain what this migration declares?
docker exec taskhub-db-1 psql -U cronsole -d cronsole -c '\d "TaskExclusion"'
docker exec taskhub-db-1 psql -U cronsole -d cronsole \
  -c "SELECT indexname FROM pg_indexes WHERE tablename='TaskExclusion';"

# 2. Only if it does — re-record the file's current hash.
SUM=$(node -e "console.log(require('crypto').createHash('sha256')\
  .update(require('fs').readFileSync('prisma/migrations/<name>/migration.sql')).digest('hex'))")
docker exec taskhub-db-1 psql -U cronsole -d cronsole \
  -c "UPDATE _prisma_migrations SET checksum='$SUM' WHERE migration_name='<name>';"

npx prisma migrate status   # -> "Database schema is up to date!"
```

**Then avoid `migrate dev` for the new migration too.** `--create-only` writes the SQL without
applying, and **`prisma migrate deploy` applies without running `generate`** — which also sidesteps
[#26](#26-prisma-generate-fails-with-eperm-operation-not-permitted-rename--query_engine-windowsdllnode)'s
EPERM entirely when the backend is running. An index needs no client regeneration anyway.

**The rule worth keeping: an applied migration file is immutable, comments included.** If you want
to explain a migration, explain it in the schema, the ADR, or the code — not by editing a file whose
bytes are a checksum. And when a tool's only suggested remedy destroys data, that is the moment to
verify the actual state by hand rather than take the suggestion.

*First hit: 2026-07-28, adding an index for the run-history query.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 30. A route 500s on real data while `tsc` is green — a cast on a query result

**Symptom** — an endpoint typechecks, passes its unit tests, and returns
`{"error":"Internal server error"}` the first time it runs against the real database.

**Cause** — a Prisma `select` that no longer supplies every field the consumer needs, hidden by a
cast:

```ts
const tasks = await prisma.task.findMany({ select: { id: true, name: true, /* … */ } });
//                                          ^ externalId was never added here
const results = tasks.map(t => scoreTask(t as HealthInputTask, now));
//                                         ^^^^^^^^^^^^^^^^^^ silences the compiler
```

`scoreTask` gained a required `externalId`; the `select` didn't. **The cast is the bug** — it told
TypeScript to stop checking exactly the boundary that had drifted, so the missing field became a
runtime `undefined` and threw inside the callee.

**Fix** — delete the cast and let the query result type flow:

```ts
const results = tasks.map(t => scoreTask(t, now));   // now `tsc` names the missing field
```

Prisma generates a precise type for every `select`, so an un-cast result is *already* the strongest
check available — assigning it to a hand-written interface proves the two agree. A cast throws that
away.

**Generalization: a cast on a query result is a promise the query cannot keep.** It is the same
shape as [#22](#22-deleted-a-windows-task-synced-and-cronsole-still-shows-it--while-reporting-missing-n)
(a mock asserting the code's intent while the container disagreed) and
[#25](#25-npx-tsc---noemit-in-frontend-passes-while-cis-build-fails-on-a-type-error) (a check that
cannot fail): **when you disable the thing that would have told you, the failure moves to
production.** If a cast feels necessary at a data boundary, that is the signal the boundary is
wrong, not the type.

*First hit: 2026-07-28, wiring the system-task predicate into the health score.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 31. The dashboard loads but every API call fails with a CORS error

**Symptom** — the app shell renders, the task list stays empty, and the browser console shows

```
Access to XMLHttpRequest at 'http://localhost:3000/api/tasks' from origin
'http://localhost:7373' has been blocked by CORS policy: No 'Access-Control-Allow-Origin'
header is present on the requested resource.
```

The backend is up (`GET /api/health` returns 200 from `curl`), and `curl` against the same
API route works fine — which is the tell.

**Diagnose it from the backend log first — it names the answer:**

```
CORS: refused origin "http://192.168.1.40:7373" — not in ALLOWED_ORIGINS
(allowed: http://localhost:7373). If that is your dashboard, add it to
ALLOWED_ORIGINS and restart the backend.
```

That line is written **once per distinct origin** (`logs/backend.err.log`, or `docker logs`),
so it won't repeat while a retrying dashboard hammers the API. The server is the only party
that knows both the rejected origin *and* the configured list, which is exactly why this
otherwise sends people to debug their frontend.

**Cause** — since 2026-07-31 the REST API enforces `ALLOWED_ORIGINS` (it previously reflected
any origin), and the origin the dashboard is served from isn't on the list. It bites in three
situations:

- the frontend moved port, or you're reaching it by a hostname/IP rather than `localhost`;
- you set the **Settings → About → API origin** override, or reached Cronsole over Tailscale /
  a tunnel, so the browser origin is no longer the one in `.env`;
- `ALLOWED_ORIGINS` was never set *and* something else on the list is — an empty list is
  permissive, but a list with one wrong entry is not.

`curl` succeeds throughout because it sends no `Origin` header, and a request without one is
always allowed (non-browser callers are gated by authentication, not CORS). **A working
`curl` is not evidence the browser can reach the API.**

**Fix** — add the exact origin the browser shows (scheme + host + port, no trailing slash) to
`ALLOWED_ORIGINS` in `backend/.env`, then restart the backend:

```bash
ALLOWED_ORIGINS="http://localhost:7373,http://my-pc.tailnet-name.ts.net:7373"
```

The same list gates the Socket.IO `/ui` channel, so a missing origin also silently costs you
live task updates. If it is unset entirely, the backend says so at boot:
`ALLOWED_ORIGINS is unset — the REST API accepts requests from any browser origin.`

*First hit: 2026-07-31, aligning REST CORS with the socket's origin list (Go-public checklist).*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 32. A PowerShell check against the API matches everything, or renders a blank row

**Symptom** — a filter that should select one task returns **every** task:

```powershell
$task = Invoke-RestMethod "http://localhost:3000/api/tasks" -Headers $H |
  Where-Object { $_.name -eq 'manual-test-lifecycle' }
$task.id     # -> prints ~350 ids, not one
```

…or a projection prints a header and a single **blank** row:

```powershell
Invoke-RestMethod "http://localhost:3000/api/tasks/$taskId/executions" -Headers $H |
  Select-Object status, triggeredAt, durationMs
# status triggeredAt durationMs
# ------ ----------- ----------
#                                <- one empty row, though the rows exist
```

The endpoint is fine — `Invoke-WebRequest` on the same URL returns correct JSON, and the DB
agrees.

**Cause** — **`Invoke-RestMethod` writes its deserialized array to the pipeline as a single
object** rather than enumerating it. The next command therefore receives one `Object[]`, not N
task objects:

- `Where-Object { $_.name -eq 'x' }` — `$_` **is the array**. PowerShell's member enumeration
  makes `$_.name` an *array of names*, and `array -eq 'x'` is a filtering operator that returns
  the **matching elements**. A non-empty result is truthy, so the whole array passes the filter.
- `Select-Object status` — `Select-Object` does *not* member-enumerate, so it builds one object
  whose `status` is `$null`: the blank row.

Assigning to a variable first fixes both, because piping a *variable* does enumerate.

**Fix** — assign, then filter, and wrap in `@()` before `.Count` or indexing:

```powershell
$all  = Invoke-RestMethod "http://localhost:3000/api/tasks" -Headers $H
$task = @($all | Where-Object { $_.name -eq 'manual-test-lifecycle' })[0]
$task.id
```

> [!WARNING]
> **The dangerous shape is a check meant to prove something is *gone*.** The manual-testing
> runbook used the broken form to assert an untracked row had left the DB:
>
> ```powershell
> (Invoke-RestMethod ".../api/tasks" -Headers $H |
>   Where-Object { $_.externalId -eq '\Cronsole\manual-test-lifecycle' }).Count   # -> 0
> ```
>
> With nothing matching, the array is filtered out and this correctly prints `0` — so it passes
> and looks right. But had untrack failed to remove the row, it would have printed the **full
> task count**, not `1`. **The check could never fail in the direction it existed to test.**
> Fixed in `Windows_Task_Lifecycle.md` § 12a and `Template_Apply.md` on 2026-07-31.

> [!TIP]
> The tell that separates this from a real API bug: fetch the same URL with
> **`Invoke-WebRequest`** and read `.Content`. If the raw JSON is right, the bug is in the
> pipeline, not the server. Related in spirit to [#25](#25-npx-tsc---noemit-in-frontend-passes-while-cis-build-fails-on-a-type-error)
> — *a verification command that cannot fail is not verification.*

*First hit: 2026-07-31, during a manual Windows Task Lifecycle run.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 33. A rename pass silently disables the back-compat it just added — and rewrites the tests too

**Symptom** — a rename lands, every suite is green, and a previously working setup stops
working: the MCP tools vanish, or failure webhooks stop firing, or an agent can't find its
pairing secret. Nothing errors.

**Cause** — the compatibility shim contained the old name as a literal, so the rename pass
rewrote it:

```ts
// intended
const value = process.env[`CRONSOLE_${name}`] ?? process.env[`TASKHUB_${name}`];
// after the pass
const value = process.env[`CRONSOLE_${name}`] ?? process.env[`CRONSOLE_${name}`];
```

The result compiles, reads correctly at a glance, and is a tautology. **The pass rewrites the
guarding test the same way**, so `expect(legacy).toBe(...)` becomes an assertion about the new
name and keeps passing — the shim and its alarm are disabled together, which is why nothing
catches it.

**Fix** — never write the old name as a literal in the thing meant to survive the rename.
Assemble it, so a text pass has nothing to match:

```ts
const LEGACY_PREFIX = ['TASK', 'HUB'].join('');
```

Then mutation-check it: break the prefix on purpose and confirm a test fails. If none does,
the shim is decoration.

**Generalization: a mechanical transformation cannot be trusted near the code that exists to
survive that transformation.** The same shape as
[#25](#25-npx-tsc---noemit-in-frontend-passes-while-cis-build-fails-on-a-type-error) and
[#30](#30-a-route-500s-on-real-data-while-tsc-is-green--a-cast-on-a-query-result): when the
thing that would have told you is itself disabled, the failure moves to production. Related
trap found in the same migration — **a PowerShell script ending in `Stop-Process -Id $PID`
kills its caller**, so a registrar invoked with `&` takes the calling script down with it and
the run merely looks like it stopped early. Invoke such scripts as a child process, and verify
their effect by querying the system, not by an exit code a self-killing script can't produce.

**And a guard can have the same blind spot.** `check-control-bytes` scanned `git ls-files` —
**tracked** files only — so a brand-new file was invisible to it until the commit that added
it. The single commit most likely to introduce a stray byte was the one commit the check
couldn't pre-validate, and `scripts/rename-stage2.mjs` shipped with two literal `0x01` bytes
while the check reported OK moments earlier. It now scans `--cached --others
--exclude-standard` (tracked *and* untracked, still honoring `.gitignore`). **When a guard
reports "clean", ask what it looked at** — a check that cannot see new files is weakest exactly
where new problems come from.

**A second-order consequence, worth knowing before you restore anything:** a task backup
records **absolute paths**, and paths are machine state — so any rename or move silently ages
every archive taken before it, and the archive cannot tell you that. A `\Task-Hub\` export from
three days before this rename still points at `Start-TaskHub.ps1` and `taskhub.ps1`; restoring
it now would register tasks that **fail silently** at logon, because `wscript.exe` launching a
missing `.ps1` opens no window and reports nothing. Restore's plan does not catch this — it
validates `\Microsoft\`, folder existence, and whether the task already exists, not whether the
action points at a file that is there. **After renaming or moving anything a scheduled task
references, take a fresh export and treat the old one as history, not as a restore point.**

**It recurred one stage later, in a different disguise — so treat this as a pattern, not an
incident.** Stage 3 renamed the public repos, and its pass matched
`scripts/rename-stage2.mjs`, which holds the literal strings `'taskhub-registry'`,
`'taskhub-site'` and `'michaelschecht/taskhub'` under the comment `// Stage 3 (public
surface).` Those strings are **stage 2's protection list** — the record of what it deliberately
did *not* rename. Rewriting them yields a script that still parses, still reads correctly, and
now misreports its own scope, having erased the evidence of the boundary it was drawing. Stage 2
was bitten by a pass eating its **back-compat shim**; stage 3 nearly lost the **record of the
exception**. Same mechanism both times: **the artifacts that describe a rename are made of the
very strings the rename matches, and a mechanical pass cannot tell a name being used from a name
being quoted.** Add every such file to an explicit protection list before running the pass, and
diff the protection list itself afterwards.

*First hit: 2026-07-31, stage 2 of the TaskHub → Cronsole rename. Recurred the same day in
stage 3.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 34. The old custom domain 404s after moving a Pages site to a new one

**Symptom** — you move a GitHub Pages site to a new custom domain, leave the old subdomain's
DNS record in place expecting it to forward, and the old URL returns a bare **404** on both
`http` and `https`. No redirect, no `Location` header. The new domain serves `200` perfectly,
so the move itself plainly worked.

**Cause** — **GitHub Pages redirects only the `<user>.github.io/<repo>` path to the configured
custom domain. It does not redirect a *second* custom domain that merely points at the same
Pages IP addresses.** Serving is keyed on the `Host` header matching the repo's `CNAME` file;
a request arriving with any other `Host` has no site to match and gets a 404. DNS resolving
correctly is necessary but not sufficient — the record gets the request to GitHub's front
door, and GitHub then declines it.

**The trap is that the DNS looks healthy.** `nslookup` returns the right `CNAME` and the right
GitHub IPs, so every check you would naturally run says the old subdomain is fine. The failure
lives one layer above DNS, in vhost routing you cannot see from a resolver.

**Fix** — pick one deliberately, because the default is a dead link:

- **Accept the 404** and remove the old DNS record too, so it `NXDOMAIN`s instead. A name that
  doesn't resolve is a clearer signal than one that resolves to a 404 — the second reads as
  "the site is broken", the first as "this address is gone."
- **Serve a real redirect**: point the old subdomain at a minimal repo whose `CNAME` is the
  *old* name and whose `index.html` is a `<meta http-equiv="refresh">` plus a
  `<link rel="canonical">` to the new domain. One custom domain per repo is the constraint that
  forces a second repo here.
- **Redirect at the registrar/CDN** if it offers subdomain forwarding (Squarespace does not for
  a subdomain delegated to GitHub via `CNAME`).

**The generalizable part:** *"the DNS record still points there"* is not the same claim as
*"the server will still answer for that name."* Verify a domain move by requesting the **old**
URL and reading the status code, not by confirming the record resolves — same family as
[#23](#23-network-error-after-a-reboot--the-database-system-is-starting-up)'s bound port that
proved something was listening but not that it was yours.

**How it was actually resolved here (2026-07-31):** the `taskhub.mikesailab.com` record was
**deleted**. The redirect repo was considered and rejected — the front door predated public
launch and the URL was never advertised, so there was nothing to forward. Confirmed
`NXDOMAIN` on both `8.8.8.8` and `1.1.1.1`. Note that the machine you are testing from will
keep answering from its **own DNS cache** for the record's remaining TTL after the record is
gone: `curl` still returned 404 here until `Clear-DnsClientCache` ran. **Check a public
resolver before concluding the deletion didn't take.**

*First hit: 2026-07-31, stage 3 of the TaskHub → Cronsole rename — predicted as a free
redirect, verified as a 404, resolved by deletion.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 35. The checkout rename fails with `Access to the path is denied` — right after `down` reported everything stopped

**Symptom** — `Migrate-RepoFolder.ps1` disables the launcher tasks, stops the stack, prints a clean
shutdown, and then loses all ten rename attempts:

```
    stopped agent
    stopped backend (pid 31292)
    stopped frontend (pid 12188)
Waiting for handles to clear, then renaming...
Could not rename after 10 attempts: Access to the path
'…\Live_Apps\taskhub' is denied.
```

**Cause — `Stop-Port` kills the process that owns the listening socket, which is not the process
that owns the folder.** Under `npm run dev` the tree is three deep:

```
cmd.exe  (npm run dev wrapper)      <- survives, CWD = backend\
  node   (tsx watch src/index.ts)   <- survives, CWD = backend\
    node (the actual :3000 listener) <- the only one Stop-Port sees
```

Killing the listener frees the port and stops the service, so **the shutdown report was true** — it
just wasn't the claim that mattered. The two ancestors keep running, and **a process's current
directory is an open directory handle**; Windows will not rename a directory that has one. Here the
watcher had been up for four days, long enough that nothing connected it to the rename.

**The wrong turn it produces:** the old error listed "an editor or terminal with that folder open,
or Explorer" as common culprits, so the hunt starts with windows to close — while the actual holder
is a headless `tsx watch` no window will ever reveal.

**The second holder is the one you're typing in.** An editor, terminal, or AI coding session whose
CWD is the folder holds an identical handle. It cannot be killed from inside itself, and it does not
name the path on its command line, so no process scan will list it. If the rename still fails after
the stack is down, **close the session that is sitting in the folder and re-run from elsewhere.**

**Fixed 2026-07-31** — `Invoke-Down` now calls `Stop-DevServerTree`, which sweeps any `node.exe` /
`cmd.exe` whose *command line* names `backend\` or `frontend\` under the repo. Matching the command
line rather than the CWD is deliberate: it catches every process the script started and cannot
reach an editor or agent that merely happens to be sitting there. `Migrate-RepoFolder.ps1` now
**names the surviving holders** in its failure message, and says plainly that an empty list means
the holder is a CWD it cannot see.

**Clearing it by hand:**

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -like '*Live_Apps\taskhub\backend*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

**If the migration already aborted, the launcher tasks are left DISABLED** — that is the script
being careful, but a disabled `\Cronsole-Stack\` is a silent no-start at next logon. Either re-run
the migration (it re-enables and verifies at the end) or re-enable them **from an elevated shell** —
they are `RunLevel Highest`, so an unelevated `Enable-ScheduledTask` fails with `Access is denied`:

```powershell
'CronsoleAgent','CronsoleRepublish','CronsoleStack' |
  ForEach-Object { Enable-ScheduledTask -TaskPath '\Cronsole-Stack\' -TaskName $_ }
```

**The generalizable part:** *"the service is stopped"* and *"nothing is holding the folder"* are
different claims, and the first is what every shutdown routine is built to verify. Same family as
[#23](#23-network-error-after-a-reboot--the-database-system-is-starting-up) — where a `tsx watch`
surviving a crash is exactly what kept the container alive and stopped `restart: unless-stopped`
from ever firing.

*First hit: 2026-07-31, stage 4 of the TaskHub → Cronsole rename (the checkout-folder migration).*

### 35a. …and the holder was the agent itself, running under its pre-rename name

**Symptom** — the same failure, one layer further in. With `Stop-DevServerTree` shipped and no
watcher left, the migration still lost all ten attempts — and this time its own failure message
named the holder:

```
    Stopping the Cronsole app tier...
      agent already stopped
      backend already stopped
      frontend already stopped
Waiting for handles to clear, then renaming...
Could not rename after 10 attempts: The process cannot access the file
because it is being used by another process.
Processes naming that path right now:
    pid 47312  TaskHub.Agent.exe
```

Read those two lines together: **"agent already stopped" and "pid 47312 TaskHub.Agent.exe" are on
the same screen.** That contradiction is the whole diagnosis.

**Cause — the exe was renamed `TaskHub.Agent` → `Cronsole.Agent`, but a process keeps the name it
was launched with.** This agent started 2026-07-28, three days *before* the rename. Every "stop the
agent" call site had been updated to the new name and to nothing else:

| Call site | Looked for | Found the running agent? |
|---|---|---|
| `cronsole.ps1` › `Get-AgentProbe` | `Cronsole.Agent` | no → reported **DOWN** |
| `cronsole.ps1` › `Invoke-Down` | `Cronsole.Agent` | no → printed **"agent already stopped"** |
| `Republish-Agent.ps1` | `Cronsole.Agent` | no → **"no Cronsole.Agent process running"**, then published over a locked exe |
| `Migrate-RepoFolder.ps1` | `Cronsole.Agent` | no → renamed into a live handle |

So a rename made three independent shutdown checks *simultaneously* blind, in the one way that
leaves them all still reporting success. `Stop-ScheduledTask` didn't help either: it stops what the
task *launched*, and this process had outlived its launcher.

**The tell:** `(Get-Process -Id <pid>).StartTime` predates the rename. A holder older than the
rename is a holder no post-rename lookup can see.

**A second copy was sitting in `agent\publish\` too.** `dotnet publish` writes into the output
folder without cleaning it, so `TaskHub.Agent.exe` / `.dll` survived alongside the new binaries —
launchable by a double-click into a process nothing would find. Its `runtimeconfig.json` and
`deps.json` had already been replaced, so it could no longer even start: purely a trap.

**Fixed 2026-07-31** — all four call sites now look for **both** names, `Republish-Agent.ps1`
deletes pre-rename leftovers from `agent\publish\` after a successful publish, and the probe
reports a legacy-named agent as **WARN, not UP** — it is genuinely running, but it is also running
code older than the checkout, and a bare `UP` would hide the staler of the two facts. `up` branches
on the *process*, not on the probe state, so a WARN agent doesn't get a second agent started
beside it.

**Also fixed:** the abort path now **re-enables the launcher tasks itself** instead of printing the
command for you. A failed migration that leaves `\Cronsole-Stack\` disabled has silently turned
logon start off, and you find out at the next reboot — the exact silent-breakage shape the script
exists to prevent.

**The generalizable part, and it is not about agents:** *renaming a binary does not rename the
processes already running it.* Any lookup by process name has a blind spot exactly as wide as the
rename, it opens the moment you rename, and it stays open until every pre-rename process has been
restarted — which is precisely the thing the broken lookup can no longer do. **When you rename an
executable, keep the old name in every `Get-Process` / `pkill` / `taskkill` that stops it**, as a
find-only alias. Sibling of [#33](#33-a-rename-pass-silently-disables-the-back-compat-it-just-added--and-rewrites-the-tests-too):
a rename pass keeps finding new surfaces that quietly asserted the old name, and the ones that
*stop* things fail by reporting success.

*First hit: 2026-07-31, immediately after the #35 fix, on the second run of the same migration.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## ➕ Adding a new entry

Keep it short and greppable. For each problem, capture:

1. **Symptom** — the exact error text / observable behavior (so it's searchable).
2. **Cause** — the underlying reason, and any "tell" that distinguishes it.
3. **Fix** — the concrete commands/edits that resolved it.
4. Add a row to the **Quick lookup** table and date it (`*First hit: YYYY-MM-DD.*`).

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

<p align="center">
  <a href="../README.md">Docs Home</a> ·
  <a href="../setup/README.md">Setup</a> ·
  <a href="../install/README.md">Install</a>
</p>
