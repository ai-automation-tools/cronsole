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

> [!TIP]
> **If the dashboard loads, ask Cronsole first.** *Tools › System diagnostics*, or **Diagnose**
> at the end of the Dashboard health strip, reports the agent connection, the database, the
> native scheduler, the catalog, token expiry and the allowed origins — each with the evidence
> behind it. It is read-only and repairs nothing. It is most useful on the entries below that
> present as *"the agent is offline"*, because it says **which** of several very different
> situations that is: a socket that never arrived, one that went away, or a request that timed
> out — with the time and the verb. Over MCP the same report is `get_diagnostics`.
>
> It is served **by the backend**, so it cannot help when the backend, Postgres or Docker is
> what is down — that is the case the entries below are for.

## 🔎 Quick lookup

| # | Symptom | Likely cause | Jump |
|:--|:---|:---|:--|
| 74 | **Dozens of Windows tasks flip to MISSING in one sync**, and the dashboard offers to *Clear 89 missing*. The agent is connected and reads **HEALTHY**; nothing errored; the tasks are plainly still in Task Scheduler | **The agent is running unelevated and cannot see them.** `\Microsoft\Windows\UpdateOrchestrator\`, `\TPM\`, `\Pluton\`, `\WindowsUpdate\`, `\License Manager\`, `\DeviceDirectoryClient\` and friends are ACL'd against non-elevated readers, so an agent started by hand from a normal shell enumerates a smaller machine and `reconcileMissingTasks` faithfully marks the difference. **The tell is the shape**: whole subtrees vanish at once rather than scattered tasks, and they are exactly the protected ones. Compare `(Get-ScheduledTask).Count` elevated vs unelevated — if they differ, that is your answer. Restart the agent through `\Cronsole-Stack\CronsoleAgent` (RunLevel `Highest`), then Sync; MISSING self-heals | [→](#74-dozens-of-windows-tasks-go-missing-in-one-sync-and-the-agent-is-healthy) |
| 78 | **The light theme is hard to read and nothing in it looks obviously wrong.** Panels sit flat on the page, field labels wash out, coloured status dots vanish — and every individual value looks defensible when you open `index.css` | **Colour fails silently, so it has to be measured rather than reviewed.** A role below the WCAG bar renders perfectly. Measuring every role against every *surface* (not just the page) found **26 pairs under AA across both themes**, and the structural fault: light ran `background 100% -> surface 95% -> raised 98%`, putting a *raised* panel at **1.04:1** against the page — flatter than the `surface` card it sits above (1.12) and effectively invisible. `muted` is the binding constraint in light, not `background`, which is why a pass that checked against white missed it. Fixed 2026-08-24: light is now the mirror of dark (1.07/1.14/1.25 vs 1.05/1.16/1.27) and `themeContrast.test.ts` measures every pair, so this cannot recur quietly. **If a colour looks wrong, run that test before opening a picker** | [→](#78-the-light-theme-is-hard-to-read-and-every-value-looks-defensible) |
| 77 | **The Sources tab says a verb failed, and the reason is your own broken file.** Cronsole-native shows *"1 verb failed more recently than it succeeded — Run now: `D:/nope/missing.tar` does not exist (checked on the machine the backend runs on)"*. The platform is otherwise **HEALTHY**, every task runs, and the named file is one *you* pointed a check at | **A `CHECK` that correctly finds a problem was recorded as a failure of the platform's Run verb.** `runTask` returns `success` **and** `ran` because they are orthogonal; the row `success: false, ran: true` is a native job that *executed* and reported bad news — the check working. The route's response branch drew that line correctly (it is what #59 fixed) and the `recordCapability` call four lines above it still passed `result.success`, so one failing check marked Cronsole-native's own Run verb broken and kept the reason. **The tell: the reason names something on your disk rather than anything about Cronsole.** Capability failures do **not** age out — they clear when that verb next succeeds. Fixed 2026-08-24 (`runVerbSucceeded`); **restart the backend**, then run any native task once and the banner clears | [→](#77-the-sources-tab-says-a-verb-failed-and-names-your-own-broken-file) |
| 76 | **Save is blocked on a script or check task** with *"What it runs: A command is required."* — over a form that has no command field. Editing the script body, the interpreter, the working directory or any part of a check reproduces it; an HTTP job on the same screen saves fine. Related: an unreadable **Environment** on a script job reported *"Headers must be JSON…"*, and a script job has no headers | **The edit modal had its own completeness check, and it knew two job types.** `nativeJobIncomplete` is the shared definition — its own doc comment says "shared by the create and edit forms so a job cannot be submittable in one and refused in the other" — but `EditTaskModal` never called it: it asked for a URL on HTTP and a `command` on *everything else*, which SCRIPT and CHECK do not have. The null-payload message was hard-coded to the headers for the same reason. Both are the §9 one-definition rule: a second copy of a judgement drifts the moment the first grows a case. **Fixed 2026-08-24** — the edit modal calls `nativeJobIncomplete`, and the unreadable-field sentence comes from `nativeJobUnreadable`, which names the field | [→](#76-save-is-blocked-on-a-script-task-over-a-command-field-that-does-not-exist) |
| 75 | **A watched GitHub repository imports nothing.** The PAT is valid, the repository is listed, **Sync** reports success and updates `lastSync` on every press, the platform reads **HEALTHY** with `sync` **verified** — and `taskCount` stays `0`, forever, with nothing in the error log | **The plain Sync filters to already-tracked categories, and GitHub records what you asked for in its config rather than in rows.** `scope: 'tracked'` derived the include-set from stored rows (how Windows works — you pick a folder in the discovery modal and the rows are the record), so a freshly added repository had none, the set came back `[]`, and every workflow it read was filtered out. **Adding the repository *is* the naming gesture**, and there was no fallback: the discovery modal talks to the Windows agent. Fixed 2026-08-24 — `PlatformConnector.trackedCategories(config)`, implemented by the GitHub connector as its watched repositories. If you are on older code, the workaround is a `{ categories: ['owner/repo'] }` sync | [→](#75-a-github-repository-is-watched-sync-succeeds-and-no-workflows-ever-arrive) |
| 73 | **Cronsole says a GitHub repository does not exist**, and you are looking at it in the next browser tab. *Watch a repository* fails with a 404 message; **public repositories add fine and only private ones fail**, which reads like a typo you have now checked four times | **GitHub answers `404`, not `403`, for anything a token cannot see** — deliberately, so a token cannot be used to enumerate private repositories. So “not found” is the *expected* symptom of a PAT missing the `repo` scope, and the status code sends you to check spelling instead of scopes. Regenerate the token with **`repo`** (fine-grained: **Contents: read** + **Actions: read** on that repository) and paste it again. Cronsole names the likely cause in the error rather than passing GitHub's word through | [→](#73-cronsole-says-a-github-repository-does-not-exist-and-you-are-looking-at-it) |
| 72 | The **sidebar is half empty at a second address** — pinned folders and saved views are missing at `http://my-pc.my-tailnet.ts.net:8080/`, while **collections and favorites are all there**. Nothing errors, nothing is logged, and the same browser shows them correctly at `localhost` | **`localStorage` is scoped to an origin, and half the rail was in it.** Collections and favorites are database rows keyed on the user, so they followed the account across; rail pins and saved views lived in the `cronsole.settings` blob, which the browser hands out per origin — a different host or port is a different store, and a fresh one is empty. Both halves draw into the same sidebar, so the boundary reads as a bug. **Fixed 2026-08-23:** the whole settings blob syncs through `UserPreference` (`GET`/`PUT /api/preferences`). Theme and the API-origin override still do not sync, deliberately — they describe the device | [→](#72-the-sidebar-is-half-empty-at-a-second-address) |
| 70 | The **Tailscale URL is dead** — `http://my-pc.my-tailnet.ts.net:8080/` returns **502**, empty body, from every device — while everything else is healthy: `cronsole status` says `ALL UP`, `localhost:7373` works, the agent is connected, `tailscale status` lists both machines, and `tailscale serve status` prints the right mapping | **The Caddy proxy container was stopped, and `restart: unless-stopped` means it.** The 502 is `tailscaled` reporting that *its upstream* refused — `curl 127.0.0.1:8080` answers `000` and `docker ps -a` shows `taskhub-proxy-1 Exited (0) 2 days ago`. `unless-stopped` restarts after a crash or a reboot but never undoes a deliberate `docker compose stop`; the proxy is also **profile-gated** (opt-in remote access, §9), so a routine `docker compose up -d` cannot bring it back and does not fail either — and `cronsole up` did not know it existed, so the 5-minute self-heal walked past it. **Fixed 2026-08-20:** `cronsole remote on` records the opt-in in `.cronsole-remote` and `up` starts the proxy. **A 404 here means something else** — `tailscale serve` matched no handler for the Host you sent, which is what curling the tailnet *IP* always does | [→](#70-the-tailscale-url-is-dead-for-days-while-every-other-service-is-healthy) |
| 71 | A Cronsole-native task **will not start** — the run history says *"This job refers to a secret that is not set on this task: X"* and the run is a **502**, not a failed check | Working as designed (ADR 0003). A native job holds `${secret.X}` and the value lives in a separate encrypted row; a reference with nothing behind it is a failure to **start** (`ran: false`), never a verdict about your system, because firing the request with a blank credential comes back as a 401 that reads like an expired token. Set it in the app: task → **Edit** → **Secrets**. `list_task_secrets` reports `referenced` / `stored` / `missing`. **`unreadable: true` is a fourth answer, not an empty list** — the store exists and `ENCRYPTION_KEY` changed, so the values are gone | [→](#71-a-native-task-refuses-to-start-and-names-a-secret) |
| 71a | `prisma generate` fails `EPERM` in a **git worktree**, and there is no backend process to stop — `npm run dev` is not running and `docker ps` shows no backend | A worktree's `backend/node_modules` is a **symlink into the main checkout**, so `generate` writes to the *shared* copy and collides with whatever holds the DLL there — often a `\Cronsole-Stack\` scheduled task, whose command line reads back **blank** from a normal session, so [#26](#26-prisma-generate-fails-with-eperm-operation-not-permitted-rename--query_engine-windowsdllnode)'s "stop the backend" has nothing to aim at. **Rename the DLL aside instead of killing anything** — Windows permits renaming an open file, the running process keeps its handle, and `generate` writes a fresh one | [→](#71a-and-in-a-worktree-there-is-no-process-to-stop) |
| 69 | A published-page check reports the gallery **stale at both public hosts** right after publishing. Both report the *same* hash as each other and a different one from the repo; republishing changes nothing; the same check passes on a Linux CI runner for the same commit | **CRLF in the Windows working tree.** The size gap is exactly the line count (1544 bytes). Git stores the blob LF and hands Windows CRLF; Pages serves the blob, so hashing the file as it sits on disk compares CRLF to LF and can never match. **Two hosts agreeing with each other and disagreeing with you is the tell** — real staleness would rarely hit both identically, since they publish through different paths. **Fixed 2026-08-19** both ways: `registry-site/**` pinned `text eol=lf` (which also stopped `publish-frontdoor.ps1` copying CRLF into the publish clone), and the checker LF-normalizes regardless. Refresh an existing checkout with `rm` + `git checkout --`, since `.gitattributes` does not rewrite files already on disk. **Any check hashing a working-tree file against something served is comparing across a line-ending boundary** | [→](#69-a-published-page-check-reports-both-hosts-stale-and-they-are-not) |
| 68 | You publish the registry after merging new templates and the gallery serves **fewer** than before. `publish-registry.ps1` printed `Published.` and errored on nothing; every served file still matches its `sha256` | **The script publishes the working tree, not `main`.** `$SrcDir` is `$RepoRoot/registry` — whatever is checked out. `mike_desktop` runs ~158 commits behind `main` in ordinary use (PRs merge *into* main and it is never merged back), so publishing from it **replaces** the newer artifact wholesale with an older one. The drift test, content addressing and the push all pass: an old snapshot is internally consistent, and it really did push. **Fixed 2026-08-19** — the script now refuses any branch that is not up-to-date `main` (`-Force` to override), and merging to `main` publishes automatically via `publish-registry.yml`. Verify with `node scripts/check-registry-published.mjs` (daily as **Registry drift**). **The tell: success and failure printed the same thing** | [→](#68-the-hosted-registry-goes-backwards-after-a-successful-publish) |
| 67 | The dashboard shows **no tasks** and every source-rail count reads `0` — `All sources 0`, every source, every folder — while the header above them says *"Manage 373 tasks"*. The stack is healthy: `ALL UP`, agent connected, `GET /api/tasks` returns everything | **A search or filter persisted in the URL.** Filter state *is* the URL by design (§9), so `?q=test-search` survives a reload, a bookmark and a restored tab, and keeps applying until you clear it. The all-zero rail is **intended**: the rail counts over every lens it does not own — including search — because a row's count is a promise about what clicking it does, and clicking it keeps your search. **Read the URL first.** The app does say so, in four places at once: the search box holds the term with an × and `0 matches`, **Filters** carries a badge, **VIEWS** drops to `Custom`, and the empty state reads *"You have 373 tasks. This view shows none of them — it is filtered by matching ..."* with **Clear search** and **Reset to the default view**. **The trap is that an empty dashboard reads like a broken backend**, so two investigations went to auth and to the DB before anyone read the address bar | [→](#67-the-dashboard-shows-no-tasks-and-every-rail-count-reads-0) |
| 66 | `get_diagnostics` says the Windows agent is *"Connected and answering"* while `list_platforms` / the **Platforms** tab says `OFFLINE — Agent not connected`, **in the same second**. The agent is fine and `list_folders` answers on demand. The row contradicts itself: its own **List folders** cell carries a success from a minute ago | **The matrix served a cached verdict nothing on that path refreshes.** `buildPlatformMatrix` read `PlatformConnection.healthState` from the DB, and that column has exactly one writer — the loop inside `GET /api/tasks/health`, the *dashboard's* 45s poll. Nothing on the MCP surface writes it (`get_task_health` wraps `/tools/task-health`), so with no browser tab open the matrix reported whatever the last poll left behind. **Fixed 2026-08-17**: health is derived from `connector.getHealth` at request time, as the diagnostics panel and the health route already did. **This is [#40](#40-the-sidebar-says-windows-is-online-and-synced-just-now-while-every-agent-request-times-out) one layer down — a verdict from a cache instead of a precondition. The question: which code path writes this field, and is it running in the session doing the reading?** | [→](#66-two-cronsole-surfaces-disagree-about-the-agent-in-the-same-second) |
| 65 | You export a task and there is nowhere to import it back. Tools → **Restore** offers `.json` in its file picker and then answers *"No task XML files found"*. Same dead end after a delete: the API returns `archived: true` with an `archiveId` and no verb turns it back into a task | **The export format had no reader.** `cronsoleTaskVersion` appeared in three places repo-wide — the bundle builder, the archive writer, and a test fixture — all writers. So Export produced something shaped like a backup that nothing could restore, and the pre-delete archive was a promise with no way to collect. Restore's `.json` is for the export *manifest*, not a task definition. **Fixed 2026-08-17**: Tools → **Import a task** (native `.json` + deleted-task restore), Restore keeps `.xml`/`.zip` (Windows), and `import_task` / `list_task_archives` / `restore_task_archive` over MCP. **The tell: grep your format constant — if every hit is a writer, the feature is half-built** | [→](#65-an-exported-task-file-has-nowhere-to-go--and-restore-refuses-it) |
| 64 | You edit `registry-site/index.html`, reload the local preview, and the change **is not there** — a new CSS rule reads back as `none`, or new JS behaves like the old code. Nothing errors | **Two independent staleness traps, and they stack.** (1) The preview serves a *copy*: the documented recipe copies `index.html` into a scratch dir, so editing the repo file changes nothing until you re-copy. (2) The gallery is a **hash-router SPA** — navigating to the same `#/...` URL is a hash change, not a load, so neither the CSS nor the JS is re-fetched, and any earlier inline style you injected survives. Fix: re-copy, then **`location.reload(true)`** — not a `navigate` to the same route. Verify the rule is really present (`[...document.styleSheets[0].cssRules].some(r => r.selectorText === '…')`) before concluding a fix failed | [→](#64-a-gallery-change-doesnt-show-up-in-the-local-preview) |
| 63 | Through the tunnel the phone shows the dashboard **fully up to date** and then fails every request with *cannot reach backend*. Same URL works on the machine running the stack; proxy up, tunnel fine, origin allowed | `frontend/dist` was built with **`npm run build`** instead of **`npm run build:remote`**, so Vite inlined the `http://localhost:3000` fallback instead of `same-origin` — on the phone that address is the phone. **The tell is that it is the exact inverse of [#53](#53-the-proxied-dashboard-is-stale-while-the-dev-server-is-current): the proxied page is *current* and the requests fail.** Read the bundle, not the source — both literals appear in every build, so check the call `Ll=Rl(…)`. **Fixed at the root 2026-08-17**: every production build now defaults to same-origin (`FALLBACK_API_ORIGIN` folds on `import.meta.env.DEV`), so `build` and `build:remote` are equivalent and there is no longer a wrong command to run. On an older checkout: `npm run build:remote` | [→](#63-the-proxied-dashboard-loads-on-the-phone-but-cannot-reach-the-backend) |
| 62 | Windows reads **DEGRADED — "Agent connected but not responding (task:list timed out)"** almost permanently, and the health strip names a failed verb, over an agent that answers everything instantly. Sync works, folders list, tasks run | **Every verb scheduled a 15-second timeout and never cancelled it**, so a request answered in 200ms still ran `markUnresponsive` fifteen seconds later. The stale `resolve`/`reject` was a harmless no-op — the promise had settled — so the *only* surviving effect was a stamp on the health record, which is why it was invisible for so long. Windows could not stay HEALTHY longer than 15s after its last request. **Fixed 2026-08-16**: one `agentRequest` helper owns the deadline and clears it when the request settles. **This is [#40](#40-the-sidebar-says-windows-is-online-and-synced-just-now-while-every-agent-request-times-out) with the sign flipped — a status field reporting a failure that never happened**, and the more expensive direction, because it teaches the reader to ignore the one line meant to mean something is wrong | [→](#62-windows-reports-not-responding-15-seconds-after-every-successful-request) |
| 61 | **Every** E2E test fails (`18 of 18`) with `element(s) not found`, while backend/integration/frontend suites are all green and the app works fine in a browser | A **shared helper** referenced a label the UI no longer uses — `dashboardReady()` waited on the heading *"Unified Task Dashboard"*, which the 2026-08-15 redesign replaced with one naming the current scope. One string, every test. Four more assertions named things the redesign **removed** (the source bar, the System Status panel, `Cronsole (Scripts)`, native's unsupported `Edit action`). **Nothing caught it because `test:e2e` is not in CI**, and no other suite can substitute: jsdom does not evaluate media queries, so `hidden md:flex` is invisible to the unit tests. Anchor helpers on `data-testid`, not labels. **Two repair traps: a mask for a removed element masks nothing, and a test that fails only in a full run is unmasked live data, not flake** | [→](#61-the-whole-e2e-suite-fails-and-every-other-suite-is-green) |
| 60 | A schedule with a multi-value hour (`0 9-17 * * 1-5`) is stored **verbatim as UTC** and runs 7–8 hours off — while the hint under the field says *"this schedule has no fixed clock time, so it reads the same in PDT and UTC"* | `shiftCron` correctly declines to shift an hour field that isn't a single number, but returned no **`reason`** — and `ScheduleZoneHint` renders "no reason" as **"the zone is irrelevant"**, so a missing warning became a confident false statement. **Fixed 2026-08-15**: a refusal now asks whether the expression pins a clock time (`hour !== '*'`, or a partial-hour zone with a multi-value minute) and explains itself; genuinely invariant expressions still say nothing. **The general rule: if the empty case has its own message, declining to answer and answering "no problem" are the same code path** | [→](#60-a-schedule-is-stored-78-hours-off-and-the-ui-says-the-timezone-doesnt-matter) |
| 59 | A Cronsole-native `CHECK` that **correctly finds a problem** comes back as HTTP **502** — `run_task` throws, so an agent reports *"I couldn't run the check"* over a message that says the check ran and the endpoint is broken. The dashboard raises a *Failed to run* toast rather than showing a failing result | `POST /api/tasks/:id/run` returned `502` for **every** unsuccessful run. That was right for Windows and Claude, where a failure IS a failure to dispatch — and wrong the moment a job type arrived whose failures are *findings*. `502` means *retry, the gateway had a problem*, so the one job type worth alerting on reported itself in the one way that says ignore this. **Fixed 2026-08-15**: `runTask` gained **`ran`** (orthogonal to `success`), so a job that executed and failed is a **200 carrying `success: false`** and only a genuine failure-to-start is a 502. **The tell: only Cronsole-native can hit it** — it is the one platform where dispatch and execution are the same act | [→](#59-a-check-that-correctly-finds-a-problem-is-reported-as-could-not-run-the-check) |
| 57 | A count beside a filter control disagrees with another count for the same set, and both look right | Two questions sharing one number: *what exists* vs *what clicking reveals*. Anything printed beside a control that changes the list must be **faceted** (every other lens applied); existence counts may only gate whether a control renders | [→](#57-two-counts-for-the-same-set-disagree-on-screen--and-both-are-right) |
| 58 | A published template the running build cannot parse makes the **entire hosted catalog** vanish — the app silently serves its bundled snapshot, the gallery on the web shows templates the app does not have, and nothing errors | `RegistryCatalogSource.fetchAll` threw on the first unreadable template, and `listRaw`'s catch falls back to the **whole** bundled catalog. The realistic trigger is a **version gap**, not corruption: `action` is a Zod discriminated union, so a member added later (`script`/`check`, 2026-08-15) is an unknown discriminator to every older install. **Fixed 2026-08-15**: skip and log the one template, keep the rest. A **checksum mismatch still throws** — that is integrity on executable content, not a version gap | [→](#58-one-unreadable-template-silently-empties-the-whole-hosted-catalog) |
| 56 | `prisma migrate dev` says a migration **"was modified after it was applied"** and offers to **reset the schema** — on a database holding real tasks — while `prisma migrate status` insists everything is *"up to date"* | An applied migration file was **edited after the fact** (here: explanatory comments added). That changes its checksum without changing a line of SQL, and Prisma reads a checksum mismatch as history it cannot trust. `migrate status` does not compare checksums, which is why nothing surfaced it until the next migration. **Do not accept the reset.** Verify the live table against the file's DDL, then update the stored checksum in `_prisma_migrations` | [→](#56-prisma-wants-to-reset-your-database-over-a-migration-you-only-added-a-comment-to) |
| 55 | The dashboard opens **already signed in** on a browser that has never logged in — including through the remote-access proxy, where "already signed in" means *anyone who loads the page* | `VITE_DEV_TOKEN` was compiled into `dist/`. Vite loads `.env.local` in **every** mode and inlines each `VITE_*` reference as a literal, so `npm run build` baked a real owner JWT (`exp` 2036) into the served JavaScript, and `getAuthToken()` sends it whenever nobody is logged in — the login screen was decorative. **The source was clean; the compiler added the secret.** **Fixed 2026-08-15**: the reference is gated on `import.meta.env.DEV` so it folds away in a build, and `scripts/check-bundle-secrets.mjs` fails the build if a credential-shaped literal reappears | [→](#55-the-dashboard-is-already-signed-in-on-a-browser-that-never-logged-in) |
| 54 | **Every** `docker compose` command fails with *"required variable CLOUDFLARE_TUNNEL_TOKEN is missing a value"* — including `docker compose up -d`, which only wants Postgres and Redis | Compose interpolates the **whole file before it selects a profile**, so a `${VAR:?message}` in a service you never start still fails commands that do not involve it. A tunnel credential became a precondition for starting the database. **Fixed 2026-08-15** by using `:-` (empty default); the unset token now surfaces in `docker compose logs tunnel` instead | [→](#54-a-compose-profile-you-never-start-breaks-every-compose-command) |
| 53 | Behind the remote-access proxy (Tailscale / Cloudflare) the phone shows an **old version of the dashboard** — a feature you just shipped is simply absent there, with no error. **Every UI change needs `npm run build:remote`; nothing rebuilds `dist` on a source change** — a fix you just made is live on `:7373` and absent on `:8080`, with no error anywhere | The proxy serves `frontend/dist`, a **build artifact**, not the Vite dev server. It is a fourth thing that runs stale alongside the Dockerized backend, `agent/publish/`, and `mcp-server/dist/`. Run `npm run build:remote` in `frontend/`. **The tell: the two origins disagree, and only the proxied one is behind** | [→](#53-the-proxied-dashboard-is-stale-while-the-dev-server-is-current) |
| 49 | `get_task_health` reports *"Across 358 task(s): 25 critical"* directly above a list of **13** — and `counts` disagrees with `matched` in the same response | The **wrapper** filters and the **server** counts. `GET /api/tools/task-health` has no `tier`, `includeSystem` or `limit` at all: it scores every task and summarizes the same set, honestly. `mcp-server` implements all three client-side, then forwards the server's unfiltered `counts` beside a `matched` taken from the filtered set — so one response describes two populations. **Fixed 2026-08-13** — the three filters moved onto the route, beside the counting, and the response now names the population it summarized. **The tell, if it recurs: `counts` does not change when you flip `includeSystem`** | [→](#49-get_task_healths-counts-describe-a-different-population-than-its-list) |
| 48 | Windows sits at **Degraded** for hours — *"connected but not responding"* — while the agent is running fine and answers the moment you press Sync | The verdict was real and had **expired**. A request timeout is one observation at one instant and is never renewed, so with nothing asking the agent anything afterwards, "not responding" kept being asserted from a single failure hours earlier. Health now ages that evidence out to **UNKNOWN** ("Not checked") past 15 minutes. **The tell: every capability row shows recent successes and zero failures, and the newest timestamp anywhere on the platform is hours old** | [→](#48-windows-sits-at-degraded-for-hours-while-the-agent-is-perfectly-healthy) |
| 52 | An open edit modal **closes by itself**, discarding what you typed — on a timer, not on a keystroke, and with no error | A reset effect keyed on the **task object** rather than its **id**. The dashboard passes `tasks.find(...)`, so every refetch (45s poll, `task:updated`, the editor's own invalidation) hands down a new object and re-runs `setShowEditor(false)`. **Object identity is not entity identity** on a live-data screen. **Fixed 2026-08-13** by depending on `task?.id` | [→](#52-an-open-edit-modal-closes-by-itself-discarding-what-you-typed) |
| 47 | A Claude routine's task keeps coming back after **Remove from Cronsole** — and `TaskExclusion` is empty, as if untrack never ran | Untrack ran; its exclusion was then legitimately cleared. `ClaudeConnector.syncTasks` returns the routines the user **declared** in `PlatformConnection.config`, so the exclusion fences the user's own config while the declaration stays — and importing the Claude category clears exclusions by design. **A Claude task is its declaration**: untrack now 400s for `CLAUDE_CODE`, and disconnecting the routine removes its tasks | [→](#47-a-claude-task-keeps-coming-back-after-remove-from-cronsole) |
| 46 | Every local suite passes, CI is red six pushes running — on an eslint rule and one integration assertion | `npm test` is **not** the CI gate. Two steps have no equivalent it runs: `npm run lint` (frontend only; `@typescript-eslint/no-explicit-any` is an **error**) and `npm run test:integration` (separate vitest config + real Postgres). A status-code change is invisible to unit tests and loud in integration tests | [→](#46-every-local-suite-passes-and-ci-is-red--npm-test-is-not-the-ci-gate) |
| 51 | `update_task_schedule` / `create_task` fail with **`502`/`500 Invalid startBoundary '9-17:00'`** on an ordinary cron like `0 9-17 * * 1-5`, and retrying changes nothing | `parseInt('9-17')` is `9`, so a **list or range in the hour or minute field** passed the "specific time" guard and `padStart` left the raw text in `startBoundary`. **The tell: `convert_schedule` rates it `score: 1` with no warnings while `diverges: true` and `effectiveRuns` show one run a day.** Not an agent fault — the agent is the only layer that rejected it. **Fixed 2026-08-13**: these drop to the honest replaced-with-hourly fallback, and a lossy conversion now rides the schedule-edit **success** too | [→](#51-a-schedule-edit-returns-502-for-a-cron-that-is-simply-not-expressible) |
| 51a | **No symptom at all** — a step schedule like `*/10,45 * * * *` or `0 */6,13 * * *` quietly runs on half of what you asked, forever | Same `parseInt` defect as #51, in the **step** branch (`'*/10,45'.startsWith('*/')` is true, `parseInt('10,45')` is `10`). **Worse than #51 precisely because it never errors**: a mis-parsed step yields a *well-formed* trigger Windows accepts, where a mis-parsed time yielded one the agent refused. Found by sweeping for the pattern, not by a report. **Fixed 2026-08-13**; two instances of the class remain on other surfaces (`timezone.ts`, `registry-site`) and are listed in the entry | [→](#51a-the-same-bug-in-the-step-branch--and-this-one-never-errors-at-all) |
| 50 | Cronsole says it can't create a Claude routine, but Claude Code creates them for you — and Claude tasks sync with no schedule while claude.ai clearly shows one | There are **two** routines APIs. The documented one (`/fire`, per-routine token) really is fire-only; the one Claude Code itself uses (`/v1/code/triggers`, account session) lists, creates, reschedules and pauses. Sign into the Claude Code CLI on the backend's machine and sync — no config. **The reasoning error: a documentation search recorded as a fact about the platform.** Still no delete (verified) | [→](#50-two-claude-routines-apis-and-the-documented-one-is-the-smaller-one) |
| 45 | Cronsole can't list, pause, or create Claude Code routines — and a routine you *can* fire returns `400 Bad Request` for no visible reason | **Largely superseded by #50 (2026-08-13)** — the create/list/pause half was wrong about the platform. The `400` half stands: a **400 is usually a paused routine**, the only signal the documented endpoint ever gives about a routine's enabled state | [→](#45-cronsole-cant-list-pause-or-create-claude-code-routines) |
| 44 | An MCP tool 400s on every call (`Unsupported jobType: undefined`) while `npm test` passes 142/142 — including a test named after the very agreement it is not checking | The tool never sent a required discriminator, and had **never worked since it shipped**. The MCP suite **stubs the HTTP client**, so every assertion is about what the wrapper *sends* and none about whether the API *accepts* it — the test did not miss the bug, it **pinned** it. Drive a wrapped route by hand after touching it; one `curl` with the tool's exact payload catches it | [→](#44-an-mcp-tool-400s-on-every-call-and-the-whole-suite-is-green) |
| 42 | The header reads *"Synced 7m ago"* over tasks that plainly are not — every card says `Last updated` yesterday. `/api/tools/platforms` and `/api/tasks/health` return **different** `lastSync` values for the same platform | `getHealth` returned the agent's **last inbound event of any kind** (`lastResponseAt`, hooked via `socket.onAny`) under the name `lastSync` — the 7-minute stamp was a *folder listing*. This is [#40](#40-the-sidebar-says-windows-is-online-and-synced-just-now-while-every-agent-request-times-out) one level down and it **survived #40's fix**: a real timestamp of the wrong event passes every honesty check an invented one fails. Fixed by deleting `ConnectorHealth.lastSync` entirely — the connector reports `lastContactAt`, and `lastSync` has exactly one writer | [→](#42-the-dashboard-says-synced-7m-ago-over-a-task-list-from-yesterday) |
| 43 | A Playwright screenshot baseline fails on **1 pixel** with nothing changed — or the whole page shifted ~22px between two identical runs | Three things, none of them flake: `maxDiffPixels` defaults to **0** and GPU antialiasing is not deterministic; **masking hides colour, not geometry**, so a masked live-data element still rewraps the row beside it; and a `flex-wrap` status line changes its own **height** when a segment appears — which is a real layout shift on a poll, not a test problem | [→](#43-a-visual-regression-baseline-fails-on-one-pixel-or-on-a-layout-that-moved-by-itself) |
| 40 | The sidebar says Windows is **Online** and *"synced just now"*, while `/api/tasks/folders` 502s, `/discover` omits the Windows platform entirely, and the backend log reads `Agent sync timeout` | The agent is **wedged**: connected but not answering. `getHealth` asserted `HEALTHY` from a socket object existing (Socket.IO's heartbeat is answered by the transport, not by the agent's command loop) and stamped `lastSync: new Date()` — a timestamp created by the act of asking, so it could never be stale and never be true. Fixed to report from real evidence; recover a wedged agent with `pwsh scripts/cronsole.ps1 restart`, then confirm `/api/tasks/health`. The **inverse** lie is [#5](#5-windows-offline-after-running-a-transient-test-agent)/[#37](#37-running-the-e2e-suite-knocks-your-real-windows-agent-offline--and-it-stays-that-way) | [→](#40-the-sidebar-says-windows-is-online-and-synced-just-now-while-every-agent-request-times-out) |
| 41 | A browser verification hangs 45s with `Runtime.evaluate timed out` / `Script injection timed out`, but the page is alive afterwards and the action completed | The tab is **hidden**: `requestAnimationFrame` fires **0 times**, so any probe awaiting a frame waits forever, and timers are throttled (`setTimeout(50)` → 620ms; intensive throttling clamps to ~1/min). Not an app problem. Tell: `setTimeout` fires while `rAF` never does. Measure synchronously (`performance.now()` + forced reflow) or with a `MutationObserver` | [→](#41-a-browser-verification-freezes-for-45s--the-tab-is-hidden-and-requestanimationframe-never-fires) |
| 36 | **Every** Playwright E2E spec fails on a dashboard heading that plainly exists, against a stack that is healthy — `4 failed, 5 did not run` | `VITE_DEV_TOKEN` in `frontend/.env.local` is **empty**, signed with a rotated `JWT_SECRET`, or names a `User.id` that doesn't exist — so the browser sits on the login screen. The suite has no login step by design. **The tell is the page snapshot in `test-results/*/error-context.md` showing a Sign in form.** E2E is the one suite not in CI, so this disables the whole full-stack gate while everything else stays green | [→](#36-every-playwright-e2e-test-fails-on-a-heading-that-exists--the-browser-is-sitting-on-the-login-screen) |
| 37 | The E2E suite passes 9/9 and your **real** Windows agent is offline immediately afterwards — and stays offline | [#5](#5-windows-offline-after-running-a-transient-test-agent) reached through the test suite: `mock-agent.spec.ts` takes the single per-user agent socket and clears the mapping on disconnect. The agent process stays UP, so every process-level check lies. `pwsh scripts/cronsole.ps1 restart`, then **check `/api/tasks/health` as the last step of the run** | [→](#37-running-the-e2e-suite-knocks-your-real-windows-agent-offline--and-it-stays-that-way) |
| 1 | Backend crash-loops on startup with an opaque `[Object: null prototype] {}` uncaught exception | `ts-node` can't parse the installed TypeScript version | [→](#1-backend-crash-loops-with-object-null-prototype) |
| 2 | Dashboard shows no tasks / `403 Invalid or expired token`; agent handshake rejected | Docker's default secrets don't match your rotated `backend/.env` | [→](#2-403-invalid-or-expired-token-or-agent-rejected) |
| 3 | Port 3000 shows as `LISTENING` but every request returns `HTTP 000` / `EADDRINUSE` on restart | Docker's port proxy holds the port even though the app process died | [→](#3-port-listening-but-http-000--eaddrinuse) |
| 4 | Edited backend source, but the running Docker stack still 404s the new route / serves old behavior | `tsx watch` inside the container never sees the file change (Windows→Linux bind-mount inotify) | [→](#4-backend-source-edits-not-picked-up-in-docker) |
| 5 | After running a second/transient agent for testing, Windows shows `OFFLINE` and won't recover even though the real agent process is still running | The transient agent displaced the real agent's socket registration; the idle real agent won't re-register until its socket drops | [→](#5-windows-offline-after-running-a-transient-test-agent) |
| 5a | …and you did not start a test agent — you ran **`npm run test:e2e`**. Windows Offline, agent process alive, `\Cronsole-Stack\` tasks `Ready`, no self-heal | Same single-socket eviction as #5, reached through the suite: it drives the **live** stack and `mockAgent.ts` uses the same pairing secret, so it registers as the same user and unregisters on exit. **Tell:** `grep "Agent connected" logs/backend.out.log \| tail -1` names `e2e-agent-<ts>`, not your machine. Fix: `pwsh scripts/cronsole.ps1 restart` (or restart the agent task), then **Sync**. Note the collision with [#61](#61-the-whole-e2e-suite-fails-and-every-other-suite-is-green)'s advice to run E2E after any dashboard change | [→](#5a-and-the-transient-agent-is-the-e2e-suite) |
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
| 26 | `prisma migrate dev` applies the migration then dies on `EPERM: operation not permitted, rename … query_engine-windows.dll.node` | The **running backend holds the query engine DLL open**, so Windows refuses the rename. The migration already ran, leaving the **DB ahead of the generated client** — #22's drift, but loud. Stop the backend, `npx prisma generate`, restart (in the container: `docker compose exec backend npx prisma generate`, per [#18](#18-new-npm-dependency-module_not_found-in-the-container-after-a-restart)). **On `npm run dev` that stop must match `tsx watch` by command line, not port 3000** — the port belongs to the child, and the watcher just respawns it, so retrying never wins ([#26a](#26a-and-on-the-npm-run-dev-stack-the-fix-above-kills-the-wrong-process)) | [→](#26-prisma-generate-fails-with-eperm-operation-not-permitted-rename--query_engine-windowsdllnode) |
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

### 5a. …and the transient agent is the E2E suite

**Symptom.** Same as #5 — Windows reads **Offline**, `GET /api/tools/diagnostics` says *"Agent not
connected — Socket: not connected"*, the agent **process is alive**, the three `\Cronsole-Stack\`
tasks are `Ready`, and waiting past the agent's 5-minute reconnect cap changes nothing. What is
different is that you did not start a test agent: **you ran `npm run test:e2e`.**

**Cause — the same single-socket eviction, reached through the test suite.** The Playwright suite
drives the **live** stack by design (`pwsh scripts/cronsole.ps1 up`, then Playwright against it),
and `frontend/tests/e2e/helpers/mockAgent.ts` connects with the same pairing secret — so it
authenticates as the same user and becomes *the* Windows agent for the duration of the run. On exit
it disconnects, the backend clears the mapping, and there is now no agent registered at all. #5's
mechanism exactly; only the trigger is different, and this one fires on a command you are
*supposed* to run.

**The tell** is in `logs/backend.out.log` — the last agent to connect is a mock:

```sh
grep -n "Agent connected" logs/backend.out.log | tail -1
# Agent connected: fx3fvh2… (agent e2e-agent-1786996144627, user cli_user_placeholder)
#                                      ^^^^^^^^^ not your machine name
```

A healthy line names the machine (`agent DESKTOP-…`).

**Fix.** #5's remedy — drop the agent sockets so the real agent reconnects and re-registers:

```powershell
pwsh scripts/cronsole.ps1 restart
```

Restarting the agent directly works too, and is the lighter option on a host-run stack where the
backend is a `tsx watch` process you may not want to bounce:

```powershell
Stop-ScheduledTask -TaskPath '\Cronsole-Stack' -TaskName 'CronsoleAgent'
Get-Process Cronsole.Agent -ErrorAction SilentlyContinue | Stop-Process -Force
Start-ScheduledTask -TaskPath '\Cronsole-Stack' -TaskName 'CronsoleAgent'
```

Either way, confirm with diagnostics (`Socket: connected`, `Connected since` seconds old) **and run
a Sync** — a socket existing is not the same fact as the agent doing work
([#40](#40-the-sidebar-says-windows-is-online-and-synced-just-now-while-every-agent-request-times-out)).

**Why this deserves its own entry rather than a line in #5.** #5 reads as something you did to
yourself by hand-starting a dogfood agent — avoidable, and rare. This fires on **`npm run test:e2e`**,
which [#61](#61-the-whole-e2e-suite-fails-and-every-other-suite-is-green) ends by telling you to run
after any dashboard change. So the advice and the trap are pointed at the same command: follow the
guidance, get a green run, and minutes later your agent is down on a screen that has nothing to do
with what you were testing. **Treat "restart the agent" as the last step of the E2E run, not as a
follow-up you might not need** — that is why it is also in the testing README's E2E preflight.

The durable fixes are a separate pairing identity for the mock (so it registers as its own user) or
a second backend for E2E. Both are design decisions, not one-line repairs.

*First hit: 2026-08-17, minutes after an E2E run verifying the Import chooser — the mechanism was
already known as #5 since 2026-07-11, and had already been called out in the testing README's E2E
preflight; what was missing was an entry findable from the symptom when the trigger was the suite.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

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
> which really is approximate (its trigger *is* derived from your input). The number cannot
> separate them and never will — both really are lossy, so one score for two outcomes is the
> honest reading of a single dimension. **Since 2026-07-16 the response carries a machine-readable
> `lossy: 'approximated' | 'replaced'`** — branch on that, not on the prose and not on the number.
> `'replaced'` = your expression was discarded; delete and re-create with a shape the converter
> recognizes. `'approximated'` = honored, but it drifts. A caller thresholding on `>= 0.7` still
> accepts a replacement, so **read `lossy` or the trigger, never the score.**

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
> **Since 2026-07-27 the dashboard tells you this itself.** A plain Sync no longer just says
> `Tasks synced.` — when the platform reports tasks outside the folders you track, the toast
> names them: *"Synced. 26 tasks in 2 folders aren't imported — add them from Sync › Add tasks
> from this machine."* Since 2026-08-18 that toast also **carries the button**, so the prompt no
> longer names a control the reader has to go and find.
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
> `DELETE /api/tasks/:id` on a Windows task deletes the **real Task Scheduler entry** via a
> signed `task:delete` — so it is *not* a way to tidy up an over-broad import.
>
> **Untrack it; do not delete rows by hand** *(corrected 2026-08-13)*. This warning used to say
> there is no untrack and hand you a raw `DELETE FROM "Task"` against the database. Since
> 2026-07-28 there is one: `untrack_task` over MCP, `POST /api/tools/tasks/untrack` for a batch,
> or *Remove from Cronsole* in the task modal — each drops Cronsole's row and records a
> `TaskExclusion` on `(platform, externalId)`, leaving Windows untouched. **The exclusion is the
> entire point**: a row deleted without one leaves nothing remembering the decision, so the next
> sync re-imports all 257 `Microsoft` rows and the cleanup has to be done over. The old SQL did
> exactly that, and named a pre-rename container (`taskhub-db-1`) besides.

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

### 26a. …and on the `npm run dev` stack, the fix above kills the wrong process

**Symptom** — you run the `Stop-Process` line above, `generate` still fails `EPERM`, and rerunning
fails identically no matter how many times you try.

**Cause** — the fix above finds whatever is **listening on port 3000**. Under
`scripts/cronsole.ps1` that is the backend itself, so it works. But `npm run dev` is
**`tsx watch`**, which is *two* processes: a watcher and the child it spawns. Port 3000 belongs to
the **child**, so killing it leaves the watcher alive — and the watcher immediately respawns a new
child, which re-opens the DLL. You have not stopped the backend; you have restarted it.

Two things compound it. The watcher also restarts on **every source edit**, so if you are editing
backend files while retrying, the lock is re-acquired continuously. And the child **PID rotates**
on each restart, so the process you looked up seconds ago is not the one holding the file now.

**Fix** — match the watcher by command line, not by port, and kill both:

```powershell
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -like '*tsx*watch*' -or $_.CommandLine -like '*preflight*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

cd backend; npx prisma generate; npm run dev
```

**Then check what actually restarted it.** On a machine with the `\Cronsole-Stack\` launcher tasks
installed, the self-heal task may bring the backend back on its own within a minute — so a
`npm run dev` you start afterwards can die with `EADDRINUSE` while `curl /api/health` cheerfully
returns 200. That is not a failure; it means the stack healed itself and the running backend is no
longer the one your terminal owns. Confirm with `Get-NetTCPConnection -LocalPort 3000` and check
the process start time before concluding your restart worked.

**Cheapest sequencing:** run `prisma generate` **before** starting the backend for the day, and
fold it into the same restart as an `mcp-server` rebuild — the Dockerized backend, the published
agent and `mcp-server/dist/` are the three things that run stale, and `/doctor` checks all three.

*First hit: 2026-08-13, adding the `DeletedTaskArchive` model for the pre-delete archive.*

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

## 36. Every Playwright E2E test fails on a heading that exists — the browser is sitting on the login screen

**Symptom** — you run `npm run test:e2e` against a healthy stack and *every* spec fails the
same way:

```
Error: expect(locator).toBeVisible() failed
Locator: getByRole('heading', { name: 'Unified Task Dashboard' })
Error: element(s) not found
```

`4 failed, 5 did not run`. The stack is fine — `cronsole.ps1 status` says ALL UP, the dashboard
works in your own browser, and the heading is right there in the source.

**Cause** — `frontend/.env.local` has `VITE_DEV_TOKEN=""` (or a token signed with a **rotated**
`JWT_SECRET`, or one whose `id` is not a real `User.id`). The E2E suite has **no login step by
design**: the browser authenticates with that env token, and without it the app correctly falls
through to `AuthScreen`. Every assertion then fails on a dashboard that was never supposed to
render yet.

**The tell** — the failure message never mentions auth, but Playwright saves a page snapshot.
Open `frontend/test-results/<spec>/error-context.md` and look at the YAML:

```yaml
- heading "Cronsole" [level=1]
- paragraph: Sign in to your dashboard
- button "Sign in"
```

A **Sign in** form there means the credential, not the app. (If the page snapshot is *missing*
entirely and the page rendered blank, it's a different problem — see the Vite note below.)

**Fix** — mint a token for a user that actually exists and paste it in:

```bash
cd backend && node --input-type=module -e "
import 'dotenv/config'; import jwt from 'jsonwebtoken';
console.log(jwt.sign({ id: 'cli_user_placeholder', email: '<your login email>' }, process.env.JWT_SECRET, { expiresIn: '3650d' }));"
```

Put it in `frontend/.env.local` as `VITE_DEV_TOKEN="…"`. Vite watches `.env` files and restarts
itself, so no manual restart is needed — confirm with:

```bash
curl -s http://localhost:7373/src/api.ts | head -c 200   # VITE_DEV_TOKEN should be non-empty
```

Verify the `id` against the DB first (`SELECT id FROM "User";`) — a **valid signature for a
nonexistent user** 401s just like a bad token, and looks identical from the browser.

**Why this one is worth its own entry:** E2E is the only suite **not in CI**, so this failure
mode disables the entire full-stack gate while every other suite stays green. It doesn't look
like a missing credential; it looks like the frontend is broken, which is where the time goes.

> [!TIP]
> **A blank page instead of a login form is a different cause.** If `error-context.md` has no
> page snapshot at all, the dev server is serving stale optimized deps — usually right after a
> dependency was added or removed while Vite was running (hit on 2026-07-31 during the
> `react-router-dom` → `react-router` swap). Same family as [#4](#4-backend-source-edits-not-picked-up-in-docker):
> a long-lived process holding state the source no longer matches. `pwsh scripts/cronsole.ps1 restart`.

*First hit: 2026-07-31, running the full test sweep after the rename.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 37. Running the E2E suite knocks your real Windows agent offline — and it stays that way

**Symptom** — the Playwright suite passes 9/9, and immediately afterwards the dashboard shows
**Windows: Offline**:

```
[{"platform":"WINDOWS_TASK_SCHEDULER","state":"OFFLINE","reason":"Agent not connected"}, …]
```

`Cronsole.Agent` is still running (`cronsole.ps1 status` reports the process UP), and polling
for several minutes does not recover it.

**Cause** — this is [#5](#5-windows-offline-after-running-a-transient-test-agent) reached
through the **test suite** rather than a hand-started dogfood agent. `mock-agent.spec.ts`
connects a `MockCronsoleAgent` in `beforeEach` and disconnects it in `afterEach`. The backend
maps **one agent socket per user**, so the mock becomes *the* Windows agent while it's
connected, and on disconnect the backend clears the mapping. The real agent's socket is still
alive from **its** point of view, so it never reconnects — and re-registration only happens on
connect. It is connected-but-unregistered, indefinitely.

**Fix** — drop all agent sockets so the real one reconnects and re-registers:

```bash
pwsh scripts/cronsole.ps1 restart
curl -s http://localhost:3000/api/tasks/health -H "Authorization: Bearer <dev token>"
# expect WINDOWS_TASK_SCHEDULER: HEALTHY
```

**Treat that health check as the last step of the E2E run, not an optional follow-up.** Nothing
warns you: the suite reports success (it *did* succeed — the mock behaved correctly), the agent
process is still running so every process-level check says UP, and the damage only surfaces the
next time something actually needs the agent. If you run E2E and then go debug why a task won't
fire, you will debug the wrong thing.

> [!NOTE]
> The suite is not doing anything wrong — a mock agent is the whole point, and it deliberately
> seeds its task list from the real tasks so a sync can't prune them. The single-socket-per-user
> mapping is an MVP simplification, and this is its cost. **Prefer running E2E when you are not
> also relying on the live agent.**

*First hit: 2026-07-31, running the full test sweep after the rename.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 38. A row of summary numbers doesn't add up — one of them counts a different population

**Symptom.** The Tools › Task health card read `12 critical · 25 attention · 1 unmeasured · 218 healthy`
under the label **"across 352 tasks"**. Those four sum to **256**. Nothing errored, no test failed,
and each individual number was correct about *something*.

**Cause.** Three tiers were counted over the **personal** list (`\Microsoft\` tasks excluded, which
is what the card intends) while `Healthy` was read straight from the server's `data.counts.ok` —
a summary of **every** task on the machine. One row, two populations. The true personal row is
`12 · 25 · 1 · 57` across **95** tasks; 218 was the healthy count for all 352.

```ts
// before — three from the scoped list, one from the server's whole-machine summary
const critical = visible.filter(t => t.tier === 'critical').length;   // personal
{ label: 'Healthy', value: data.counts.ok }                           // everyone
```

**Fix.** Derive every tier, the `across N` label, and the system-hidden count from **one scoped
list**, and stop reading the server's `counts` in that component entirely — they summarize the
whole machine, and keeping them as a shortcut for a single tile is precisely how the two drifted.

**Why no test caught it.** The fixture built `data.tasks` from the *unhealthy* tasks only and faked
the healthy ones by incrementing `counts.ok` — but the route returns **every scored task**. So the
suite modelled a payload the server never sends, and the one tile reading the unscoped field was the
only thing that could tell the difference. **A fixture that disagrees with the server is a suite
that agrees with itself** — the same family as the stubbed Prisma client in
[#22](#22-deleted-a-windows-task-synced-and-cronsole-still-shows-it--while-reporting-missing-n)
and the stubbed serializer in [#9](#9-agent-payload-arrives-with-every-field-empty).

**And the regression test didn't work on the first attempt.** `expect(tile).toHaveTextContent('0')`
passes against `"10"` — `toHaveTextContent` matches substrings — so the unscoped value the test
existed to reject sailed straight through it. Only the mutation check revealed that; anchoring to
`/^0$/` made it fail as it should. **When asserting a number, anchor it.** A digit assertion that
can be satisfied by a longer number is a test that cannot fail in the direction you care about.

> [!TIP]
> **Generalizable: check that a summary row adds up to its own label.** It is the cheapest possible
> audit of a stats display and it catches the entire class — mixed populations, a stale total, a
> tier quietly dropped from the render. Found here by cross-checking one number (the new *Failures*
> view's 37) against the panel that ought to agree with it.

*First hit: 2026-07-31, verifying the saved-views feature live on the 352-task machine.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 39. A mutation test still fails after you restore the file — `dotnet test` ran a stale build

**Symptom.** Standard mutation-check cycle on the agent: patch a source file, run `dotnet test`,
watch the right tests fail, restore the file, re-run to confirm green. The mutation failed 2 tests
as designed. After restoring, the *same 2 tests still failed* — which reads as "the restore didn't
work", or worse, "the mutation found a real bug and my fix is wrong".

**Cause.** The restore was a `mv` of a backup file, so the source came back with the backup's
**older** mtime. MSBuild's incremental build compares timestamps: the `.cs` looked no newer than
the existing `.dll`, so it skipped the compile and `dotnet test` ran the **mutated assembly** —
against correct source. `grep` on the file showed the flag was back, which is exactly what makes
this confusing: the file and the test disagree, and the file is right.

**Fix.** Force a real compile before trusting the re-run:

```bash
dotnet build <Tests.csproj> --no-incremental && dotnet test <Tests.csproj> --no-build
```

Or restore by rewriting the content (`git checkout -- <file>`, or write the text back) rather than
moving a file whose mtime predates the build.

> **The generalizable bit:** a mutation test's *restore* step is a test too, and it is the one you
> are least likely to check, because you already believe the answer. Any restore that preserves an
> old timestamp can be silently skipped by an incremental build — so a mutation cycle should end
> with a **forced** rebuild, not a fast one. Same family as [#18](#18-new-npm-dependency-module_not_found-in-the-container-after-a-restart)
> and the three-things-that-run-stale rule: the artifact that runs is not the source you edited.

*First hit: 2026-08-04, mutation-checking the signed `createFolder` flag on `task:create`.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 40. The sidebar says Windows is **Online** and "synced just now" while every agent request times out

**Symptom.** The dashboard shows `Windows ● Online`, the header reads *"synced just now"*, and
`GET /api/tasks/health` returns `{"platform":"WINDOWS_TASK_SCHEDULER","state":"HEALTHY","lastSync":"<a second ago>"}`.
At the same moment nothing that needs the agent works:

- `GET /api/tasks/folders` → `502 {"error":"Could not list folders"}`
- `GET /api/tasks/discover` → `[{"platform":"TASKHUB_NATIVE","categories":[]}]` — the Windows
  platform is **absent from the response entirely**, so the Import modal says *"No tasks
  discovered — the Windows agent may be offline"* two inches below the sidebar saying it is online.
- `logs/backend.err.log` → `[Discovery] Error for WINDOWS_TASK_SCHEDULER: Error: Agent sync timeout`

The `Cronsole.Agent` process is running, so `cronsole.ps1 status` reports it UP too.

**Cause.** Two separate fabrications in one four-line function:

```ts
// before — WindowsAgentConnector.getHealth
const socket = agentManager.getSocket(userId);
if (!socket) return { state: HealthState.OFFLINE, reason: 'Agent not connected' };
return { state: HealthState.HEALTHY, lastSync: new Date() };   // ← both of them
```

1. **`HEALTHY` was asserted from a socket object existing.** Socket.IO's heartbeat is answered by
   the *transport*, so an agent whose command loop has wedged keeps a perfectly healthy socket while
   answering nothing. Presence of a socket is evidence the agent connected once — it is not evidence
   it is still working.
2. **`lastSync: new Date()` was a timestamp created by the act of asking.** Nothing synced. And
   because `PlatformConnection.lastSync` was written *only* here, the column never held a real sync
   time either — while the dashboard's "synced N ago" chip takes the newest `lastSync` across all
   connections, so the native connector (which does the same thing and never syncs at all) pinned
   the chip to "just now" regardless.

**Fix.** Report from evidence the agent actually produced. `AgentManager` now records
`lastResponseAt` (set centrally by `socket.onAny` — every inbound event) against `lastFailureAt`
(set at each of the connector's ten request timeouts, naming the verb), and whichever is newer wins:

| Evidence | State |
|:---|:---|
| no socket | `OFFLINE` |
| newest evidence is a timeout | `DEGRADED` — *"Agent connected but not responding (task:list timed out)"* |
| otherwise | `HEALTHY` |

`lastSync` is now only ever a real timestamp: the agent's last inbound event, else the stored column
written by `POST /api/tasks/sync` where a sync genuinely happened, else **absent**. A connected agent
that has answered nothing reports no `lastSync` at all — the chip disappears rather than lying.
**Connected is not synced.**

**Recovery, when you hit the wedged state itself:** `pwsh scripts/cronsole.ps1 restart`, then confirm
`/api/tasks/health` reports `HEALTHY` — same remedy as
[#5](#5-windows-offline-after-running-a-transient-test-agent) and
[#37](#37-running-the-e2e-suite-knocks-your-real-windows-agent-offline--and-it-stays-that-way),
which produce the *opposite* lie (a stranded socket reporting OFFLINE while the agent runs).

**Why no test caught it.** Every existing `getHealth` test asserted the socket-present branch
returned `HEALTHY` — they pinned the bug as the specification. There was no case for "socket present,
agent not answering", because the code had no way to represent it.

> [!TIP]
> **Generalizable: a status surface must report evidence, not preconditions.** "A socket exists"
> and "a config is non-empty" are preconditions for health, not health — and neither is falsified by
> the thing actually being broken. The tell is a status field derived from something that cannot
> change when the subject fails. Its sharpest form is a **timestamp generated by the observer**:
> `lastSync: new Date()` inside a health check can never be stale, which is exactly why it can
> never be true. Same family as [#23a](#23a-and-the-same-probe-reported-four-services-down-while-all-four-were-serving)
> (a probe that couldn't run reported the service down) and
> [#38](#38-a-row-of-summary-numbers-doesnt-add-up--one-of-them-counts-a-different-population).

*First hit: 2026-08-11, clicking through the Tools tab and the Import modal for the roadmap's
live-verification item.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 41. A browser verification "freezes" for 45s — the tab is hidden, and `requestAnimationFrame` never fires

**Symptom.** Driving the app through the Chrome tools, a call dies with:

```
CDP sendCommand "Runtime.evaluate" timed out after 45000ms on tab <id>.
The renderer may be frozen or unresponsive.
```

Screenshots then fail with `Script injection timed out`. Reconnecting a few seconds later shows
the page **alive and the action completed** — the theme really did change, the filter really did
apply. It looks exactly like a rendering performance problem on a large list, and on a 269-task
dashboard that is a very easy conclusion to reach.

**Cause.** The tab is **hidden** (the Chrome window is in the background). Two consequences, and
neither is the app:

- **`requestAnimationFrame` never fires at all.** Measured: 0 firings in a hidden tab. Any probe
  that `await`s a frame — `await new Promise(r => requestAnimationFrame(r))`, or a
  settle-after-paint helper — waits forever, and CDP gives up at 45s.
- **Timers are throttled hard.** `setTimeout(50)` took **620ms**; and after a tab has been hidden
  for several minutes Chrome applies *intensive throttling*, clamping timers to roughly once per
  minute. That is enough to push even a `setTimeout(600)` past the 45s limit on its own.

**The tell:** a `setTimeout` callback fires while an `rAF` callback never does. If both hang, the
page really is busy; if only `rAF` hangs, it is this.

**Fix — measure in ways a hidden tab cannot distort:**

- **Synchronously.** Wrap the action and force layout: `const t0 = performance.now(); act();
  void document.body.offsetHeight;` — no timer, no frame, nothing to throttle.
- **With a `MutationObserver`**, whose callbacks are microtasks, to time when React's commit
  actually lands in the DOM.
- Check `document.visibilityState` **first** if a browser measurement looks absurd.

**Why it is worth an entry.** It produced a confidently wrong finding — a reported dashboard
performance bug that did not exist — which then had to be retracted. Measured properly, a theme
toggle is **0.8ms** at 13,228 DOM nodes, and no virtualization was warranted. This repo verifies
in a real browser as a matter of course, so this ambush is waiting for the next person who does.
The general lesson is the same one [#40](#40-the-sidebar-says-windows-is-online-and-synced-just-now-while-every-agent-request-times-out)
teaches about status: **when your instrument shares a failure mode with the thing you are
measuring, it cannot be your witness.**

*First hit: 2026-08-12, verifying the dashboard filter work in the browser.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 42. The dashboard says "Synced 7m ago" over a task list from yesterday

**Symptom.** The header chip reads *"Synced 7m ago"*. The tasks under it are stale — every card
says `Last updated: 3:31:23 PM` and it is now 11:02 the next morning. Nothing looks broken, which
is the problem: there is no error, no warning, and the one number that would tell you the list is
19 hours old is telling you it is 7 minutes old.

The two routes disagree if you ask them directly:

```
GET /api/tools/platforms  → "lastSync":"2026-08-11T22:31:23.695Z"   # 19h ago — the truth
GET /api/tasks/health     → "lastSync":"2026-08-12T17:53:53.228Z"   # 7m ago  — what the UI showed
```

**Cause.** `WindowsAgentConnector.getHealth` returned the agent's **last inbound event of any
kind** under the name `lastSync`:

```ts
// before
const liveness = agentManager.getLiveness(userId);
const lastSync = liveness?.lastResponseAt;   // ← any inbound event: a folder listing, a run ack
...
return { state: HealthState.HEALTHY, lastSync };
```

`lastResponseAt` is hooked via `socket.onAny`, so *anything* the agent says refreshes it. The
7-minute timestamp was a **folder listing** — `GET /api/tasks/folders`, which pulls the Task
Scheduler folder tree and touches no task. `GET /api/tasks/health` then preferred it over the
stored column with `health.lastSync ?? conn.lastSync`, and the UI renders `lastSync` as
*"Synced N ago"*.

**This is [#40](#40-the-sidebar-says-windows-is-online-and-synced-just-now-while-every-agent-request-times-out)
one level down, and it survived the fix for #40.** That fix stopped `getHealth` inventing a
timestamp with `new Date()`. What replaced it was a **real timestamp of the wrong event** — which
is strictly harder to spot, because every honesty check the fix installed passes: the value is
first-hand, it is absent when there is no evidence, and it goes stale when the agent goes quiet.
It is simply not a sync. The comment three lines above the bug already said **"Connected is not
synced."**

**Fix.** Delete the field a mistake is the only way to fill. `ConnectorHealth.lastSync` is gone;
what the connector reports is `lastContactAt`, named for what it holds. `lastSync` now comes from
exactly one place — the `PlatformConnection.lastSync` column that `POST /api/tasks/sync` writes —
and no connector can override it, because there is no longer a field to override it with. Both
values are surfaced, separately: the dashboard's health strip reads
*"Synced 19h ago · agent replied 2m ago"*, which is the fact that was hidden while one was
reported as the other.

**The tell, for next time.** A status field whose value is *plausible* is not the same as one
that is *earned*. Ask what event writes it, and whether that event is the one the label names —
"the agent said something" and "we pulled the task list" are different facts, and only one of them
is what a reader does anything with.

*First hit: 2026-08-12, while building the dashboard health strip — the strip put `lastSync` and
the last command outcome side by side, and the two disagreed on screen.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 43. A visual-regression baseline fails on one pixel, or on a layout that moved by itself

**Symptom.** A newly written Playwright screenshot test passes when it writes its baseline and
fails on the very next run, with nothing changed:

```
1 pixels (ratio 0.01 of all image pixels) are different.
```

Or, worse, the whole page has shifted down ~22px and the diff is a wall of red — again with no
code change between runs.

**Cause.** Three separate things, all of which look like flakiness and none of which is:

1. **`maxDiffPixels` defaults to 0.** GPU text antialiasing is not deterministic, so a single
   pixel differs run to run. Any tolerance at all fixes it — but pick one that cannot hide a real
   regression. The smallest regression this suite exists to catch is a one-pixel spacing change,
   which shifts a whole row of glyphs and differs in the *hundreds* of pixels. 40 sits far above
   the noise and far below a single character.
2. **Masking hides colour, not geometry.** `toHaveScreenshot({ mask })` paints over a region
   *after* layout. An element whose text length varies still changes its own width, and a
   `justify-between` row will rewrap around it — so the masked element is stable and everything
   beside it is not. Masking a live-data region does not make the page around it deterministic.
3. **A wrapping status line changes its own height.** The health strip was `flex-wrap`, so when a
   segment appeared (*"agent replied 2m ago"*) it went from one row to two and pushed the entire
   dashboard down. That is a **real defect, not a test problem**: it is a layout shift on a
   45-second poll, under the reader's cursor, with no interaction to explain it.

**Fix.** Set a small `maxDiffPixels` in `playwright.config.ts` and justify the number. Give any
live-data element a geometry that its content cannot change — the strip is now one line that
scrolls rather than wraps. And **do not pixel-baseline a surface that is mostly live evidence**:
the Platforms matrix and the Import modal are asserted structurally instead, because masking them
would leave a baseline of an empty frame that still breaks whenever a row's height moves.

**The rule.** Screenshot the chrome, assert the content. If deciding what to mask is getting hard,
that is the surface telling you it wants a structural test.

*First hit: 2026-08-12, adding screenshot regression coverage for the dense surfaces.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 44. An MCP tool 400s on every call, and the whole suite is green

**Symptom.** `create_native_task` fails for every input:

```
Unsupported jobType: undefined
```

`cd mcp-server && npm test` passes 142/142. One of those tests is literally named
*"nests the HTTP job the way the route expects"*.

**Cause.** The tool built its payload as `{ url, method }` and never sent the `jobType`
discriminator the route requires. It had been that way **since the tool shipped**, so
`create_native_task` had never once worked.

Nothing caught it, and nothing could have:

```ts
// mcp-server — what the tool sent
const job: Record<string, unknown> = { url, method };
// backend — what the route required
if (j.jobType !== 'HTTP') return `Unsupported jobType: ${j.jobType}`;
```

The MCP suite **stubs the HTTP client**. That is a deliberate, correct choice — it makes the tests
fast and hermetic — but it means every assertion is about *what the wrapper sends*, and none is
about *whether the API accepts it*. A test can therefore assert the exact bytes of a payload the
server rejects, name itself after the agreement it is not checking, and pass forever. The test did
not merely miss the bug; **it pinned it**.

**Fix.** Send the discriminator, and correct the tests that had frozen the broken shape. But the
durable fix is the habit already written in [`docs/testing/README.md`](../testing/README.md) under
*Known coverage gaps*: **after changing a route an MCP tool wraps, drive the tool against a real
backend once.** One `curl` with the tool's exact payload would have caught this on day one:

```bash
curl -s -o /dev/null -w '%{http_code}
' -X POST   -H "Authorization: Bearer $CRONSOLE_TOKEN" -H 'Content-Type: application/json'   -d '{"name":"probe","schedule":"0 4 * * *","job":{"jobType":"HTTP","url":"http://localhost:3000/api/health"}}'   http://localhost:3000/api/tasks/native
```

**Why it is worth an entry.** This is the failure mode the docs *predicted by name* —
"the suite stubs the client, so it pins what the wrapper does, not that the wrapper and the API
agree" — sitting undetected in the surface it was written about. Knowing a gap exists is not the
same as covering it, and a green suite over a stub is the most comfortable possible way to not
notice. It is [#9](#9-agent-payload-arrives-with-every-field-empty) one layer up: **both sides
green while disagreeing about the wire.**

*First hit: 2026-08-12, while adding the `EXEC` job type to Cronsole-native.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 45. Cronsole can't list, pause, or create Claude Code routines

> [!IMPORTANT]
> **Largely superseded on 2026-08-13 — see [#50](#50-two-claude-routines-apis-and-the-documented-one-is-the-smaller-one).**
> The cause below is correct about Anthropic's **documented** API and wrong about the platform.
> Cronsole can now list, create, reschedule and pause routines whenever the backend can read your
> Claude Code session. **The `400` half of this entry is still exactly right** — a paused routine is
> still the likeliest cause when firing through the documented endpoint. The rest is kept because
> the reasoning error is worth being able to find again.

**Symptom.** Several complaints that look like separate bugs and are all the same fact:

- The Claude source lists only the routines you typed into the connection config — a routine you
  created at claude.ai never appears, and one you deleted there never goes away.
- **Enable / disable** and **Create** are greyed out on the Platforms matrix for Claude.
- A routine that worked yesterday returns `400` today, with no other change:

```
Refused (400): invalid request. Most often the routine is paused — resume it at claude.ai/code/routines.
```

**Cause.** None of these is a Cronsole limitation to be lifted later. Claude Code exposes
**exactly one routines endpoint**:

```
POST https://api.anthropic.com/v1/claude_code/routines/{trig_id}/fire
```

and the API reference states its token's scope outright: *"One routine only; **no read access**."*
There is no list, no get, no create, no enable/disable, and no token management — routines are
owned by claude.ai and reachable from outside through a single doorbell each.

So the connector writes and cannot read, which is the mirror image of every other platform here:

| | What it means |
|---|---|
| `sync` | Returns the routines **you declared** in the connection config. Nothing is fetched. |
| `run` | Real. The only verb with a platform behind it. |
| `create`, `setStatus` | `unsupported` in the matrix — not "unproven". No endpoint exists. |
| health | From whether a run actually succeeded. **Never a probe** — see below. |

**The tell for the 400.** Routines can be paused in the claude.ai UI, and a paused routine's `/fire`
returns `400`. Since Cronsole cannot *read* the paused state, that 400 is the **only** signal it ever
gets that a routine is disabled — which is why the message names it rather than saying "Bad Request"
and sending you to check the token. The other 400 causes are a missing `anthropic-beta` header
(a Cronsole bug, not yours) and `text` over 65,536 characters (Cronsole sends no body at all).

**Fix.** Nothing to fix in Cronsole. Do the thing the message points at:

- **Paused?** Resume it at [claude.ai/code/routines](https://claude.ai/code/routines).
- **`401`** — each token is scoped to one routine and **regenerating revokes the previous one**.
  Re-copy it from *Edit routine → Add another trigger → API*; it is shown once.
- **`404`** — the routine was deleted, or the id is not the `trig_`-prefixed value. The path
  parameter is called `routine_id` but the value is `trig_…`; the docs flag their own mismatch.
- **New routine?** Create it at claude.ai (or `/schedule` in the Claude Code CLI), then paste its
  id and API token into the Claude connection.

**Why it is worth an entry.** Because every one of these reads like an unfinished feature, and
someone will go looking for the setting. Writing the boundary down is what stops it being
rediscovered. It also carries one design consequence worth keeping: **the connector must not
health-check by probing.** The only endpoint has a side effect, so *"check whether this works"* and
*"run the user's routine"* are the same request — a probing health check would fire someone's
nightly job on every poll and burn their daily run cap. Where no read-only probe exists, the record
of real runs is the only honest health signal there is. Returning `HEALTHY` because config was
non-empty, which is what this connector did before, is [#40](#40-the-sidebar-says-windows-is-online-and-synced-just-now-while-every-agent-request-times-out)
one connector over: a verdict derived from something that cannot change when the platform fails.

*First hit: 2026-08-12, verifying the routines API before promoting the connector.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 46. Every local suite passes and CI is red — `npm test` is not the CI gate

**Symptom.** Six pushes in a row go red on GitHub while `npm test` passes in all four packages.
The failures are trivial and would have taken seconds to fix before pushing:

```
frontend/src/components/ClaudeRoutinesPanel.tsx
  80:17  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
✖ 6 problems (6 errors, 0 warnings)
```

```
FAIL test/integration/data-flow.integration.test.ts > sends a failure notification …
AssertionError: expected 502 to be 500
```

**Cause.** Two CI steps have no local equivalent that `npm test` runs, so nothing catches them
until the push:

| CI step | Local command | Notes |
|:--|:--|:--|
| **Lint frontend** | `cd frontend && npm run lint` | Only the frontend is linted, and `@typescript-eslint/no-explicit-any` is an **error**. `catch (e: any)` and `(api.post as any)` are the two shapes that keep reappearing. |
| **Backend integration tests (real Postgres)** | `cd backend && npm run test:integration` | A **separate config** (`vitest.integration.config.ts`); `npm test` does not include it. Needs Postgres up and four env vars set. |
| Typecheck (frontend) | `cd frontend && npm run build` | `tsc -b` runs as part of the build, not the test. |
| Typecheck (MCP tests) | `cd mcp-server && npm run typecheck` | vitest transpiles without typechecking and `tsconfig.json` excludes `src/__tests__`, so this is the **only** thing that typechecks the MCP suite. |

The second row is the one that bites hardest, and for a reason worth naming: **a status-code
change is invisible to unit tests and loud in integration tests.** Changing the run route's
platform-failure code from `500` to `502` broke exactly one assertion, in the suite `npm test`
does not run.

**Fix.** Before pushing anything non-trivial, run the checks CI runs — not the ones that are
convenient:

```bash
cd frontend   && npm run lint && npm test && npm run build
cd ../backend && npm test
cd ../backend && TEST_DATABASE_URL='postgresql://taskhub:password@localhost:5432/taskhub_test' \
  JWT_SECRET=ci ENCRYPTION_KEY='12345678901234567890123456789012' \
  AGENT_PAIRING_SECRET=ci npm run test:integration
cd ../mcp-server && npm test && npm run typecheck && npm run build
node scripts/check-control-bytes.mjs && node scripts/check-ps1-ascii.mjs
```

Postgres for the integration run is the compose service that is probably already up
(`docker ps` → `taskhub-db-1`); `globalSetup` creates and migrates `taskhub_test` on it.

For the `any` errors specifically, use `frontend/src/utils/errorMessage.ts` in a `catch` and
`vi.mocked(fn)` in a test — those two cover nearly every instance.

**Why it is worth an entry.** Not because the fixes were hard — they were one-liners. Because
**a green local run reads as "done"**, and the gap between the two sets of commands is silent
in exactly the direction that lets six commits ship broken. It is the record-keeping failure
of §11a pointed at CI: nothing fails loudly at the moment the mistake is made.

*First hit: 2026-08-12, during the Claude routines work.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 48. Windows sits at "Degraded" for hours while the agent is perfectly healthy

**Symptom.** The dashboard's health strip reads **Windows Task Scheduler degraded — Agent
connected but not responding (task:folders timed out)**. It has said so for hours. The agent
process is running and has been for a day; nothing has crashed; the task list is intact. Press
**Sync** and it answers instantly — 354 tasks, 0 missing — and the strip goes green.

**The tell, before you touch anything:** open `GET /api/tools/platforms` (or `list_platforms`)
and read the timestamps rather than the verdict.

```
healthState:  "DEGRADED"
healthReason: "Agent connected but not responding (task:folders timed out)"
lastSync:     "2026-08-13T04:04:54Z"     ← 10.5 hours ago
capabilities: sync        verified, lastSuccessAt 04:04:54Z, lastFailureAt null
              listFolders verified, lastSuccessAt 04:05:28Z, lastFailureAt null
              ...          every row: recent success, zero failures
```

Two things do not fit. Every capability row records a **success** and **no failures at all**,
and the newest timestamp anywhere on the platform is hours old. A platform that is actively
failing produces fresh failures; this one produced nothing, because nothing asked it anything.

**Cause.** The verdict was true when it was written and had since expired.

Platform health is the newest of `lastResponseAt` (any inbound agent event) against
`lastFailureAt` (a request timeout) — the fix for [#40](#40-the-sidebar-says-windows-is-online-and-synced-just-now-while-every-agent-request-times-out),
where a wedged agent read as healthy because a live socket was mistaken for a working one. That
rule is right, and it had no notion of an observation getting old. One `task:folders` request
timed out at 21:05. Nobody used Cronsole overnight. `lastFailureAt` stayed the newest evidence
until morning, so the strip kept reporting a ten-hour-old failure in the present tense.

**The general shape is worth more than this instance.** #40 was a verdict derived from a
*precondition* — something that cannot change when the platform fails. This is a verdict derived
from an *expired observation* — something that was true and stopped being checked. Both pass
every honesty test the codebase had, because both are first-hand and neither is invented. What
neither could do is say **how old its evidence was**, and a status field that cannot say that
will eventually assert the past as the present.

Note the asymmetry that makes the fix coherent: **evidence of a connection renews itself and
evidence of a failure does not.** The transport heartbeat re-proves every few seconds that the
agent process is up and reachable, so `OFFLINE` and `HEALTHY` are continuously re-earned. A
timeout happens once. Nothing after it says the agent is *still* wedged, because nothing after
it asked.

**Fix.** Already fixed (2026-08-13). `HealthState` gained **`UNKNOWN`**, rendered as **"Not
checked"**, and `WindowsAgentConnector.getHealth` ages the failure out: inside
`UNRESPONSIVE_EVIDENCE_TTL_MS` (15 minutes) a timeout still means `DEGRADED`, past it the state
becomes `UNKNOWN` with the reason *"task:folders timed out, and nothing has been asked of the
agent since"*. A wedged agent someone is actually trying to use stays `DEGRADED`, because every
attempt renews the evidence.

**If you are on an older build, or want the answer now:** press **Sync**, or call
`sync_tasks` / `POST /api/tasks/sync`. It is a read-only round trip and it replaces the stale
verdict with a current one. That is deliberately a user action rather than an automatic probe —
`getHealth` runs on a 45-second dashboard poll, and probing there would put a synthetic request
on the agent for every open browser tab.

**Do not reach for the [#40](#40-the-sidebar-says-windows-is-online-and-synced-just-now-while-every-agent-request-times-out)
remedy first.** `cronsole.ps1 restart` will also clear it — `registerAgent` starts a fresh
liveness record — which makes restarting look like the cure and hides that nothing was wrong.
Check whether the agent answers *before* restarting it: if Sync returns tasks, the agent was
never the problem.

*First hit: 2026-08-13.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 47. A Claude task keeps coming back after "Remove from Cronsole"

**Symptom.** You click **Remove from Cronsole** on a Claude routine's task. The toast says it
worked, the row disappears — and minutes later it is back on the dashboard, same name, new
`createdAt`. Doing it again changes nothing. `TaskExclusion` is **empty**, which makes it look
like untrack never ran at all.

**Cause.** Untrack ran, and its exclusion was then legitimately deleted. Two mechanisms describe
one fact and point opposite ways.

Untrack is built for Windows, where the shape is: *the task exists on the machine, sync
enumerates the machine, so Cronsole needs a memory of "don't re-import this"* — a
`TaskExclusion` keyed on `(platform, externalId)`.

Claude is not that shape. Anthropic exposes no API to list routines, so
`ClaudeConnector.syncTasks` returns **the routines the user declared**, read back out of
`PlatformConnection.config`. The registry *is* the platform. So untracking writes an exclusion
against the user's own configuration, and the declaration it is hiding stays exactly where it
was — still listed under Platforms → Claude, still holding its token, still returned by every
sync. The fence then comes down on its own: importing a category clears the exclusions inside
it (`clearExclusionsForCategories`), which is correct and documented — it is the way back for a
Windows task removed by mistake — and here it un-hides a routine that was never gone.

That is why the exclusion table reads empty. It is not evidence untrack failed; it is the
wreckage of it having worked and then been undone.

The mirror-image half was just as broken: removing the routine under **Platforms → Claude**
left the task row behind (the route counted them as `orphanedTasks` and moved on), so the task
sat on the dashboard un-runnable and flipped to `MISSING` on the next sync.

**Fix.** One fact, one mechanism — **a Claude task is its declaration**:

- `POST /api/tasks/:id/untrack` now **400s** for `CLAUDE_CODE`, the same refusal
  `TASKHUB_NATIVE` already got, and names the control that works. Bulk untrack refuses it as one
  `refused` item without halting the batch.
- `DELETE /api/tools/platforms/claude/routines/:id` removes the tracked tasks and their run
  history with the declaration, and reports `tasksRemoved`.
- The task modal shows **Disconnect routine** instead of *Remove from Cronsole* for a Claude
  task, and its confirmation names the one irreversible part: claude.ai shows a token once, so
  reconnecting means generating a new one.

So: **to remove a Claude task, disconnect its routine.**

**Why it is worth an entry.** The refusal is the interesting half, because the tempting fix is
to make untrack *also* drop the routine — one button, does what the user meant. That button
would silently spend an API token that cannot be recovered, under a label that says nothing
about credentials. The general rule: **a control may not spend something its label does not
mention.** The narrower one: when a platform's "state" is the user's own declaration, a fence
against it is not a fence, it is two copies of one fact waiting to disagree.

*First hit: 2026-08-12, reported as "I keep deleting it but it keeps coming back".*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 49. `get_task_health`'s counts describe a different population than its list

**Symptom** — you ask for the failing tasks, exclude the ones Windows owns, and the summary
line does not match the list underneath it:

```text
get_task_health { tier: 'critical' }          # includeSystem defaults to false
→ "Across 358 task(s): 25 critical, 107 need attention, 1 unknown, 225 ok."
→ counts: { tasks: 358, critical: 25, … }
→ matched: 13          # <- the list has thirteen rows
```

The tell is cheap and decisive: **flip `includeSystem` and `counts` does not move.**

```text
includeSystem: false → counts.critical 25, matched 13
includeSystem: true  → counts.critical 25, matched 25
```

**Cause** — the filtering and the counting live in **different processes**. The backend route
[`GET /api/tools/task-health`](../../backend/src/routes/tools.ts) accepts **no** `tier`, no
`includeSystem` and no `limit`: it scores every task the user tracks and calls
`summarizeHealth(results)` over that same array, so the API is entirely self-consistent. All
three parameters are implemented in the **wrapper**, `mcp-server/src/tools.ts`:

```ts
let tasks = result.tasks ?? [];
if (!includeSystem) tasks = tasks.filter(t => !t.isSystem);   // wrapper-side filter
if (tier) tasks = tasks.filter(t => t.tier === tier);
const matched = tasks.length;                                  // filtered population
const c = result.counts;                                       // UNFILTERED population
const header = `Scanned at … Across ${c.tasks} task(s): ${c.critical} critical, …`;
```

So `counts` and the header describe all 358 tracked tasks — including the ~257 `\Microsoft\`
ones the caller explicitly excluded — while `matched` and `tasks` describe the 13 that
survived the filter. Both numbers are correct about their own population, and the response
never says which is which.

**Why this one matters more than a wrong number.** The header is the half a model reads and
repeats, so the failure mode is an agent telling you *"you have 25 critical tasks"* and then
listing 13, or worse, reporting 25 as your personal total when 12 of them are Windows'. That
is the mixed-population defect this project already fixed once — the Task health card counted
three tiers over personal tasks and `Healthy` over all 352, printing a row that summed to 256
under the label "across 352 tasks" (fixed 2026-07-31). **The card was fixed; the API's callers
were not**, because the card stopped mixing populations by filtering in the same place it
counted, and nothing carried that to a second consumer.

**The deeper cause is the wrapper owning logic.** `CLAUDE.md` §11a says `mcp-server/` owns no
logic, and `tier` / `includeSystem` / `limit` are logic: they decide which tasks the answer is
about. Once that decision lives in the wrapper and the summary lives on the server, the two
cannot agree by construction — no amount of care in either file fixes it, because neither
knows what the other did. This is the same shape as re-deriving `isSystem` in the browser
([#20a](#20a-and-a-renamed-category-silently-stops-syncing-its-folder)): **a verdict computed
in two places is a verdict that will eventually disagree with itself.**

**Fix (2026-08-13)** — **the filter moved to the route, next to the counting.**
`GET /api/tools/task-health` now accepts `tier`, `includeSystem` and `limit`
(`taskHealthQuerySchema` in `routes/tools.ts`), and `mcp-server` forwards them and filters
nothing. The rejected alternative — recomputing `counts` inside the wrapper — is a line
shorter and leaves the logic in the place §11a says owns none, so the next consumer of this
route would have rediscovered the same bug.

Three details are load-bearing:

- **`counts` is taken after the system lens and *before* the `tier` filter.** This is the
  dashboard's `applyTaskFiltersExcept` rule one layer out: a count beside a control describes
  the population that control governs. Counted after `tier` it would report the tier you asked
  for and four zeros, which answers nothing; counted before `includeSystem` it is this bug.
- **Every route default is "everything"** — `includeSystem` defaults `true`, `limit` unbounded
  — because `useTaskHealthTiers` passes no parameters and needs a verdict for *every* task. An
  unparameterized request is byte-identical to before the filters existed. The MCP tool keeps
  its own `false` default and sends it explicitly, so neither side inherits the other's.
- **The response says what it summarized**: `scope: { includeSystem, tier, systemExcluded }`.
  A caller can now tell *"25 across everything"* from *"13 among yours"*, and the 257 hidden
  system tasks are counted out loud instead of silently fenced off. A malformed
  `?includeSystem=fasle` is a **400**, not a guess — a misread lens quietly changes which
  tasks the answer is about.

Verified live against 358 real tasks: `?includeSystem=false&tier=critical` returns
`counts.critical: 13` beside `matched: 13`, where the same query used to print `25`. Guarded
by five integration tests; the one pinning this defect was mutation-tested by putting
`summarizeHealth(results)` back and watching it fail.

> [!NOTE]
> **If the numbers still disagree, check what is actually running.** The wrapper executes
> `mcp-server/dist/`, so this fix is invisible until `npm run build` **and** an MCP host
> restart — the host launched the server process at session start and will not pick up a new
> `dist/` without one. Two of the three things that run stale, in one bug.

*First hit: 2026-08-13, during a live MCP exercise of `get_task_health` on a 358-task machine —
found by noticing `counts.critical: 25` above a 13-row list, and confirmed by flipping
`includeSystem` and watching `counts` stay put.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 50. Two Claude routines APIs, and the documented one is the smaller one

**Symptom.** Any of these, and they look unrelated:

- Cronsole says it cannot create a Claude routine — but you have watched Claude Code create one for
  you with `/schedule`, and `claude.ai/code/routines` lists routines whose `created_via` is
  `http_api`.
- Claude tasks sync with **no schedule at all**, while claude.ai clearly shows a cron for each.
- The Platforms matrix reports **Create** and **Enable / disable** as `unsupported` for Claude,
  which reads as permanent.
- You are asked to paste a per-routine API token — a value claude.ai shows **exactly once** — to do
  something Cronsole could already have done.

**Cause.** There are **two** Claude Code routine APIs, and Cronsole was built against the smaller one.

| | **Documented** | **What Claude Code itself uses** |
|---|---|---|
| Endpoint | `POST /v1/claude_code/routines/{trig_id}/fire` | `/v1/code/triggers`, `/v1/code/sessions` |
| Verbs | fire, and nothing else | list · get · **create** · update · run · run history |
| Credential | `sk-ant-oat01-…` minted per routine in the web UI | the account session Claude Code logged in with |
| Documented | yes — *"one routine only; no read access"* | **no**, and beta-gated (`anthropic-beta: ccr-triggers-2026-01-30`) |

The documented scope note is accurate, and it describes **that token**, not the platform. `/schedule`
and `/code-review --post` have always created routines through the second family.

**The reasoning error worth naming.** [#45](#45-cronsole-cant-list-pause-or-create-claude-code-routines)
recorded, in good faith, *"Anthropic exposes exactly one routines endpoint"* — the result of a
thorough documentation search, written down as a fact about the platform. **A doc search is evidence
about documentation.** It became an architectural boundary (`unsupportedVerbs`, "write-only
connector", "syncTasks is not a sync") and stayed one for a day, while the product shipped the
capability the whole time. This is [#40](#40-the-sidebar-says-windows-is-online-and-synced-just-now-while-every-agent-request-times-out)
one level out: a verdict derived from a precondition rather than from what happened.

**Fix.** Nothing to configure on a host-run stack — sign into the Claude Code CLI (`claude`, then
`/login`) on the machine running the backend and sync. Cronsole reads the session from
`~/.claude/.credentials.json` at request time.

Check which mode you are in:

```bash
curl -s -H "Authorization: Bearer $CRONSOLE_TOKEN" \
  http://localhost:3000/api/tools/platforms/claude/routines | jq .session
# { "mode": "oauth", "active": true, "source": "file", "expiresAt": "..." }
```

`mode: "declared"` means no readable session; the `reason` field says which of the four causes it is
(container · no file · token absent · expired).

**Gotchas, each of which cost time:**

- **Docker.** The credentials file is on your machine, not in the container. Cronsole refuses by
  name rather than reporting a path inside the container that you would go looking for in Explorer.
  Set `CLAUDE_OAUTH_TOKEN` if you want the mode there.
- **Cronsole never refreshes the credential**, though the refresh token is in the same file. A
  refresh rotates the pair, and the loser of that race holds a revoked token — Cronsole would sign
  you out of the Claude Code CLI from a background poll, with the symptom appearing hours later
  somewhere else. Expiry is reported, never repaired.
- **There is still no delete.** Verified by enumerating the surface, not by reading docs: neither
  family exposes a `DELETE`. Cronsole can disable a routine; removing it happens at claude.ai. A
  routine created by mistake has to be cleaned up by hand.
- **Tests that assert Claude's capabilities must mock the credential.** `unsupportedVerbs` is a
  getter now, so an unmocked suite passes or fails depending on whether whoever ran it was signed
  into Claude Code.
- **`next_run_at` is the platform's, not ours.** Anthropic applies a few minutes of scheduling
  jitter (`30 4 * * 1` → `04:32Z`). Recomputing it locally would disagree with claude.ai forever
  with nothing on screen to say which was right — the [#42](#42-the-dashboard-says-synced-7m-ago-over-a-task-list-from-yesterday) shape.

*First hit: 2026-08-13. Found by being asked "Claude Code has created routines for me before — why
can't Cronsole?", which is a better API audit than the one that produced #45.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 51. A schedule edit returns 502 for a cron that is simply not expressible

**Symptom.** Rescheduling a Windows task to an ordinary business cron fails as a server error,
and retrying does exactly the same thing:

```text
update_task_schedule { schedule: "0 9-17 * * 1-5" }
→ HTTP 502: Invalid startBoundary '9-17:00' (expected HH:mm)

create_task        { schedule: "0 9,17 * * *" }
→ HTTP 500: Invalid startBoundary '9,17:00' (expected HH:mm)
```

The **tell**, and it is the alarming part — ask the converter first and it reports the schedule as
perfect:

```text
convert_schedule { schedule: "0 9-17 * * 1-5" }
→ score: 1, warnings: [], lossy: undefined
→ trigger: { type: 'Weekly', startBoundary: '9-17:00', … }
→ diverges: true, effectiveRuns: [ 09:00 daily ]     # <- 1 run/day, 9 were asked for
```

**Cause.** `convertCronToWindowsTrigger` guarded the minute and hour fields with
`!isNaN(parseInt(field))`. **`parseInt('9-17')` is `9` and `parseInt('9,17')` is `9`** — neither is
`NaN` — so a list or a range passed as "a specific time", and `hour.padStart(2, '0')` then left the
raw text alone because it was already ≥ 2 characters. The result was a `startBoundary` that is not
a time, at **confidence 1.0 with no warnings**.

This is the **Monday-only `1-5` bug** (fixed 2026-07-14, and referenced throughout this file) —
where `parseInt('1-5')` made "every weekday" mean "Mondays only" — **one field over, and missed
when that one was fixed.** A Windows trigger starts at exactly one time, so unlike the weekday case
there is no correct multi-value answer available: several start times means several tasks.

**The wrong turn worth recording:** the `502` invites you to debug the agent. It is not the agent —
the agent is the only component that behaved correctly, rejecting a malformed start time rather
than registering something wrong. Nothing bad ever reached Task Scheduler, which is precisely why
this survived: the failure was loud, late, and pointed at the wrong layer.

**Fix (2026-08-13)** — `parseSingleTimeField()` accepts one in-range numeric value or returns
`null`, and the boundary is formatted from the *parsed numbers* rather than the raw strings. These
crons now fall through to the documented replaced-with-hourly fallback (`lossy: 'replaced'`, 0.7),
plus a specific warning naming the workaround. Out-of-range values (`0 25 * * *`, which built
`"25:00"` and failed identically) are covered by the same guard.

Two details that are easy to get wrong, both found by testing rather than reasoning:

- **Formatting from the parsed number is not, by itself, the fix — it is a worse bug.** Mutation-
  testing the guard showed `timeOf(hourNum, minNum)` alone turns `0 9-17 * * 1-5` into a
  well-formed `"09:00"`: no error at all, and the task silently runs once a day instead of nine
  times. The `/^\d+$/` rejection is what makes it honest; the formatting only stops the malformed
  string. **A 502 is better than a silent wrong schedule**, so a "fix" that removed the error
  without rejecting the input would have made this worse while looking correct.
- **The success path had to learn to carry warnings.** `PATCH /api/tasks/:id/schedule` returned the
  bare task on success, so with the converter fixed the same request became a **silent `200`** over
  a task quietly rescheduled to ~24 runs/day. It now returns the `conversion` block create has
  always returned, and `update_task_schedule` surfaces it. Refusing with a `400` instead was
  rejected: `0 4 1 1 *` has always been accepted-and-replaced, and one unexpressible cron may not
  answer differently from another.

Verified live: `convert_schedule` drops to `0.7` with both warnings, the route returns
`conversion.lossy: "replaced"` on success, and `Get-ScheduledTask` shows a clean `PT1H` repetition
on the machine. Pinned by four tests asserting the boundary's **shape** (`/^\d{2}:\d{2}$/`) rather
than only its confidence — a test that checked confidence alone would have passed on `"9-17:00"`.

### 51a. The same bug in the step branch — and this one never errors at all

**Grep for the pattern, don't fix the one instance** ([#21](#21-templates-never-update-catalog-sync-failed--p2002-on-every-boot)).
Sweeping the repo for sibling cron parsing found two more live instances **in the same function**:

```text
*/10,45 * * * *   # every 10 min AND at :45  -> read as a clean PT10M step, ",45" gone
0 */6,13 * * *    # every 6h AND at 13:00    -> read as PT6H, the 13:00 run gone
```

`'*/10,45'.startsWith('*/')` is true and `parseInt('10,45')` is `10`, so a step *combined with* a
list or range was read as a clean step — again at **confidence 1.0 with no warnings**.

**This half is worse, and the reason is worth internalizing.** A multi-value *time* produced a
malformed `startBoundary` that the agent refused, which is why you get a `502` and go looking. A
mis-parsed *step* produces a **well-formed** `PT10M` repetition that Windows accepts happily — no
error, no warning, no symptom. The task just runs on a schedule nobody chose, forever. **The loud
bug was the one that got found; the silent one had been sitting beside it the whole time.**

Fixed by `parseStepField()`, which matches `^\*\/(\d+)$` and nothing else. Plain steps (`*/15`,
`0 */4`) are unaffected. The reverse direction was hardened at the same time: `convertWindowsTriggerToCron`
read a malformed `"9-17:00"` off a real machine as `0 9 * * *` at confidence 1.0 — inventing a
schedule the task does not have and then displaying it as fact.

**Two instances of this class were logged on other surfaces; one is now fixed:**

- `frontend/src/utils/timezone.ts` — `shiftCron` correctly *refuses* to shift a multi-value hour
  (its `isNum` guard is right), but returns `shifted: false` with **no `reason`**. So a Pacific user
  typing `0 9-17 * * 1-5` gets it stored verbatim as UTC — 7–8 hours from what they meant, with
  nothing on screen. The `reason` field exists precisely for "has a clock time we would have moved
  but could not".
- ~~`registry-site/index.html`~~ — **fixed 2026-08-13.** The gallery's standalone `describeCron`
  rendered `0 9 1,15 3 *` as *"March 1st"*, dropping the 15th (`parseInt('1,15')`, day-of-month
  position). The month branch now returns **null** when the day is multi-valued, so the page shows
  the raw cron and no prose rather than a confident wrong date — the same choice the converter
  makes when it cannot express a schedule. Shipped with the 2026-08-13 catalog publish.

> [!NOTE]
> The MCP half is invisible until `cd mcp-server && npm run build` **and** an MCP host restart.
> The backend picks it up on its own if it is running in watch mode.

*First hit: 2026-08-13, during a hand-driven MCP regression pass. Found by probing for a cron that
would prove a `400`-vs-`502` distinction — `*/7 * * * *` was the expected input and turned out to
convert fine (`approximated`), so the search widened to multi-value fields and hit this instead.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 52. An open edit modal closes by itself, discarding what you typed

**Symptom.** You open a task's editor, start typing a cron expression or a command, and the modal
vanishes — back to the task details view, with the edit gone. Nothing was saved and no error
appeared. It is not reproducible on demand: sometimes it survives a minute, sometimes it dies
mid-word. Nobody clicked anything.

**The tell:** it happens on a **timer, not on a keystroke**. Leave the editor open, touch nothing,
and it still closes. Trigger a sync from another tab and it closes immediately.

**Cause.** A reset effect keyed on an object identity that changes on every refetch.

`TaskModal` receives its task as `tasks.find(t => t.id === routeTaskId)` — a **new object every
time the tasks query resolves**, even when nothing about the task changed. It held:

```tsx
useEffect(() => {
  if (task) { setActiveTab('overview'); setShowEditor(false); }
}, [task]);          // ← fires on every refetch, not on every task
```

The effect's intent is *"a different task was opened, reset the view"*. The dependency it was
given answers a different question — *"did I receive a different object?"* — and the two stop
agreeing the moment the data is live. The 45-second poll, any `task:updated` socket event, and the
editor's own `invalidateQueries` after a successful save all re-ran it and slammed the editor shut.

**Fix.** Depend on the identity the question is actually about:

```tsx
const taskId = task?.id;
useEffect(() => {
  if (taskId) { setActiveTab('overview'); setShowEditor(false); }
}, [taskId]);
```

**The general rule.** In a live-data screen, *object identity is not entity identity.* Any effect
that resets UI state "when the record changes" must key on the record's **id**, or it will fire on
every background refresh — and the more useful the state it resets, the worse the symptom. The
failure is silent by construction: nothing throws, no request fails, and the only witness is the
person who was mid-sentence.

**Why it went unnoticed for a month.** The three modals this replaced were short-lived and
single-field — you opened one, changed one value, saved within a few seconds, and mostly beat the
poll. Merging them into one longer form (name, category, schedule, command) made the window wide
enough to lose, which is how a latent bug becomes a reported one: **the defect did not change, the
exposure did.**

*First hit: 2026-08-13, while collapsing the four per-part edit controls into a single editor. Found
by reading the effect during the refactor rather than by hitting it — but it was live in the shipped
app, where an `EditScheduleModal` left open across a poll closed the same way.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 53. The proxied dashboard is stale while the dev server is current

**Symptom.** You fix something in the frontend, confirm it on `http://localhost:7373`, then open
Cronsole on your phone through the tunnel (or `http://127.0.0.1:8080` locally) and the fix is not
there. Hard-refreshing does not help. Nothing errors, and both pages otherwise work.

**Cause.** The single-origin proxy serves **`frontend/dist`** — a build artifact — not the Vite dev
server. Deliberately: dev serves hundreds of unbundled ES modules and opens its own HMR WebSocket
on `:7373`, which is slow over a tunnel and would need the tunnel hostname in Vite's
`allowedHosts`. The cost is that the proxied copy only changes when you rebuild.

**Fix.**

```bash
cd frontend && npm run build
```

The proxy mounts `./frontend/dist` read-only and Caddy serves it directly, so no container restart
is needed — the next request picks up the new files.

> **`build:remote` is no longer required** *(since 2026-08-17)*. `FALLBACK_API_ORIGIN` in
> `frontend/src/api.ts` folds on `import.meta.env.DEV`, so **every** production build defaults to
> same-origin and both scripts emit the same bytes. `.env.remote` still exists and still says
> `VITE_API_URL=same-origin`, as belt-and-braces rather than as the mechanism. The mode is kept
> because runbooks name it; correctness no longer depends on remembering it.

**Detecting it before it wastes an afternoon** *(added 2026-08-23)*:

```bash
node scripts/check-dist-fresh.mjs        # STALE | NEVER BUILT | OK | UNKNOWN
```

It compares the newest file in `dist/assets` against the newest of `frontend/src/**`,
`index.html`, `vite.config.ts` and `package.json`, and **omits itself** when the proxy is down —
nothing serves `dist` then, so its age is a fact about nothing, and rendering that as a pass is
the mistake the health tiers exist to prevent. Wired into `/doctor` as check 7.

**This recurred on 2026-08-23** and cost an hour, in the most misleading possible form: a feature
shipped, passed 1,740 tests, was verified end-to-end with `curl` against the backend — and was
absent from the proxied page, because `dist` was four days old. Every signal said the code was
correct. It was; nothing was serving it. **`cronsole up` starts the proxy and never rebuilds
`dist`**, and that stays true deliberately — a start command that silently replaces what is being
served is a worse property than a bundle you occasionally have to rebuild.

**The general rule.** This is a **fourth thing that runs stale**, and it belongs on the list with
the other three (the Dockerized backend, `agent/publish/`, `mcp-server/dist/`). All four share one
shape: *a compiled or published copy that keeps serving while the source moves underneath it*, with
no error to say so. It differs from the other three in one way worth knowing — it is **conditional**,
present only when the opt-in `proxy` profile is running, so it will not be on your mind by default.

Two supporting details keep it from being worse than it is. The Caddyfile sends `Cache-Control:
no-cache` for the entry document and `immutable` only for Vite's fingerprinted `/assets/*`, so a
rebuild is picked up on the next load rather than living in the phone's cache indefinitely. And
`npm run build:remote` runs `check-bundle-secrets.mjs` after the build, so the rebuild you have to
remember is also the thing that re-verifies the bundle (see [#55](#55-the-dashboard-is-already-signed-in-on-a-browser-that-never-logged-in)).

**Not this entry if the proxied page is *current*.** Rebuilding with the wrong command produces the
opposite symptom — a fully up-to-date dashboard that cannot reach the API at all. See
[#63](#63-the-proxied-dashboard-loads-on-the-phone-but-cannot-reach-the-backend); `npm run build`
and `npm run build:remote` are one word apart and both build cleanly.

*First hit: 2026-08-15, while building the single-origin reverse proxy.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 54. A compose profile you never start breaks every compose command

**Symptom.** After adding the remote-access services, every Docker Compose command against the
repo fails:

```
error while interpolating services.tunnel.environment.TUNNEL_TOKEN: required variable
CLOUDFLARE_TUNNEL_TOKEN is missing a value: Set CLOUDFLARE_TUNNEL_TOKEN in .env — ...
```

Including `docker compose up -d`, which starts only Postgres and Redis and has nothing to do with
the tunnel. `docker compose config --services` fails the same way, so you cannot even list what is
defined.

**Cause.** `${CLOUDFLARE_TUNNEL_TOKEN:?message}` — Compose's "required variable" syntax. It reads
as a scoped precondition on the `tunnel` service, and it is not: **Compose interpolates the entire
file before it decides which profiles are active.** A required variable anywhere in the file is
therefore required for *every* command against that file, whether or not the service using it is
ever started. The effect was that a Cloudflare tunnel credential became a precondition for starting
the database.

**Fix.** Use an empty default and let the service fail on its own terms:

```yaml
TUNNEL_TOKEN: ${CLOUDFLARE_TUNNEL_TOKEN:-}
```

An unset token now surfaces at `docker compose logs tunnel` when you actually start it, instead of
at every unrelated command. It cannot be caught earlier in the container: `cloudflare/cloudflared`
is a **distroless image with no shell**, so the command cannot be wrapped in a guard that prints a
better message (`docker run --entrypoint /bin/sh` fails with `stat /bin/sh: no such file`).

**The general rule.** `:?` is for a variable the **whole file** cannot work without — not for one a
single optional service needs. Profiles scope what *runs*; they do not scope what is *interpolated*.
Anything added under a profile should be checked with `docker compose config --services` **without**
that profile enabled, which is the cheap test that would have caught this immediately.

*First hit: 2026-08-15, while adding the `proxy` and `remote` profiles. Caught before commit by
running `docker compose config --services` — the failure was total and instant, which is the good
case; the bad case is a teammate hitting it on a clean clone.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 55. The dashboard is "already signed in" on a browser that never logged in

**Symptom.** You open the built dashboard from an origin that has never authenticated — a fresh
profile, a different port, or the new remote-access proxy — and it renders the full task list
immediately. No login screen. `localStorage` for that origin is empty.

**This is the severe one on this page.** Through the remote-access proxy it means the login screen
is not a gate: anyone who can load the page is already the owner.

**Cause.** A real JWT compiled into the JavaScript bundle.

`api.ts` reads an optional dev/E2E fallback token:

```ts
const DEV_TOKEN = import.meta.env.VITE_DEV_TOKEN as string | undefined;
// getAuthToken(): return loginToken ?? DEV_TOKEN;
```

Three true statements that together produce the leak:

1. **Vite loads `.env.local` in every mode**, not only `dev` — so `npm run build` sees it.
2. **A `VITE_*` reference is inlined as a literal at build time.** It is not read at runtime; it
   becomes part of the served JavaScript.
3. **`getAuthToken()` falls back to it whenever nobody is logged in** — exactly the state a new
   visitor is in.

Measured on this machine before the fix: `dist/assets/index-*.js` contained a valid token for the
owner account with `exp` in **2036**, readable by anyone who could fetch the page.

**The tell, and why nothing caught it.** Every place someone would look said the code was fine. The
comment above the line reads *"There is intentionally NO committed dev fallback — a hardcoded token
is a leaked credential"*, and that intent was correct. `.env.local` is gitignored, so nothing was
committed. All tests passed. The app behaved properly. **The source never contained the secret; the
compiler put it there** — which is why a linter or a source grep could not have found it, and why
the check that does find it reads the *build output*.

**Fix.** Gate the reference so it cannot survive a build:

```ts
const DEV_TOKEN = import.meta.env.DEV
  ? (import.meta.env.VITE_DEV_TOKEN as string | undefined)
  : undefined;
```

`import.meta.env.DEV` is statically `false` in any build, so the branch folds and the minifier drops
the string — the secret cannot reach a bundle even when `VITE_DEV_TOKEN` is set in the building
environment. Dev and the Playwright E2E suite are unaffected; there `DEV` is `true`.

Then verify, on every build: `frontend/scripts/check-bundle-secrets.mjs` scans `dist/` for
credential-shaped literals (JWTs, AWS/GitHub/Anthropic/OpenAI keys, private-key blocks) and fails
the build with the offending file. It is wired into **both** `npm run build` and
`npm run build:remote`.

**Check your own build:**

```bash
cd frontend && npm run check:bundle
```

**The general rule.** *A `VITE_*` variable is public by construction.* It is compiled into the
bundle and served to every visitor, so it can never hold a secret — the prefix is a marker meaning
"safe to publish", not "available to the frontend". Anything sensitive belongs behind a backend
route. And when a fallback exists so that *development* is convenient, gate it on `DEV` explicitly:
the failure mode is not a crash but a silent, total loss of the auth boundary, and it only becomes
visible the day the bundle is served somewhere other than localhost.

*First hit: 2026-08-15, found while verifying the remote-access proxy in a browser — the proxied
origin rendered a signed-in dashboard it had no credential for. **Pre-existing**: the plain
`npm run build` had the same defect, and had it for as long as `VITE_DEV_TOKEN` has been in
`.env.local`. It was survivable only because `dist/` had never been served anywhere but localhost;
the remote-access work is what would have published it.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 56. Prisma wants to reset your database over a migration you only added a comment to

**Symptom.** Adding a model and running `npx prisma migrate dev`:

```
The migration `20260728203202_add_task_exclusions` was modified after it was applied.
We need to reset the "public" schema at "localhost:5432"

You may use prisma migrate reset to drop the development database.
All data will be lost.
```

On a dev machine that is holding hundreds of real tracked tasks, the owner account, and every
platform connection. And **`npx prisma migrate status` says `Database schema is up to date!`** — so
the two commands flatly contradict each other.

**Cause.** An **applied migration file was edited afterwards.** In this case someone added a block
of explanatory comments to the top of `add_task_exclusions/migration.sql`. Those are `--` comments:
valid SQL, zero semantic change, and **the checksum still moves**, because Prisma hashes the file
bytes. A checksum mismatch reads to Prisma as *"the history you are standing on is not the history
that produced this database"*, and its only safe generic answer is to rebuild from scratch.

`migrate status` disagrees because it answers a different question — *are all migrations applied* —
and does not compare checksums. So the drift is invisible from the command you would naturally use
to check, right up until the day you add a migration.

**Do not accept the reset.** Verify, then reconcile.

**1. Find which migration drifted** (compare the stored checksum to the file's sha256):

```js
// run from backend/ so @prisma/client resolves
const rows = await prisma.$queryRawUnsafe(
  `SELECT migration_name, checksum FROM _prisma_migrations ORDER BY started_at`);
// sha256 each prisma/migrations/<name>/migration.sql and compare
```

**2. Verify the live schema actually matches the file** — this is the step that makes the fix safe
rather than a guess. Read the real table out of `information_schema.columns`, `pg_indexes` and
`pg_constraint`, and check it against the DDL in the file: every column name/type/nullability, both
indexes, and the foreign key's `ON DELETE` behaviour. If they match, the edit was cosmetic and the
database is exactly what the file describes.

**3. Only then, update the stored checksum** to the file's sha256:

```sql
UPDATE _prisma_migrations SET checksum = $1 WHERE migration_name = $2;
```

`migrate dev` then proceeds normally.

**The rule.** **Never edit a migration that has been applied — not even a comment.** A migration
file is not documentation; it is a hashed record of what was done. Explanations belong in
`schema.prisma` (which is regenerated and safe to annotate), in the changelog, or here.

**Why this is worse than it looks.** The dangerous part is not the drift, it is the **prompt**.
`migrate dev` presents "reset the database, all data will be lost" as the ordinary next step, in the
middle of a routine task, on the machine where the data actually lives. A person in a hurry — or an
agent following the instruction on screen — destroys a real database over a comment. The right
reflex when Prisma offers a reset on anything but a scratch database is to stop and find out *what
it thinks changed*.

*First hit: 2026-08-15, while adding the `ApiToken` model. The edit itself predates that by weeks;
nothing had needed a new migration in between, which is exactly why it lay dormant.*

## 57. Two counts for the same set disagree on screen — and both are "right"

**Symptom.** The dashboard's filter bar says `257 system hidden`. Two inches to its left, the source
rail's `System tasks` group says `111`. Clicking the chip reveals 111 rows. Nothing errors,
no test fails, and each number is individually defensible.

**Cause.** They answered **different questions** and had never been rendered side by side before.

- `applySystemLens(...).hidden` counts system tasks that **exist** — deliberately, and its docstring
  says so: the ownership toggle needs a number even in the `'only'` state, where the lens hides
  nothing.
- The rail's group counts the same set **faceted** — every *other* lens applied.

Under the *Failures* view those are 257 and 111. The chip was rendering the existence count under a
label (`N system hidden`) that claims something about **this list**, so it over-promised by 146.

**The tell.** The disagreement only appears once two surfaces print the same set. Before the source
rail, `hidden` had exactly one consumer, so a number that answered the wrong question looked fine
for months.

**Fix.** Split them by the question, not by the caller:

- **"What will clicking reveal?"** → faceted (`applyTaskFiltersExcept(all, filters, 'system')`
  filtered to `isSystem`). Anything printed next to a control that changes the list.
- **"Do you have any of these at all?"** → existence. Only for deciding whether a control is worth
  rendering. It must *not* be faceted, or the Ownership control would vanish on a view containing no
  system tasks — removing the explanation exactly when the list looks suspiciously short.

**The rule.** **A count beside a filter control is a promise about what clicking it does.** Same
defect the status chip had when it printed `Showing All 269` above two rows. When one number has two
plausible meanings, give each meaning its own name — `hiddenBySystemFilter` versus
`systemTaskCount` — rather than picking one and hoping every future caller wants that one.

*First hit: 2026-08-15, during the dashboard IA redesign. The bug predates it; the redesign is only
what put the two numbers in the same viewport.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 58. One unreadable template silently empties the whole hosted catalog

**Symptom.** Nothing errors. The Templates tab shows the bundled set and no imported ones, and
the gallery on the web shows templates the app does not have. Nothing on screen says the registry
was even consulted.

**Cause.** `RegistryCatalogSource.fetchAll` parsed each template with
`registryTemplateSchema.parse(...)`, which **throws**. That throw propagated to `listRaw`, whose
`catch` falls back to the *entire* bundled snapshot. So a single template file this build cannot
read discards every other template in the registry — including the dozens it could read perfectly
well.

The version gap is the realistic trigger, not corruption. The registry is a **published** artifact
that installed copies of Cronsole fetch, and the schema's `action` is a Zod *discriminated union* —
a member added later (`script` and `check`, 2026-08-15) is an unknown discriminator to every older
install, which fails the parse. Adding one action kind would have blanked the catalog for every
user who had not updated, with a green build, a clean push, and no symptom locally.

This is the [§11b](../../CLAUDE.md) failure mode in its purest form: **the surface that breaks is
not in this repo, and it breaks after everything here has passed.**

**Fix.** Skip the template, keep the catalog:

```ts
try {
  templates.push(registryTemplateSchema.parse(JSON.parse(text)));
} catch (err) {
  this.log(`registry template "${entry.id}" skipped (not readable by this version): ${reason}`);
}
```

A **checksum mismatch still throws.** That distinction is the whole point of the fix: an unknown
schema feature is a version gap and costs you one template, while a checksum mismatch is an
integrity failure on executable content — serving the rest of a tampered catalog is not the lesser
evil. Skipping is also what makes the schema additively extensible: a new `action.kind` now costs
an older install the new templates and nothing else.

**The general shape.** A loader that treats "one item I cannot read" as "the whole feed is bad"
turns every forward-compatible change into an outage, and does it *quietly*, because the fallback
path looks like a working app. Ask of any fetch-and-parse loop: **is the blast radius of one bad
item the item, or the batch?**

*First hit: 2026-08-15.* Found while scoping ADR 0002 — before publishing a new action kind rather
than after, which is the only reason it is a note and not an incident.

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 59. A check that correctly finds a problem is reported as "could not run the check"

**Symptom.** A Cronsole-native `CHECK` that fails its assertion comes back as an HTTP **502**. Over
MCP, `run_task` *throws*:

```
Cronsole API error (HTTP 502): GET https://api.example.com/health → 200 (expected 200–299) | body does not contain "ok"
```

The message is correct and the status code contradicts it. An agent reading the error reports *"I
couldn't run the check"*; the truth is *"the check ran and your endpoint is broken."* In the
dashboard the same run raised a red *Failed to run* toast rather than showing a failing result.

**Cause.** `POST /api/tasks/:id/run` ended every unsuccessful run with `res.status(502)`. The
comment above it argued the case, and argued it **correctly for the platforms that existed when it
was written**: for Windows and Claude a failure IS a failure to dispatch — an offline agent, an ACL
denial, a paused routine — so `500` would send you to debug Cronsole and `502` is right.

`CHECK` (2026-08-15) broke the premise. **A failing check is the check working**: it is a fact about
the user's system, which is the entire reason the job type exists. `502` means *the gateway had a
problem, retry* — so the one job type whose failures are worth acting on reported them in the one
way that says "ignore this and try again". The same applies to a `SCRIPT` exiting non-zero: the run
happened, and its exit code is the answer.

**The tell** is that Cronsole-native is the only platform that can reach this — it is the only one
where dispatch and execution are the same act, so `success` means something different there than it
does everywhere else in the codebase (see `ExecutionLog`'s rule in CLAUDE.md §9).

**Fix.** Say which question `success` is answering. `PlatformConnector.runTask` gained **`ran`**,
orthogonal to `success`:

| `success` | `ran`   | meaning                                          | route |
|-----------|---------|--------------------------------------------------|-------|
| `true`    | `false` | the platform accepted the start (Windows, Claude) | 200   |
| `true`    | `true`  | the job executed here and passed                  | 200   |
| `false`   | `true`  | the job executed here and **failed**              | **200, `success: false`** |
| `false`   | `false` | it could not be started at all                    | 502   |

`ran` is stamped once in `executeJob`, not in each executor, so a fifth job type cannot ship having
forgotten it — and a spec rejected by `validateJob` never executed, so it stays `false` and keeps
the 502.

**Two consumers had to change with it**, and both are the sort of thing a status-code fix leaves
behind:

- The dashboard's `runMutation` read only the HTTP status, so a 200 would have toasted *"triggered
  successfully"* over a failing check.
- `run_task` returns the failing run as a **result**, not an error, with the text `Task ran and
  FAILED: …` — a model that reads only the first line must not come away thinking it passed.

**The general shape.** A status code is a claim about *what kind of thing went wrong*, and it is
inherited from whatever the route did first. When a route gains a genuinely new kind of outcome, the
old code's reasoning can stay word-for-word correct about the old cases while being wrong about the
new one — and nothing fails, because a status code has no test unless someone writes one. Ask:
**does every branch that returns this code still mean what the comment above it says?**

*First hit: 2026-08-15.* Found by driving the new job types end-to-end on a live stack — the
structural argument that they worked was sound, and this is exactly what it could not have told us.

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 60. A schedule is stored 7–8 hours off, and the UI says the timezone doesn't matter

**Symptom.** With `Settings › Schedule timezone` on Pacific, you type a working-day schedule:

```
0 9-17 * * 1-5
```

It is stored **exactly as typed** and runs 01:00–09:00 Pacific. The hint under the field, where
every other schedule prints *"Stored as … UTC"*, instead reads:

> This schedule has no fixed clock time, so it reads the same in PDT and UTC.

**Cause.** `shiftCron` only converts an expression whose minute **and** hour are single numbers
(plus the hourly `M * * * *` case). `9-17` is not, so it correctly declined to shift — and returned
`{ shifted: false }` with **no `reason`**.

The trap is what `reason` being absent *means* downstream. `ScheduleZoneHint` has three branches:
a reason (warning), a shift (shows the stored UTC), and otherwise **"no fixed clock time"**. So
`shifted: false` with no reason is not silence — **it is a positive claim that the zone is
irrelevant**, and here both halves of that claim were false. The user is told the conversion was
unnecessary while their working day sits in the database seven hours out.

This is the same family as [#51/#51a](#51a-the-same-bug-in-the-step-branch--and-this-one-never-errors-at-all):
a multi-value cron field taking a path written for a single value. The difference is that this one
never touches `parseInt`, so it produces no wrong number anywhere — just a wrong *sentence*.

**Fix.** Every path that declines to shift must pick a side, so the refusal branch now asks whether
the expression pins a clock time at all:

- **`hour !== '*'`** — it names hours (`9-17`, `1,13`, `*/6`, or a fixed hour with several
  minutes). A zone change moves them, so this is a **refusal** and gets a reason naming what to do.
- **`hour === '*'`** — it recurs every hour, so a whole-hour offset really does leave it identical
  and saying nothing is correct. The one exception is a partial-hour zone (+05:30) with a
  multi-value minute field, which would have moved.

`*/6` counts as pinning clock times, which is easy to argue past: it fires at 00/06/12/18, and those
are four *different* wall-clock times in Pacific — the same reasoning that already makes "hourly at
:20" shift for a half-hour zone.

**The general shape.** Ask what a UI renders when your function returns *nothing*. If the empty case
has its own message, then **declining to answer and answering "no problem here" are the same code
path**, and a missing warning is upgraded into a confident false statement. A "nothing to report"
branch is a claim and needs the same evidence as any other.

*First hit: 2026-08-15.* Logged during the 2026-08-13 cron-parsing sweep as *"stores a zoned cron
7–8 hours off, silently"*; the `ScheduleZoneHint` half — that it was not silent but actively wrong —
turned up when fixing it.

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 61. The whole E2E suite fails, and every other suite is green

**Symptom.** `npm run test:e2e` fails **every test** — 18 of 18 — with variations of:

```
Locator: getByRole('heading', { name: 'Unified Task Dashboard' })
Expected: visible
Error: element(s) not found
```

Meanwhile `npm test` passes in backend (715), integration (223) and frontend (541). The app works
perfectly when you open it.

**Cause.** A **shared helper** referenced a label the UI no longer uses. `dashboardReady()` waited
for a heading reading *"Unified Task Dashboard"*; the 2026-08-15 IA redesign replaced it with a
heading that names the current scope (*"All Tasks"*, a source, or a collection). Every test in the
file calls that helper, so one stale string took the entire suite down.

The same commit stranded four more assertions, and they are worth knowing as a class — each named
a **thing the redesign removed**:

| Assertion | What happened to it |
|:---|:---|
| `[role="group"][aria-label="Task source"]` | the horizontal source **bar**, replaced by the rail |
| `aside` → `System Status` panel | deleted; per-platform health moved onto the rail row |
| `Cronsole (Scripts)` | renamed to **Programs** when `SCRIPT` took the name |
| `Edit action: Unsupported` for native | became supported when `PATCH /:id/job` shipped |

**Why nothing caught it.** `test:e2e` **is not in CI** — it needs a live stack (frontend + backend +
Postgres + an agent), so it only runs when someone runs it. And no other suite can stand in for it:
**jsdom does not evaluate CSS media queries**, so `hidden md:flex` is invisible to the unit tests and
they pass whether the class is right or wrong.

**Fix.** Anchor shared helpers on things that are not labels:

```ts
// Not a heading whose text names the current scope.
await expect(page.getByTestId('task-count-line')).toBeVisible();
await expect(page.getByTestId('task-list')).toBeVisible();
```

Then port each stranded assertion to where the behaviour actually lives — the rail marks selection
with `aria-current` (it is navigation, not a toggle), and health is a dot whose `title` carries the
state as text.

**Two traps while repairing it.**

- **A mask for an element that no longer exists is indistinguishable from no mask.** The visual
  baselines masked the removed source bar, so they silently stopped masking anything there.
- **A test that passes alone and fails in a full run is usually unmasked live data, not flake.**
  `dashboard chrome` differed by 96 pixels only when the mock-agent spec ran first — because that
  spec changes the missing-task count, and *"Clear 2 Missing"* was inside the screenshot. The Tools
  tab had the same fault via the Task health tiles. Both are now masked. Reaching for `retries`
  there would have hidden a real rule this file already states: **screenshot the chrome, assert the
  content.**

**The general shape.** A test suite is a mirror surface like any doc — it *describes* the UI. The
difference is that it fails loudly when it drifts, which is only useful **if something runs it**.
Ask of any suite outside CI: *what would tell me this had stopped working?*

*First hit: 2026-08-16.* Found by starting the mobile-verification pass, not by a failing build.
The mobile layout it was meant to check turned out to be fine.

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 62. Windows reports "not responding" 15 seconds after every successful request

**Symptom.** The dashboard health strip reads:

```
Windows Task Scheduler degraded - Agent connected but not responding (task:list timed out)
```

— and it says so nearly all the time, over an agent that is demonstrably fine. Sync returns 362
tasks, folders enumerate, tasks run. `cronsole.ps1 status` says ALL UP. Pressing **Sync** clears it
for a few seconds and then it comes back on its own, with no request in between.

**The tell.** It flips *without anything happening*. Drive `/api/tasks/health` around a successful
sync and the transition is exact:

```
[03:42:30] sync HTTP 200
[03:42:30] t+0s   HEALTHY
[03:42:38] t+8s   HEALTHY
[03:42:47] t+17s  DEGRADED - "Agent connected but not responding (task:list timed out)"
```

Nothing was asked of the agent between t+0 and t+17. The timeout being reported is the one belonging
to the request that had already **succeeded**.

**Cause.** Every verb in `WindowsAgentConnector` was shaped like this:

```ts
socket.on('task:full_list', handler);
socket.emit('task:list');

setTimeout(() => {                                // never cleared
  socket.off('task:full_list', handler);
  agentManager.markUnresponsive(userId, 'task:list');
  reject(new Error('Agent sync timeout'));
}, 15000);
```

The timer fired 15 seconds later **whether or not the request had already completed**. Two of its
three effects were genuinely harmless — `socket.off` on an already-removed handler is a no-op, and
`reject` on a settled promise is ignored — which is exactly why this survived: the *third* effect,
`markUnresponsive`, writes to the liveness record, and nothing else in the request path could
observe that it was wrong.

So Windows could never stay HEALTHY for more than 15 seconds after its last agent request, and the
45-second dashboard poll would almost always land in the poisoned window. All **ten** verbs had it.

**Why it matters more than a wrong colour.** `getHealth` is deliberately built to report *evidence,
never preconditions* ([#40](#40-the-sidebar-says-windows-is-online-and-synced-just-now-while-every-agent-request-times-out)),
and the evidence it was handed was fabricated. #40 was a status field claiming health it had not
observed; this is the same dishonesty pointed the other way — **a failure that never happened** —
and it is the more expensive direction. A dashboard that cries wolf on a working agent trains you to
ignore the one line whose entire job is to mean something is wrong, which is precisely the state you
are in when a *real* [#40](#40-the-sidebar-says-windows-is-online-and-synced-just-now-while-every-agent-request-times-out)
wedge happens.

**Fix.** One `agentRequest` helper (`backend/src/connectors/WindowsAgentConnector.ts`) owns the whole
round trip — listener, send, deadline — and cancels the deadline the moment the request settles.
`markUnresponsive` is now reachable from exactly one place, on the one path where the agent really
did not answer.

It is a helper rather than ten `clearTimeout` calls for the same reason `ran` is stamped once inside
`executeJob`: **a rule every call site must remember is a rule the eleventh verb will forget**, and
this failure mode is silent by construction — nothing throws, no suite goes red, and the only
witness is a dashboard quietly slandering a working agent.

Pinned by a table-driven test over all ten verbs (a successful round trip must never call
`markUnresponsive`), which fails **10/10** against the old code. A new agent verb belongs in that
table.

**The general shape.** *A timer that outlives the thing it was guarding is still running, and
whatever it writes is a claim about the present made from a stale intention.* Ask of any
`setTimeout` used as a deadline: **what happens if it fires after success, and can anything see
it?** Here two of three effects were self-cancelling and the third was a status write — the one an
error path would never surface.

*First hit: 2026-08-16.* Found while investigating a *different*, genuine failure the strip was
reporting (a real `List folders` failure from an agent outage), which is the only reason anyone
looked at the health record closely enough to notice the timestamps did not add up.

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 63. The proxied dashboard loads on the phone but cannot reach the backend

**Symptom.** Through the tunnel — `http://desktop-xxxx.ts.net:8080` on Tailscale, or the Cloudflare
hostname — the dashboard **renders correctly and is completely current**, including the feature you
shipped ten minutes ago, and then fails every request with a *cannot reach backend* error. The same
URL works from the machine running the stack. The proxy is up, `tailscale serve status` is right,
and the tunnel origin is in `ALLOWED_ORIGINS`.

**Cause.** `frontend/dist` was rebuilt with **`npm run build`** instead of **`npm run build:remote`**.
Without the `remote` mode there is no `VITE_API_URL`, so `api.ts` falls back to its default and
Vite inlines **`http://localhost:3000`** as a literal in the bundle. On the phone that address is
the *phone*, which is running no backend.

**The tell — and why it is the opposite of [#53](#53-the-proxied-dashboard-is-stale-while-the-dev-server-is-current).**
Both are `frontend/dist` problems and they present as mirror images, so the wrong one is easy to
reach for:

| | #53 (stale) | #63 (wrong mode) |
|---|---|---|
| Proxied UI | **behind** the dev server | **current**, matches the dev server |
| Requests | succeed | fail, every one |
| Cause | forgot to rebuild | rebuilt with the wrong command |

*If the proxied page shows your newest work and still cannot talk to the API, the build is fresh and
the mode is wrong.*

**Diagnosis — read the bundle, not the source.** The source is identical either way; the compiler is
what differs, which is the same reason [#55](#55-the-dashboard-is-already-signed-in-on-a-browser-that-never-logged-in)
had to be checked against build output:

```bash
cd frontend/dist/assets && grep -o '.\{20\}`same-origin`.\{20\}' index-*.js
```

The API origin is the argument to the normalizer. `Ll=Rl(\`same-origin\`)` is a correct remote build;
`Ll=Rl(\`http://localhost:3000\`)` is this bug. Grepping for either string alone proves nothing —
**both literals are in every bundle** (one is the sentinel constant, the other the fallback and a
placeholder in the Settings field), so you have to read the call, not the occurrence.

**Fix — and as of 2026-08-17 this cannot happen again on a current checkout.**

```bash
cd frontend && npm run build      # either command is now correct
```

**Every production build defaults to same-origin.** `FALLBACK_API_ORIGIN` in `src/api.ts` folds on
`import.meta.env.DEV`, which is statically `true` for `vite dev` and `false` for `vite build` — so
the dev server keeps its `http://localhost:3000` default (the API really is on another port there)
and a build resolves against `window.location`. `npm run build` and `npm run build:remote` now
produce the same correct bundle. `--mode remote` is kept because runbooks and muscle memory name
it, and setting `VITE_API_URL` still overrides both for a deployment on another host.

**Why a fold rather than a rule.** The old default was the literal `http://localhost:3000` and
correctness depended on remembering the longer command. That is a convention someone must
remember, and it failed twice — the second time silently breaking phone access for hours, found
only because someone happened to pick up the phone. `dist` has exactly one consumer, the reverse
proxy; `npm run dev` never reads it. So a built bundle is by definition one being served through
something, and the default now says so. Pinned by
`frontend/src/__tests__/apiSameOrigin.test.ts` (mutation-tested: restoring the old literal fails
it). A `.env.development` file was the other way to do this and cannot be — `.env.*` is
gitignored, so a fresh clone would silently get the wrong default for `npm run dev`.

The proxy bind-mounts `./frontend/dist` read-only, so no container restart is needed; the entry
document is served `no-cache`, so a reload on the phone picks it up.

**On an older checkout**, or any build where `VITE_API_URL` is set to an absolute origin, the
original fix still applies: `npm run build:remote`.

**The general rule.** *Two build commands one word apart, producing artifacts that differ only in an
inlined string, where the wrong one still builds cleanly, passes `check:bundle`, and serves a page
that looks perfect.* Nothing in the pipeline can tell them apart, because neither is wrong in
itself — `npm run build` is exactly right for the un-proxied stack. The mode is a **property of
where the artifact will be served**, and the artifact cannot carry that intent. This is the same
asymmetry as the publish step in [§11b](../../CLAUDE.md): a green build over a copy that is wrong
for its destination.

It is also worth noting *why* the desktop keeps working and hides this: on the machine running the
stack, `http://localhost:3000` **is** the backend, so the broken build is indistinguishable from the
correct one there. The bug is only observable from the device that has no local backend — which is
the device you are least able to open a console on.

*First hit: 2026-08-16, after a routine `npm run build` following a dashboard change. **Hit again
2026-08-17** — same cause, and that recurrence is what turned the fix from a documented command
into the fold above: a rule that has to be remembered under a command that reports success is not a
fix, it is a countdown.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 64. A gallery change doesn't show up in the local preview

**Symptom.** You edit `registry-site/index.html`, reload the local preview, and the change simply
is not there. A newly added CSS rule reads back as absent
(`getComputedStyle(el, '::before').float` → `"none"`), or new JS behaves exactly like the old code.
Nothing throws, the server is serving, and the page looks fine — just *old*. The natural conclusion
is that the fix is wrong, which sends you rewriting code that was already correct.

**Cause — two independent staleness traps, and they stack.** Either one alone produces the same
symptom, so fixing one and re-testing still shows the old page, which is what makes this expensive:

1. **The preview serves a copy.** The documented recipe (`registry-site/README.md` › Local preview)
   copies `index.html` into a scratch directory so it can sit beside a copy of the registry
   artifact. Editing the file in the repo therefore changes nothing until you copy it again —
   and the copy step is the one you did once, at the start, before the edits you are now testing.
2. **The gallery is a hash-router SPA.** Navigating to the same `#/t/<id>` URL is a *hash change*,
   not a page load: no HTML, CSS or JS is re-fetched, the router may not even re-render, and any
   inline style you injected from the console to simulate a narrow viewport is still applied.

**Fix.**

```sh
cp registry-site/index.html "$SCRATCH/"     # 1 — re-copy after every edit
```

then in the page, a real reload rather than a route change:

```js
location.reload(true)
```

**Prove the rule is loaded before judging the fix.** The measurement that misled here was
`getComputedStyle(el, '::before').float` returning `"none"` — which is what an *unloaded* stylesheet
and a *broken* rule both look like. Ask whether the rule exists at all:

```js
[...document.styleSheets[0].cssRules].some(r => r.selectorText === '.code::before')
```

`false` means you are testing the old file; only once it is `true` does a failed assertion say
anything about your CSS.

**The general rule.** *When a change appears not to apply, confirm the artifact under test is the
one you edited before concluding anything about the edit.* This is the same shape as
[#53](#53-the-proxied-dashboard-is-stale-while-the-dev-server-is-current) and the publish step in
[§11b](../../CLAUDE.md) — a correct source and a stale copy — with the twist that here the copy is
one **you** made, minutes ago, which is exactly why it is not the first thing you suspect.

*First hit: 2026-08-17, verifying the script/check rendering added to the gallery the same day.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 65. An exported task file has nowhere to go — and Restore refuses it

**Symptom.** You export a task (task modal → **Export**), get a `.json` file, and then cannot find
anywhere to put it back. Tools → **Restore** looks right — its file picker even offers `.json` — but
it answers:

```
No task XML files found. Pick the folder or .zip an export produced —
restore reads .xml task definitions.
```

The same dead end appears from the other direction: you delete a Cronsole-native task, the API
cheerfully reports `archived: true` with an `archiveId`, and there is no verb anywhere that turns
that archive back into a task.

**Cause — the export format had no reader.** `GET /api/tasks/:id/export` produced a
`cronsoleTaskVersion` bundle for native tasks, and `archiveTaskBeforeDelete` wrote the *same* shape
into `DeletedTaskArchive` before every MCP delete. Grepping the repo, `cronsoleTaskVersion` appeared
in three places: the builder, the archive writer, and a test fixture. **Nothing read it.** So the
Export button produced something that looked like a backup and was not one, and the pre-delete
archive was a promise of recoverability with no way to collect.

Restore's `.json` in its `accept` list was a second, smaller trap: it is there for the export
*manifest*, not for a task definition, so the picker accepted exactly the file the route then
refused.

**Fix — shipped 2026-08-17.** There are now two readers, and which one you want is decided by the
platform, not by preference:

| The file you have | Where it goes |
|:---|:---|
| `*.json` from a **Cronsole-native** task's Export | Tools → **Import a task**, or the *Import a .json file* link in the New Task modal |
| `*.xml` / `*.zip` from a **Windows** task's Export | Tools → **Restore tasks from a backup** |
| A task you **deleted** (native only) | Tools → **Import a task** → *Deleted tasks* → Restore |

Over MCP: `import_task`, `list_task_archives`, `restore_task_archive`.

**Why the split is real and not an oversight.** A Cronsole-native task's database row *is* the task,
so it round-trips through JSON. A Windows task's definition lives on the machine as Task Scheduler
XML, and reaching it needs an online, elevated agent — which is why the archive cannot capture it
(an archive write is a *precondition* of a delete, and a precondition that needs the agent would
make deleting impossible while it is offline). So a Windows archive records the task's identity and
`job: null`, and the restore route refuses it **by name**, pointing at the XML path.

**The tell that this class of bug is present:** an output format whose only mentions in the codebase
are the code that *writes* it. That is the same shape as a status field only a mistake can fill
([#42](#42-the-dashboard-says-synced-7m-ago-over-a-task-list-from-yesterday)) — the artifact exists,
looks correct, and is never read, so nothing can ever contradict it. Grep for your own format
constant; if every hit is a writer, the feature is half-built no matter how green the suite is.

**One asymmetry fixed at the same time.** `DELETE /api/tasks/:id` — the button in the UI — did
**not** archive, while `DELETE /api/tasks/:id/native` (the MCP path) always did. Recoverability was
therefore a property of *which door you deleted through*, which is not something either screen said
or a user could guess. Both archive now.

*First hit: 2026-08-17, noticed while looking for the import path a user expected to exist.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 66. Two Cronsole surfaces disagree about the agent in the same second

**Symptom.** `get_diagnostics` (Tools → *Diagnose*, or the MCP tool) reports the Windows agent
`pass` — *"Connected and answering"*, socket connected, machine named, *"Last request timeout: none
this connection"*. At the same moment `list_platforms` / the **Platforms** tab reports:

```
WINDOWS_TASK_SCHEDULER   healthState=OFFLINE   healthReason=Agent not connected
```

The agent is fine. `list_folders` returns a real folder tree on demand. The giveaway is *inside the
Platforms row itself*: its **List folders** capability cell carries a `lastSuccessAt` from a minute
ago, sitting beside a verdict that says nothing is connected.

**Cause — the matrix served a cached verdict nothing on that path refreshes.**
`buildPlatformMatrix` read `PlatformConnection.healthState` straight out of the database. That
column has exactly one writer: the loop inside **`GET /api/tasks/health`**, which is the
*dashboard's* 45-second poll. Nothing on the MCP surface writes it — `get_task_health` wraps
`GET /tools/task-health`, a different route — so with no browser tab open the column simply stopped
being updated, and the matrix reported whatever the last poll had left behind. Here that was an
`OFFLINE` from before the backend restarted; the agent reconnected 37 minutes earlier and nothing
had written the column since.

Proof takes two commands and no restart:

```powershell
$h = @{ Authorization = "Bearer $env:CRONSOLE_TOKEN" }
(Invoke-RestMethod localhost:3000/api/tools/platforms -Headers $h).platforms[0].healthState  # OFFLINE
$null = Invoke-RestMethod localhost:3000/api/tasks/health -Headers $h                        # the dashboard's poll
(Invoke-RestMethod localhost:3000/api/tools/platforms -Headers $h).platforms[0].healthState  # HEALTHY
```

**Fix — shipped 2026-08-17.** `buildPlatformMatrix` derives health per connection from
`connector.getHealth` at request time, the way `GET /api/tasks/health` and the diagnostics panel
already did, so the three surfaces cannot disagree. The stored column is still written by the
dashboard poll and is still read as a last resort where no connector exists. A connector that throws
yields `UNKNOWN`, never a healthy-looking gap — a readout may not fail the thing it reports on.

State and reason are taken from **one source together**: a live verdict never carries the stored
explanation, which would be the "stale reason under a fresh state" bug the health route already
guards against one layer up.

**This is [#40](#40-the-sidebar-says-windows-is-online-and-synced-just-now-while-every-agent-request-times-out)
moved down a layer.** #40 was a verdict derived from a *precondition*; #48 was a verdict from an
*expired observation*; this is a verdict from a *cache with one writer on another code path*. All
three share the tell: **a value that cannot change when its subject recovers.**

**Why it hid.** In a browser everything is correct — the poll that refreshes the column is running
the whole time you are looking at the tab. The failure needs a session where *nothing polls*, which
is exactly an AI assistant driving Cronsole over MCP. And it is worse there than on screen: a person
seeing a stale strip presses Sync, while an assistant told the agent is offline reports that back
and declines Windows work that would have succeeded — `list_platforms` is documented as the thing to
check *before* planning.

**The reusable question:** for any status field, ask *which code path writes it, and is that path
running in the session doing the reading?* A column refreshed only by the UI's poll is not a fact
about the system; it is a fact about whether anyone had a tab open.

*First hit: 2026-08-17, found by driving the MCP tools after the diagnostics tool shipped — the
second opinion is what made it visible.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 67. The dashboard shows no tasks, and every rail count reads 0

**Symptom.** The task list is empty and the whole source rail reads zero:

```
All sources            0        Claude Code              0
Favorites              0        Cronsole (Native)        0
AI Lab                 0        Windows Task Scheduler   0
```

Everything else looks healthy — `cronsole up` says `ALL UP`, all three platforms are online, the agent
answered a minute ago, and `GET /api/tasks` returns every task. The header directly above the zeros
says **"Manage 373 tasks across your ecosystem."**

**Cause — a search or filter was still in the URL.**

```
http://localhost:7373/?status=any&system=include&q=test-search
```

Filter state **is** the URL ([§9](../../CLAUDE.md)) — that is what makes a view shareable and
reload-proof. The same property means a search you ran once survives a reload, a bookmark, a pinned
tab and a session restore, and goes on filtering until something clears it. Nothing is wrong with
the stack.

**The all-zero rail is intended, not a second bug.** The rail counts over *every lens it does not
own* — status, outcome, due, **and search** — neutralizing only its own dimensions (source, category,
favorites, collection). From `DashboardScreen.tsx`:

> A rail row's count is a promise about what clicking it does.

Clicking **Windows Task Scheduler** applies `RAIL_SCOPE_RESET`, which resets the rail's dimensions
and **keeps your search** — so that row really would land you on 0 tasks, and `0` is the honest
number. Neutralizing search in those counts would make every row promise a population clicking it
does not produce, which is the [#20a](#20a-and-a-renamed-category-silently-stops-syncing-its-folder)
shape.

**Fix.** Clear the search — the × in the search box, **Clear search "…"** in the empty state, or
**Reset to the default view**. Or just delete the query string.

**Read the URL first.** The app is not being quiet about this; it says so in four places at once:

| Where | What it shows |
|---|---|
| Search box | the term, an × to clear it, and `0 matches` beside it |
| **Filters** control | a badge with the active filter count |
| **VIEWS** row | drops off the built-in views to **Custom** |
| Empty state | *"You have 373 tasks. This view shows none of them — it is filtered by matching …"*, plus **Clear search** and **Reset to the default view** |

**Why it still cost hours.** An empty dashboard behind a working login *reads* like a broken
backend, and that read is strong enough to survive contrary evidence. Two investigations chased it
down two different layers — first stale browser auth, then the database — and both produced real,
true findings that were not the cause:

- **Stale auth was never possible here.** The dev origin stores *no* token at all (the
  `VITE_DEV_TOKEN` bypass keeps nothing in `localStorage`), so no stored token could have shadowed
  it. And a 401 renders the **login screen**, not an empty list — a different symptom pointing at a
  different layer.
- **The database finding was real but unrelated.** `logs/backend.err.log` did carry Prisma
  `P1001 — Can't reach database server at localhost:5432` while `docker inspect` showed
  `RestartCount=0` and the container checkpointing straight through, meaning the *client's* pool had
  died, not the server. Worth knowing — and worth knowing that **`GET /api/health` never touches the
  database**, so the launcher reports the backend `UP` for exactly the failure that would empty
  every data route. But that pool had already recovered, and `/api/tasks` was serving 372 tasks
  throughout the investigation.

**The reusable question:** *before blaming a layer, does its failure produce **this** symptom?* Both
theories above were falsifiable in one command — `curl /api/tasks` (it returned everything) and
reading `localStorage` (it was empty) — and both were checked only after a fix had been written.
When the UI is telling you what it filtered by, the address bar outranks the logs.

*First hit: 2026-08-19. Found by the user, after two agents had investigated the wrong layers.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 68. The hosted registry goes backwards after a successful publish

**Symptom.** You merge new templates, run `pwsh scripts/publish-registry.ps1`, and it prints:

```
Refreshing clone at D:\AI_Agents\Projects\Mikes_AI_Lab\Repos\Tools\cronsole-registry
Published. GitHub Pages will rebuild shortly (https://mikesailab.com/cronsole-registry).
```

The gallery then serves **fewer** templates than before, or the same count it had last week. Nothing
errored. The registry is not corrupt — every `sha256` in the served `index.json` matches its served
file exactly, because it is a coherent snapshot. Just an older one.

**Cause — the script publishes the working tree, not `main`.**

```powershell
$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Definition)
$SrcDir = Join-Path $RepoRoot 'registry'
```

That is whatever is checked out right now. The normal working branch here is `mike_desktop`, and
because PRs merge *into* `main` without `main` ever being merged back, it sits **158 commits behind**
in ordinary use. Publishing from it mirrors that branch's `registry/` over the public repo, wholesale
— the newer templates on `main` are not merged with, they are **replaced**.

Caught 2026-08-19 one command before it happened: five templates had just merged, the working tree
still held the previous 72, and the count check ran first only by luck.

**Why nothing catches it.** Three separate guards all pass:

| Guard | What it proves | Why it is silent here |
|:---|:---|:---|
| Registry drift test | committed `registry/` matches a fresh `npm run registry:build` | True on the stale branch too — it was built correctly, just earlier |
| Content addressing | every served file matches its `sha256` | An old snapshot is internally consistent |
| The script itself | the push succeeded | It did. It pushed the wrong commit's artifact |

**Fix.** Publish from up-to-date `main`. Since 2026-08-19 the script refuses to do anything else:

```
Refusing to publish from branch 'mike_desktop'. The registry is published from main --
the only branch whose registry/ has passed the drift test in CI.
```

and, on `main` but behind:

```
Refusing to publish: HEAD is 3 commit(s) behind origin/main, so registry/ here may be
older than what is merged. Run 'git pull' first, or pass -Force.
```

Better: **do not run it at all.** Merging to `main` now publishes through
`.github/workflows/publish-registry.yml`, which checks out `main` by construction and cannot have
this bug. The manual script is the out-of-band path.

**Verify, either way** — this compares the live host against the committed artifact by id and
`sha256`, and names what differs in which direction:

```bash
node scripts/check-registry-published.mjs
```

It runs daily as the **Registry drift** workflow. If it ever reports templates *served but no longer
on `main`*, that is this bug's signature: the host is ahead of nothing and behind something.

**The general shape.** A publish step that reads the filesystem instead of a named revision will
publish whatever a human left checked out. The tell is that success and failure print the same
thing — a script that cannot fail cannot warn you.

*First hit: 2026-08-19, near-miss. Guard, workflow and drift check added the same day.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 69. A published-page check reports both hosts stale, and they are not

**Symptom.** `check-frontdoor-published.mjs` says the gallery page is stale at *both* public
addresses, having just been published:

```
main: registry-site/index.html is 116670 bytes, sha256 24f35d19e00b0bda...
  STALE https://cronsole.mikesailab.com/            115126 bytes, sha256 a895ef67b4d9334b...
  STALE https://mikesailab.com/cronsole-registry/   115126 bytes, sha256 a895ef67b4d9334b...
```

Both hosts report the **same** hash as each other, and a different one from the repo. Publishing
again changes nothing. The same check passes on a Linux CI runner, on the same commit.

**Cause — CRLF in the Windows working tree.**

```
116670 - 115126 = 1544        # exactly the number of lines
```

Git stores the blob with LF and hands Windows a CRLF working copy. GitHub Pages serves the *blob*,
so the served bytes are LF. Hashing the file as it sits on a Windows disk therefore compares
CRLF against LF and can never match — while the identical check on Linux, where the working tree is
already LF, passes.

Two hosts agreeing with each other and disagreeing with you is the tell: a real staleness would
almost never hit both hosts identically, because they publish through different paths.

**Fix.** Both, deliberately:

1. **`registry-site/**` is pinned `text eol=lf`** in `.gitattributes`, so the working tree holds the
   bytes that get served. This matters beyond the check: `publish-frontdoor.ps1` copies the working
   file, so on Windows it was copying CRLF into the publish clone and relying on git to normalize it
   back on commit.
2. **The checker normalizes anyway** before hashing, so it is correct on a checkout made before that
   pin and under any `core.autocrlf` setting.

After the pin, refresh an existing checkout — `.gitattributes` does not rewrite files already on
disk:

```bash
rm registry-site/index.html && git checkout -- registry-site/index.html
```

**The general shape.** Any check that hashes a working-tree file and compares it to something
served, published or transmitted is comparing across a line-ending boundary, and will disagree by
platform. `registry/**` was pinned LF from the start for exactly this reason — the pin was simply
never extended to the page next to it.

*First hit: 2026-08-19, on the drift check's first run against the real hosts.*
## 70. The Tailscale URL is dead for days while every other service is healthy

**Symptom.** `http://my-pc.my-tailnet.ts.net:8080/` returns **502 Bad Gateway** with an empty body,
from every device. Nothing else looks wrong: `cronsole status` says `ALL UP`, the dashboard works on
the PC at `localhost:7373`, the agent is connected, and `tailscale status` lists both machines.

`tailscale serve status` looks perfect, which is what sends you the wrong way:

```
http://my-pc.my-tailnet.ts.net:8080 (tailnet only)
|-- / proxy http://127.0.0.1:8080
```

**Cause — the Caddy proxy container was stopped, and `restart: unless-stopped` means it.**

The 502 is `tailscaled` reporting that *its upstream* refused the connection. The tell is one command:

```console
$ curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/
000                                   # nothing is listening at all

$ docker ps -a --format '{{.Names}}\t{{.Status}}'
taskhub-proxy-1   Exited (0) 2 days ago
```

**`Exited (0)` is the whole story, and it is Docker working exactly as designed.** `unless-stopped`
restarts a container after a crash and after a reboot, but an *explicit* `docker compose stop` is a
deliberate act it will not undo — that is the difference between it and `always`. So the proxy stayed
down across two days and several reboots, and nothing ever said so.

Two things then conspired to keep it invisible:

- **The proxy is profile-gated** (`profiles: ["proxy", "remote"]`), deliberately — remote access is
  opt-in ([§9](../../CLAUDE.md)), so nothing about it runs on a plain `docker compose up -d`. A
  routine "bring everything back up" therefore *cannot* restart it, and doesn't fail either.
- **`cronsole up` did not know the proxy existed**, so the `\Cronsole-Stack\CronsoleStack` task —
  which re-runs `cronsole up` every 5 minutes precisely so a dead service comes back — self-healed
  four services and walked past the fifth.

**Do not debug Tailscale first.** Curl the tailnet name from the machine itself and read the status
code, because the two failures are different codes and neither is a timeout:

| What you get | What is actually wrong |
|---|---|
| **502**, empty body | `tailscale serve` is fine; **its upstream is down** — look at `127.0.0.1:8080` |
| **404 page not found**, `Content-Type: text/plain` | `tailscale serve` answered, but no handler matched the **Host** you sent. Curling the tailnet *IP* does this every time — the handler is keyed on the hostname. Send `-H 'Host: my-pc.my-tailnet.ts.net:8080'` |
| Connection refused / timeout | Now it is Tailscale: node key expiry, MagicDNS, or the device left the tailnet ([Remote Access Guide](../user-guides/guides/Remote_Access_Guide.md)) |

**Fix — make the opt-in something the self-heal can see (2026-08-20).**

```console
$ cronsole remote on          # starts the proxy AND records the choice
$ cronsole status             # the table now carries a Proxy :8080 row
```

`cronsole remote on` writes `.cronsole-remote` at the repo root (gitignored, per-machine), and
`Invoke-Up` starts the compose `proxy` service whenever that marker is present. An explicit stop now
lasts at most one 5-minute interval instead of lasting until somebody picks up their phone.

**Why a marker file and not an environment variable.** The reader is a Scheduled Task. It runs with a
bare environment that has never seen anything exported in a terminal — the same property that makes
`CRONSOLE_TOKEN` vanish from an MCP host launched the wrong way ([#8](#8-every-mcp-tool-returns-403-invalid-or-expired-token)).
An opt-in the self-healer cannot read is not an opt-in.

**Why it stays opt-in rather than just always starting.** The proxy publishes the dashboard, and
whether a machine does that is a property of the machine, not of the checkout — which is why the
marker is gitignored and why `.gitignore` says so. Committing it would silently opt in every clone,
which is the exact invariant the profile gate exists to protect.

**The reusable question:** *which process is supposed to restart this, and is that process able to
see that it should?* `restart: unless-stopped` and a 5-minute self-heal both look like coverage. The
first excludes deliberate stops by design; the second only covers services its script enumerates. A
service that is in neither set has no keeper at all, and the gap is silent in both directions.

*First hit: 2026-08-20. Two days of downtime, noticed on a phone.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 72. The sidebar is half empty at a second address

**Symptom.** You open Cronsole at a second address — the Tailscale name, the proxy, a different
port — and the source rail is missing your **pinned folders** and **saved views**. Your
**collections and favorites are all present.** Nothing errors, nothing appears in the console or
the backend log, and the same browser at `localhost` shows everything correctly.

**Cause — `localStorage` is scoped to an origin, and half the rail lived in it.**

An origin is scheme + host + port, so `http://localhost:8080` and
`http://desktop.tail-scale.ts.net:8080` are two different sites as far as the browser is
concerned, each with its own store. That is a browser rule, not a Cronsole setting, and there is
no way to opt out of it.

What made this read as a bug rather than as a boundary is that the rail was drawn from **two
different kinds of storage at once**:

| In the sidebar | Where it lived | Followed you to the second address? |
|:---|:---|:---|
| Collections | `TaskCollection` rows, keyed on the user | **Yes** |
| Favorites | `TaskFavorite` rows, keyed on the user | **Yes** |
| Pinned folders | `railPins` in the `cronsole.settings` blob | No |
| Saved views | `savedViews` in the same blob | No |

Both halves render in the same component, in bands that look alike on purpose. Half a sidebar
arriving is a far more confusing signal than none of it arriving.

This was never wrong on its own terms — a pin *is* a preference, holds no foreign key, and means
nothing to another account (`utils/railPins.ts` argues exactly that, and still does). What the
argument had not considered is **one user at two origins**, which is precisely what remote access
made routine.

**Fixed 2026-08-23.** The whole `cronsole.settings` blob is stored against the account in
`UserPreference` and read back at every address (`GET` / `PUT /api/preferences`). Settings → Data
& reset shows the state: **Synced**, **This browser** (nobody signed in), or **Not synced** (the
account could not be reached; changes are held locally and retried).

**Three things still do not sync, and that is deliberate** — each describes the device rather
than you:

- **Theme.** It is read *before* login, so syncing it would mean painting the wrong theme and
  repainting on every load.
- **The API-origin override** (Settings → About). It names an address; a synced one would be
  correct on exactly one machine.
- **The login session.** A token is issued to a browser.

**If a second device still looks empty**, check Settings → Data & reset on the device that *has*
the preferences. If it says **This browser**, nothing has been stored to the account yet — sign
in there and change any preference once to seed it. A browser where nothing has ever been changed
deliberately does **not** seed the account, so that opening the dashboard once on a phone cannot
flatten a desktop you have curated.

**A caution worth stating**: two devices editing preferences in the same moment resolve by
recency over the *whole* document, not field by field. Reorganising the sidebar in two places at
once can lose one side of it.

## 71. A native task refuses to start and names a secret

**Symptom.** A Cronsole-native task's run history reads:

```
This job refers to a secret that is not set on this task: DISCORD_WEBHOOK.
Set it in the task's Secrets section (Edit → Secrets), then run it again.
```

Over the API and MCP the run comes back as a **502**, not as a `200` with `success: false`. Nothing
is broken.

**Cause — this is the designed refusal, and the 502 is the point** ([ADR 0003](../adr/0003-per-job-secrets.md)).

A native job never stores a credential. It stores a reference — `${secret.DISCORD_WEBHOOK}` — and
the value lives AES-256-GCM encrypted in its own `TaskSecret` row. A reference with nothing behind
it is a failure to **start**: `executeJob` returns `ran: false`, which the route turns into a 502
exactly as it does for a malformed spec ([#59](#59-a-check-that-correctly-finds-a-problem-is-reported-as-could-not-run-the-check)).

Substituting an empty string instead would be the worse outcome, and that is why it is not done:
`Authorization: Bearer ` produces a **401 that reads like an expired token**, sending you off to
rotate a credential that was never sent.

Four ordinary ways to arrive here, none of them a bug:

- **You imported a task file.** The bundle carries the job — including its `${secret.…}` references
  — and none of the values, deliberately: a file in someone's Downloads folder is exactly where a
  credential must not be. The import response names them under `missingSecrets`.
- **You restored an archive.** Same reason, one step stronger: the archive *outlives* the row it
  describes, which makes it the last place a credential should survive a delete.
- **You applied a template** that references one.
- **You removed the secret** and have not yet edited the job.

**Fix.**

Open the task → **Edit** → **Secrets** and enter the value. The section marks a referenced secret
that is not stored as *Not set*.

To diagnose without the UI:

```console
$ curl -s -H "Authorization: Bearer $CRONSOLE_TOKEN" \
    http://localhost:3000/api/tasks/<id>/secrets
{"stored":["OLD_KEY"],"referenced":["DISCORD_WEBHOOK"],"missing":["DISCORD_WEBHOOK"],
 "unreadable":false,"secretsUpdatedAt":"2026-08-21T…"}
```

Read all four fields; they are four different facts:

| Field | Means |
|---|---|
| `referenced` | what the **job** asks for |
| `stored` | what the **task** holds — one that nothing references is leftovers, not a fault |
| `missing` | the intersection that stops the run |
| `unreadable: true` | **a store exists and cannot be decrypted.** `ENCRYPTION_KEY` changed since it was saved; the values are unrecoverable and must be re-entered. It reports `stored: []` as well, so reading only that list would tell you to set values that are already there |

**No MCP tool can set a value**, and `list_task_secrets` is the read half only — a tool call passes
through the model's context and into the host's transcript. The value is entered in the app.

**Two related refusals that are also by design:**

- **A secret must be at least 4 characters.** Redaction is a substring replace over the job's
  captured output, so a shorter value would blank those characters out of every word the job prints.
- **A task with secrets cannot be saved as a template.** A template would either carry the value
  into the catalog or carry the reference and produce a task that applies cleanly and then refuses
  to run. Export it as a task file instead.

*First hit: 2026-08-21.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 71a. …and in a worktree there is no process to stop

**Symptom.** In a git worktree of this repo, `npx prisma generate` fails with
[#26](#26-prisma-generate-fails-with-eperm-operation-not-permitted-rename--query_engine-windowsdllnode)'s
error:

```
EPERM: operation not permitted, rename
'…\cronsole\backend\node_modules\.prisma\client\query_engine-windows.dll.node.tmp31812' ->
'…\cronsole\backend\node_modules\.prisma\client\query_engine-windows.dll.node'
```

Two things are odd. The path names the **main checkout**, not the worktree you ran it in. And
[#26](#26-prisma-generate-fails-with-eperm-operation-not-permitted-rename--query_engine-windowsdllnode)'s
fix has nothing to aim at: `npm run dev` is not running, `docker ps` shows no backend container, and
nothing obvious holds port 3000.

**Cause — two facts that only bite together.**

1. **A worktree's `node_modules` is a symlink into the main checkout** (`backend`, `frontend` and
   `mcp-server` all are). So `prisma generate` run from the worktree writes into the *shared*
   `node_modules` and collides with whatever holds the DLL open **there**.
2. **The process holding it may be unidentifiable from your session.** On a machine with
   `\Cronsole-Stack\` installed the backend runs from a Scheduled Task, and
   `Get-CimInstance Win32_Process` returns a **blank `CommandLine`** for processes in another
   session — so the usual `Where-Object CommandLine -like '*tsx*watch*'` matches nothing at all.

**Fix — rename the locked DLL aside. Do not go hunting for a process to kill.**

Windows permits **renaming** an open file even though it refuses to replace one, and the running
process keeps its handle to the renamed file. Prisma then writes a fresh DLL into the free name:

```console
$ cd <main-checkout>/backend/node_modules/.prisma/client
$ mv query_engine-windows.dll.node query_engine-windows.dll.node.locked-$(date +%s)
$ cd <worktree>/backend && npx prisma generate
✔ Generated Prisma Client
```

Nothing is stopped, nothing restarts, and the running backend is unaffected — it is still executing
the copy it loaded at start-up. Delete the `.locked-*` file the next time that process is down.

**While you are in there:** the same directory accumulates orphaned
`query_engine-windows.dll.node.tmp*` files, one per failed `generate`, at **21 MB each**. Fifteen
had built up. `rm -f query_engine-windows.dll.node.tmp*` — any still held open simply refuse and can
go later.

**And do not apply a feature branch's migration to the dev database.** Prisma records applied
migrations by name in `_prisma_migrations`, so a migration applied from a branch that never merges
leaves the dev DB claiming one the tree does not contain — and Prisma's remedy for that offers to
drop the database ([#29](#29-prisma-migrate-refuses-to-run-migration-was-modified-after-it-was-applied--and-offers-to-drop-your-database)).
The integration suite migrates its own `taskhub_test` in `globalSetup`, which proves the SQL without
touching real data.

*First hit: 2026-08-21.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 73. Cronsole says a GitHub repository does not exist, and you are looking at it

**Symptom.** On **Platforms › GitHub Actions**, *Watch a repository* refuses with a 404 for a
repository that is plainly there — you have it open in the next tab. Public repositories add
without complaint; only the private ones fail. Re-pasting the URL, the `owner/name`, and the SSH
remote all fail identically, which reads like a parsing bug in Cronsole.

**Cause.** The token cannot see the repository, and **GitHub reports that as `404`, not `403`** —
deliberately, so that an under-scoped token cannot be used to enumerate an account's private
repositories by watching which names come back forbidden. It is a good decision by GitHub and a
terrible symptom to debug: the one status code covers *"this does not exist"* and *"this exists and
you may not look at it"*, and only the first of those is what a 404 means anywhere else.

The tell is the split: **public works, private does not.** A wrong name fails for both.

**Fix.** Regenerate the personal access token with read access to the repository, and paste it again
on the Platforms tab:

- **Classic PAT:** the **`repo`** scope. (`public_repo` alone is enough only for public repositories,
  which is why they were working.)
- **Fine-grained PAT:** the repository selected, with **Contents: read** (Cronsole reads the workflow
  file to get its cron) and **Actions: read** (the workflow list and its run outcomes).

Cronsole verifies a token against `GET /user` when you save it, so a *rejected* token fails at that
click with a 401 — this failure mode is specifically a token that is valid and under-scoped, which
nothing can detect until a repository is actually asked for.

**The reusable rule.** When an API collapses *absent* and *forbidden* into one status, **the error
message has to name both readings, because the caller cannot.** Cronsole's 404 here says so rather
than forwarding GitHub's word, for the same reason the Claude fire endpoint's 400 says *"most often
the routine is paused"* — a status code that is honest and ambiguous still sends people to the wrong
place, and the layer that knows the platform is the layer that can say which.

*First hit: 2026-08-23.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 74. Dozens of Windows tasks go MISSING in one sync, and the agent is healthy

**Symptom.** The dashboard header offers to **Clear 89 missing**. The Windows platform reads
**HEALTHY**, the agent process is running, sync reports success, and nothing is in the error log.
Opening Task Scheduler shows the tasks are still there, running on schedule.

**The tell, before you debug anything: look at the shape of what went missing.** Group the MISSING
rows by subtree. Real attrition is *scattered* — a vendor updater here, a rotated GUID there. This
failure is *structural*: *entire* subtrees disappear at once, and they are precisely the ACL-protected
ones —

```
\Microsoft\Windows\UpdateOrchestrator      15 gone,  0 remaining
\Microsoft\Windows\DeviceDirectoryClient   12 gone,  0 remaining
\Microsoft\Windows\WindowsAI                6 gone,  0 remaining
\Microsoft\Windows\TPM                      3 gone,  0 remaining
\Microsoft\Windows\Pluton | License Manager | WaaSMedic | EnterpriseMgmt | HelloFace | …
```

A machine does not lose its whole `UpdateOrchestrator` tree. Windows hides those folders from
non-elevated readers.

**Cause.** The agent was started **unelevated** — typically by running `cronsole up` (or the exe
directly) from an ordinary shell instead of letting `\Cronsole-Stack\CronsoleAgent` start it, which
is registered `RunLevel Highest`. An unelevated agent enumerates a strictly smaller machine, the next
sync compares that against what Cronsole tracks, and `reconcileMissingTasks` does exactly its job on
a snapshot that is honest about what the agent saw and wrong about what exists.

Nothing lies at any single layer. The agent reports what it can see; `getHealth` is right that the
agent is connected and answering; the sync is right that those ids were absent from the snapshot.
**MISSING is only as trustworthy as the agent's field of view, and nothing measures that.**

**Confirm it in one command.** In an **elevated** PowerShell:

```powershell
(Get-ScheduledTask).Count
```

Compare with the same command unelevated, and with what the agent reports
(`GET /api/tasks/folders`, summing `taskCount`). A real case: **371** elevated, **285** unelevated,
**285** from the agent — 86 tasks invisible, plus 3 genuinely gone.

> **Do not reconcile against `Get-ScheduledTask` in an unelevated shell and conclude the tasks are
> gone.** That is the instrument sharing a failure mode with its subject
> ([#41](#41-a-browser-verification-freezes-for-45s--the-tab-is-hidden-and-requestanimationframe-never-fires)'s
> lesson). It agrees with the blinded agent perfectly, and the perfect agreement reads as proof.

**Fix.**

```powershell
Stop-Process -Name Cronsole.Agent -Force
Start-ScheduledTask -TaskPath '\Cronsole-Stack\' -TaskName 'CronsoleAgent'
```

Give it ~10s (the task runs `wscript.exe` → `run-hidden.vbs` → `Start-Cronsole.ps1`, so the process
appears a beat after `Start-ScheduledTask` returns — it not being there immediately is not a
failure). Then Sync. MISSING self-heals back to ACTIVE/DISABLED and **no data is lost**, because
reconciliation only ever changed a status.

**If you already clicked "Clear N missing":** nothing happened on the machine — that route makes no
platform call and only drops Cronsole's own rows. It writes no `TaskExclusion` either, so the next
sync re-imports everything as **new rows**. What does not come back is what hung off the old row id:
stars (`TaskFavorite`), collection membership, per-job secrets, `ExecutionLog` history, and any
rename or custom category. For a set of `\Microsoft\` tasks that is nothing; for your own folders it
is not.

**Two timestamp traps while diagnosing this.** Task rows carry **UTC** while Task Scheduler and
`Get-Process` report **local time** — a flip at `02:03Z` and an agent started at `18:59` local are
four minutes apart, not seven hours. And `updatedAt` on a MISSING row is the last *sync* that touched
it, not the moment it flipped; `reconcileMissingTasks` skips rows already MISSING, so a whole block
sharing one `updatedAt` does mean one event, but that event is the sync, not the disappearance.

*First hit: 2026-08-23.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 75. A GitHub repository is watched, Sync succeeds, and no workflows ever arrive

**Symptom.** You paste a valid PAT, add a repository, press **Sync**, and get *"Sync complete."*
The GitHub Actions row reads **HEALTHY**, `sync` is **verified** with a timestamp from seconds ago,
`lastSync` updates on every press — and `taskCount` stays **0**. Pressing Sync again does the same
thing. Nothing is in the error log, because nothing failed.

**The tell.** Every layer reports success and the count is zero, so read the *shape* rather than the
status: `GET /api/tools/platforms/github/connection` lists the repositories, and the connector reads
them fine. Drive the read path by hand and it returns exactly what you expect —

```
LIST OK cronsole  total 5  read 5
  .github/workflows/registry-drift.yml    {"crons":["10 13 * * *"]}
  .github/workflows/frontdoor-drift.yml   {"crons":["20 13 * * *"]}
```

**So the loss is downstream of the connector**, in the one place a sync deliberately throws work
away: the include-set.

**Cause.** `POST /tasks/sync` with `scope: 'tracked'` — what the plain **Sync** button sends —
filters the connector's output to categories that are *already tracked*, and that set was computed
one way for every platform: `TaskService.trackedCategories`, which reads the categories of **stored
rows**. That encodes how a folder becomes tracked *on Windows* — you pick it in the discovery modal,
and the rows are the only record that you did.

GitHub keeps that record somewhere else. The repositories you watch live in
`PlatformConnection.config`, and **adding one is the gesture that names the folder** — the same
gesture the Windows modal performs. Deriving the include-set from rows made that gesture unable to
adopt anything: a freshly added repository has no rows, so the include-set came back `[]`, every
workflow was filtered out, and the sync reported success over nothing.

**And there was no second gesture to reach for.** On Windows the escape hatch is
**Sync › Add tasks from this machine**, which sends `{ categories }` and adopts the folder. That
modal talks to the *agent*, so on GitHub it offers nothing — the state was unreachable from the UI
entirely, which is what separates this from [#20](#20-tasks-exist-on-the-machine-but-arent-in-taskhub).

**Fix** *(2026-08-24)*. `PlatformConnector` gained an optional `trackedCategories(config)`, and
`GitHubActionsConnector` implements it as the watched repositories. The route asks the connector
first and falls back to the row-derived set, so the platform-specific half stays inside the connector
layer where §9 requires it. It changes *which categories a refresh includes* and nothing else — in
particular it does **not** clear a `TaskExclusion`, because an individually untracked workflow must
survive a routine refresh. That distinction between a refresh and an import is the whole reason
`scope: 'tracked'` exists.

**The reusable question: when a sync filters, ask where the platform records "I asked for this."**
If the answer is "the rows we are about to filter", the first import can never happen. It is #20's
shape — a correct fence, invisible — with the fence's own gate missing.

**Why no test caught it.** The connector's suite proves what it *reads*; the route's suite proves
the include-set filters. Both were right. Nothing asserted that the connector's notion of a category
and the route's `extractCategory` describe the same thing on the same task, which is now pinned
(`GitHubActionsConnector.test.ts` › *trackedCategories*). **Found by connecting a real repository** —
the live pass the roadmap had kept open, on its first run.

**The silence was the expensive half, and it is fixed separately** *(2026-08-24)*. Even with the bug
gone, the *correct* empty result is unreadable: a repository whose workflows all run on `push`
imports nothing and is working perfectly, which is the same empty screen. `SyncOutcome` now carries
**`notes`** — *"read 9 workflows across 3 repositories, 3 scheduled"* — so "found nothing" and
"looked at nothing" stop rendering the same. If you hit this symptom again, **read that line first**:
it distinguishes the two in one sentence, and it is the reason this entry should not need a second
edition.

*First hit: 2026-08-24.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 76. Save is blocked on a script task, over a command field that does not exist

**Symptom.** Open a Cronsole-native **script** task, change the body, and Save is inert with

> ⚠ What it runs: A command is required.

There is no command field on the form. The same happens on a **check** task, for any edit to the
probe. An HTTP job on the same screen saves normally. A second face of the same bug: type something
unparseable into the new **Environment** field of a script job and the refusal reads *"Headers must
be JSON, or one `Name: value` per line"* — a script job has no headers.

**Cause.** `EditTaskModal` carried its own copy of "is this job complete", written when there were
two job types:

```ts
problem: nativeJob.jobType === 'HTTP'
  ? (nativeJob.url.trim() ? undefined : 'A URL is required.')
  : (nativeJob.command.trim() ? undefined : 'A command is required.')
```

`SCRIPT` and `CHECK` landed later (ADR 0002) and fell into the `else`. `nativeJobEdit` prefills
`command` from `job.executable`, which those types do not have, so `command` is `''` and the branch
is always taken. It only bites once the section is *dirty* — `blocked` looks at dirty plans only —
which is why the task opens fine and fails at the last step.

The shared definition existed the whole time. `nativeJobIncomplete` in `utils/taskEditing.ts` knows
all four types, and its doc comment already claimed to be *"shared by the create and edit forms so a
job cannot be submittable in one and refused in the other"*. Only the create form called it.

The headers sentence is the same shape one layer down: `nativeJobPayload` returns `null` with no
reason, so the caller supplied one — and a caller that guesses which field failed is right only
until a second field can fail.

**Fix (2026-08-24).** The edit modal calls `nativeJobIncomplete`. The reason a payload could not be
built has one definition, `nativeJobUnreadable`, which names the field — headers on HTTP,
environment on EXEC and SCRIPT — and `nativeJobPayload` gates on it, so `null` and the sentence
explaining it cannot disagree. `nativeJobIncomplete` calls it first, which also closed the create
form's half: unreadable headers there posted a literal `job: null`.

**The tell, if you meet this shape again:** a refusal that names a field the visible form does not
have. That is not a validation bug, it is two definitions of one judgement, and the older one is
answering.

*First hit: 2026-08-24.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 77. The Sources tab says a verb failed, and names your own broken file

**Symptom.** **Sources › Connected › Cronsole-native** shows a red banner:

> ⚠ 1 verb failed more recently than it succeeded
> **Run now:** `D:/nope/missing.tar` does not exist (checked on the machine the backend runs on)

The platform is `HEALTHY`, every task runs fine, and the path it names is one **you** aimed a
*File freshness* check at. Nothing clears it — not a refresh, not waiting.

**Cause.** A `CHECK` that correctly finds a problem was being recorded as a failure of the
**platform's** `run` capability.

`PlatformConnector.runTask` returns `success` and `ran` precisely because they answer different
questions, and its own doc comment has the table:

| `success` | `ran` | meaning |
|---|---|---|
| `true` | `false` | the platform accepted the start (Windows, Claude) |
| `true` | `true` | the job executed here and passed (native) |
| `false` | `true` | the job executed here and **failed** (native) |
| `false` | `false` | it could not be started at all |

Only the last row is the verb failing. Row three is a check *working* — reporting a fact about your
system, which is the entire reason the job type exists.

`POST /api/tasks/:id/run` got this right in its response (a 200 carrying a failing verdict, which is
what [#59](#59-a-check-that-correctly-finds-a-problem-is-reported-as-could-not-run-the-check)
fixed) and wrong four lines earlier:

```ts
// The matrix cell says "Cronsole can trigger a run on this platform" …
await recordCapability(userId, task.platform, 'run', result.success, result.message);
//                                                   ^^^^^^^^^^^^^^ asks the other question
```

The comment directly above states the correct rule. **A comment is not a constraint.**

Two things made it stick. Capability failures have **no aging** — unlike health failure evidence,
which expires after 15 minutes, a cell stays failed until that verb next *succeeds*. And every
subsequent run of the same still-broken check re-failed it, so the banner was self-sustaining.

**Fix (2026-08-24).** `runVerbSucceeded(result)` — one exported definition of "did the run verb
work", used by the route and pinned by tests over all four rows of that table. `success ||
ran === true`; only "could not be started at all" fails the cell. The reason is now attached only
when the verb genuinely failed, so a successful record cannot carry a check's bad news.

**To clear an existing banner:** restart the backend — it is one of the things that runs stale, so
`/doctor` first — then run any Cronsole-native task once. A success writes `lastSuccessAt` and
explicitly nulls `lastFailureAt` and the reason, so even re-running the *same* broken check clears
it once the fix is loaded.

**The reusable tell:** a capability failure whose reason names something on *your* disk is not a
capability failure. The matrix says what Cronsole *can do*; if the sentence is about your system
rather than about Cronsole, the wrong predicate reached the recorder.

*First hit: 2026-08-24.*

<p align="right">(<a href="#troubleshooting-top">back to top</a>)</p>

---

## 78. The light theme is hard to read, and every value looks defensible

**Symptom.** Light mode "clashes". Panels sit flat on the page instead of reading as panels, the
small uppercase field labels wash out, amber and blue status dots are hard to find on white. Open
`index.css` and every single value looks reasonable — which is why this sat for twelve days after a
pass that was specifically about theme colour.

**Cause — the general one.** **Colour is the one part of the app that breaks silently.** A role
below the WCAG bar renders perfectly, ships, and is only caught by someone squinting. There is no
error, no failing test, no console warning. So it cannot be reviewed; it has to be *measured*.

The 2026-08-12 pass tokenised every role precisely because light mode was broken, and then checked
the new values **against white**. That is the wrong reference:

- `muted` is the darkest fill in light mode, so it — not `background` — is the binding constraint.
  Two roles cleared the page and failed the fill they are most often read on.
- A **status dot** has no text beside it. It is non-text UI at 3:1, and `--warning` (2.14:1) and
  `--info` (2.85:1) were invisible on white while their `-text` twins were fine.

Measuring every role against every surface found **26 pairs below the bar, in both themes** —
including `subtle-foreground` (the 10px label above every form field, 338 sites) failing on *every*
surface in dark as well as light, and white-on-green **Run now** at 2.59:1.

**Cause — the structural one.** The light ramp was inverted:

```
light   background 100%  ->  surface 95%  ->  raised 98%
                  1.00          1.12            1.04   <- raised is FLATTER than surface
dark    background   4%  ->  surface  7%  ->  raised 11%
                  1.00          1.05            1.16   <- correctly ordered
```

`raised` is meant to sit *above* `surface`. At 1.04:1 it was very nearly the page itself. The
comment defending it argued that on a white page a lifted panel should be lighter, "lifted rather
than sunken" — which is a real concern and the wrong trade. **White is a ceiling.** On a light page
every step away from the background is darker, so "lifted" cannot be expressed as "lighter", and a
step you cannot see is worse than one that reads as inset.

**Fix (2026-08-24).** Light is now the **mirror** of dark — the same separations, opposite
direction: 1.07 / 1.14 / 1.25 against 1.05 / 1.16 / 1.27. Roles were corrected by solving for the
minimum change that clears the bar on the *worst* surface, so hue and saturation were never touched.
`muted-foreground` moved with `subtle-foreground` in light, because the value that clears AA was the
one `muted-foreground` already had and the two would have collapsed into a single weight.

`frontend/src/__tests__/themeContrast.test.ts` now parses `index.css` and measures every pair (65
assertions). It also pins `:root === .dark`, because a drift there flashes the wrong palette before
hydration on every cold load and — again — nothing fails.

**One gap is pinned rather than closed.** `--border` is 1.61:1 light / 1.69:1 dark against a 3:1
bar. It is one token doing two jobs: separating cards (decorative, exempt from WCAG 1.4.11) and
drawing the boundary of a text input (in scope). 3:1 needs `L=58%` / `L=37%`, which would make every
hairline in the app a heavy rule at all 313 call sites. That needs a second token and a sweep of the
*controls*, which is on the roadmap; the test asserts the current floor **and** fails if someone
closes the gap by value alone.

**The reusable rule:** when a colour looks wrong, measure before you open a picker — and measure
against every surface the role can land on, not against the page. A role that passes on the
background and fails on `muted` looks exactly like a role that is fine.

*First hit: 2026-08-24.*

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
