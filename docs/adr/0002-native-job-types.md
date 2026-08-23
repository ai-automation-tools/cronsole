# ADR 0002 — Widening the Cronsole-native job-type set

- **Status:** **Accepted and implemented (2026-08-15)** — `SCRIPT` and `CHECK` shipped the same day.
  `NOTIFY` and `SEQUENCE` remain deferred as written below; `SQL` remains rejected.
  Open questions 1 and 3 were settled before implementation — see *Decisions taken* at the end.
- **Deciders:** Mike
- **Related:** [ROADMAP › Native job types](../ROADMAP.md#native-job-types) · [CLAUDE.md §9 › Connector pattern](../../CLAUDE.md) · frozen spec [`archive/specs/Native_Tasks.md`](../archive/specs/Native_Tasks.md) (local-only)

## Context

Cronsole-native has exactly two job types, `HTTP` and `EXEC` (`backend/src/services/NativeTaskExecutor.ts`).
They are the whole answer to *"what can Cronsole do without an agent installed?"*, and that answer is
currently **"call a URL"** and **"run a program that is already on the backend host."**

Native is the only source Cronsole fully owns. It needs no agent, no OAuth, no vendor, and — unlike a
Windows run, whose `SUCCESS` only means the agent accepted a start — it produces a **real verdict**:
the process ran in this process tree and its exit code is the outcome. Every downstream feature
already built (failure notifications, health tiers, run history, the duration trend that *only* reads
native rows) is sharpest here. Widening the job-type set is therefore the cheapest way to make the
rest of the product pay off.

### What is already true, and easy to get wrong

**There is no inline-script job type today, despite appearances.** The rail's level-2 row for
`TASKHUB_NATIVE:EXEC` is labelled **"Scripts"** (`frontend/src/platform.ts`), and the MCP tool is
named `create_native_script_task` — but both are `EXEC`, whose input is a command line pointing at a
file that must already exist on the machine the backend runs on
(`powershell -NoProfile -File "D:\scripts\backup.ps1"`). The script body lives on disk, outside
Cronsole, and Cronsole never sees it. **The name promises more than the type delivers**, which is a
constraint on this ADR rather than a footnote: a new `SCRIPT` type landing beside a row already
called *Scripts* is a collision that has to be resolved deliberately (see *Open questions*).

### The four constraints that shape the answer

1. **Every job type is a permanent rail row for every user.** `STRUCTURAL_SUBTYPES`
   (`frontend/src/utils/sourceTree.ts`) lists native's subtypes *whether or not any task uses one* —
   correctly, because the rail is navigation and an empty destination still needs a route. The
   consequence is that **type count is navigation cost**: ten job types is ten rows under *Cronsole*
   for a user who has two tasks. This is the single most important design pressure here, and it is
   not mentioned in the roadmap item.
2. **Five places, and missing one ships a job accepted at create time that fails at 3am.**
   `buildNativeJob` + `validateJob` (`services/nativeJob.ts` — one definition shared by create, edit
   and the connector), `NativeTaskExecutor`, `taskSourceKey` (`services/taskSource.ts` — the server
   derives the subtype, the browser must not), `STRUCTURAL_SUBTYPES` + labels + an icon, and **at
   least one template per type**, since a source with nothing in the catalog is a source the product
   does not really have.
3. **A native job runs where the *backend* runs**, which is inside the container on a Dockerized
   stack. `services/runtimeContext.ts` exists to say so. Any new type must be honest about this, and
   a type whose value *evaporates* in a container (one that needs the user's filesystem, their
   installed tools, or a local stdio process) is worth less than it looks.
4. **The security rules carry over unchanged and are non-negotiable.** `childEnv()`, never
   `process.env` — this process holds `DATABASE_URL`, `JWT_SECRET` and the AES key encrypting every
   `PlatformConnection.config`, so a scheduled job inheriting the environment would read out the key
   protecting every stored credential through the same UI that created the task. And **no implicit
   shell**: a shell is opted into by name, never wrapped around everything.

### The test this ADR applies: type, or field?

Because of constraint 1, the recurring question is not *"is this useful?"* but:

> **Is this a different kind of thing you navigate to, or a different configuration of one?**

A different *kind* earns a `jobType` and a rail row. A different *configuration* earns fields on an
existing type. Getting this backwards inflates the rail with distinctions no user navigates by —
the same failure the source/platform split was careful to avoid, where native HTTP and native scripts
stayed **one platform** in the capability matrix precisely because they have identical capabilities.

## Decision (proposed)

**Ship two new job types, `SCRIPT` and `CHECK`, in that order. Defer `NOTIFY` and `SEQUENCE`.
Reject `SQL`, SSH, Docker, MCP-call and free-standing file-prune for now, each for a stated reason.**

### 1. `SCRIPT` — an inline body run under an allowlisted interpreter

The job stores the **script text itself**; Cronsole writes it to a temp file and runs a named
interpreter against it.

```
{ jobType: 'SCRIPT', interpreter: 'powershell' | 'pwsh' | 'bash' | 'sh' | 'python',
  body: string, workingDirectory?: string, env?: Record<string,string>, timeoutMs?: number }
```

**Why this and not "EXEC is enough".** `EXEC` requires the file to already exist on the backend host.
On the Dockerized stack that is a filesystem the user cannot see — the exact confusion
`runtimeContext` was built to prevent, arriving as *"executable not found"* for a file visible in
Explorer. An inline body lives in the **database**, so the task is portable, editable in the app,
reviewable in the task modal, exportable as a template that works on a fresh install, and carried by
`DeletedTaskArchive` when deleted. Today the most important half of an `EXEC` task — what it actually
does — is the half Cronsole cannot see, back up, or show you.

**Why this is not a violation of the no-shell rule.** It is a shell, deliberately, and that is legal
because the rule bans an *implicit* one: `EXEC` must not silently wrap a command string in `cmd /c`,
because then a value can become a second process. Here the user **names the interpreter and writes
the body**, so there is nothing implicit and nothing re-parsed. The guarantee that replaces it is the
**allowlist**: `interpreter` is a fixed enum, not a free-form `executable`, and Cronsole owns the
argv (`-NoProfile -ExecutionPolicy Bypass -File <temp>`, `bash <temp>`, …). Without the allowlist
this type quietly becomes `EXEC` with an extra step and loses its own guarantee.

**What the implementation has to get right**, none of it optional:
- The temp file needs the **right extension** or the interpreter refuses (`.ps1`, `.sh`, `.py`), mode
  `0600`, a Cronsole-owned directory, and deletion in a `finally` — including on the timeout-kill
  path, which is the one that leaks.
- **PowerShell needs `-NoProfile`**, or the user's profile runs first and the job's behavior depends
  on a file nobody thought was part of the task.
- The body is untrusted content stored in the DB and rendered in the UI; it is executable text, so it
  is treated exactly like a fetched template — never rendered as HTML, never interpolated.
- Interpreter availability is a property of the **host**, so a missing one must fail with the
  runtime-context sentence, not a bare ENOENT.

### 2. `CHECK` — one type, several probes

A monitor: measure something, compare it to a threshold, succeed or fail.

```
{ jobType: 'CHECK', probe:
    | { kind: 'http', url, expectStatus?: [min,max], expectBodyContains?, expectJsonPath? }
    | { kind: 'tcp', host, port }
    | { kind: 'fileFresh', path, maxAgeMinutes }
    | { kind: 'diskFree', path, minFreeBytes } }
```

**Why this is the highest value per unit of new surface.** It is the only job type whose **failure
means something**. An `EXEC` failure is a bug in your script; a `CHECK` failure is a fact about your
system — and Cronsole already owns the entire downstream. Failure notifications, health tiers, the
*Failures* view, run history and analytics were all built for this and are currently pointed at job
types whose failures are mostly self-inflicted. `CHECK` converts existing, tested machinery into a
product feature.

**Why one type and not four.** All four probes are the same *kind* of thing to navigate to — "the
checks I'm running" — and splitting them would spend four permanent rail rows on a distinction nobody
browses by. This is constraint 1 applied honestly in the direction it usually cuts against a
proposal, and here it cuts in favor of one.

**Cost is genuinely low:** no new dependencies (`axios` is present; `node:net` and `node:fs` are
built in). The `http` probe is `executeHttp` plus assertions — worth noting it also fixes a real gap
in the existing `HTTP` type, whose success is *only* the status code, so a 200 serving an error page
reads as healthy.

**The honesty rule it must not break:** a `fileFresh` or `diskFree` probe measures **the backend's**
filesystem. In a container that is not the user's disk, and a check reporting healthy about the wrong
filesystem is worse than no check — this is the [#42](../troubleshooting/README.md) shape (a real
measurement of the wrong thing). The create UI must name the execution host on these probes
specifically, not just in general.

### 3. `NOTIFY` — deferred, though it is the cheapest to build

A scheduled message to Discord / ntfy / Slack / a generic webhook. `FailureNotificationService`
already shapes all three payloads, tested — so the delivery half is written.

**Why deferred rather than shipped:** it is arguably a *configuration* of `HTTP`, so it fails the
type-or-field test on its face. The counter-argument is real (the value is not having to know
Discord's JSON shape — the same argument that made `create_native_script_task` a distinct MCP tool
from `create_native_task`), but it is a **UI** argument, and a UI argument is satisfied by a
create-modal preset that writes an `HTTP` job. That gets the whole benefit for zero rail rows.
Revisit as a type only if per-destination behavior (retries, rate limits, message threading) turns
out to differ enough that one `HTTP` job cannot express it.

**If it does ship:** the webhook URL is a credential — a Discord webhook URL *is* the authentication —
so it must be write-only and encrypted, following the Claude-token doctrine, and native jobs have no
encrypted-field story today. That is the actual cost, not the delivery code.

### 4. `SEQUENCE` — deferred, and last if it happens

Ordered steps, stop-on-failure, per-step verdict.

**Why last:** it is the only candidate that changes the *model* rather than adding to it. `metadata.job`
stops being flat, so `buildNativeJob` and `validateJob` become recursive (and the recursion must
refuse to nest a `SEQUENCE`, or a job can contain itself), the executor recurses, `log` becomes
per-step, `durationMs` becomes a sum that no longer means what the duration-trend analytic assumes,
and the edit UI becomes a list editor rather than a form. **And its marginal value over `SCRIPT` is
observability, not capability** — anyone willing to write four lines of bash already has the
capability once `SCRIPT` exists. Build it only if per-step verdicts are the actual goal, and knowing
it costs more than the two recommended types combined.

### 5. `SQL` — rejected for now

Run a query against a configured database on a schedule.

**Why not:** it is the only candidate that costs **two** new subsystems at once. There is no database
driver in `backend/package.json` (Prisma bundles its own engine and cannot be borrowed for arbitrary
connections), and a connection string is a `PlatformConnection`-grade secret that native jobs have no
place to store encrypted. Shipping Postgres-only would be honest but narrow, and each additional
engine is another dependency. It is also the type most likely to be a foot-gun running unattended —
a scheduled `DELETE` with no confirmation gesture anywhere in its life. Revisit after the per-job
secret story exists (which `NOTIFY` would also need — they should be sequenced together).

### 6. Rejected outright, with reasons

- **SSH remote command.** Turns a local-first product into a remote-execution platform, contradicting
  §3, and adds key management, host-key trust and a blast radius that reaches machines Cronsole has
  never seen. The agent is the answer to "run something somewhere else."
- **Docker container run.** Requires the Docker socket, which is root-equivalent on the host. Handing
  that to a process that also holds `JWT_SECRET` is not a trade worth making for a scheduler.
- **Free-standing file prune / cleanup.** A scheduled `rm -rf` driven from the backend process, with
  no fenced root, is a machine-wide destructive primitive reachable from a web form. The *safe* half
  of the idea — "has this file gone stale?" — is already `CHECK`'s `fileFresh` probe. If the delete
  half is ever wanted it needs a configured, non-overridable root first.
- **MCP tool call.** The most on-brand candidate and still a no: stdio MCP servers do not exist inside
  the container, most need per-server API keys (the missing secret story again), and it overlaps the
  Claude connector, which already covers "have an agent do something on a schedule" with a real
  vendor behind it. Park it; revisit if the secret story and a host-run default both land.

## Consequences

**Positive**
- Native stops being *"call a URL or run a file you already have"*. `SCRIPT` makes the source usable
  by someone with no agent and nothing on disk; `CHECK` makes it useful for the thing schedulers are
  most often actually used for.
- The whole existing observability stack — notifications, health tiers, *Failures*, analytics — gets
  a job type whose failures are worth being notified about.
- Native becomes a genuinely better template target. Today the catalog can only offer native an HTTP
  call or a command line assuming a path on someone else's machine; a `SCRIPT` template carries its
  own body and works on a fresh install, which is what "a source with nothing in the catalog is a
  source the product does not really have" was pointing at.
- Two new rail rows, not five. The rail stays readable.

**Costs / risks**
- **Two more permanent rows** under *Cronsole* for every user, including those who use none of it.
  Accepted deliberately: they are navigation, and the empty-destination rule already covers a `0`.
- `SCRIPT` stores executable text in the database. It was always executable text (the command line
  named a script); it is now *visible*, which is a net gain for review and a new surface for
  rendering mistakes. Treated as untrusted content everywhere it is displayed.
- Temp-file lifecycle is a leak risk on the timeout-kill path specifically, and that path is the one
  least likely to be exercised by a test that passes quickly.
- `CHECK`'s filesystem probes measure the backend's filesystem, which is a correctness trap on the
  Dockerized stack rather than a bug — mitigated by naming the host at create time, not after.

## Open questions (must be settled before implementation)

1. **The "Scripts" name collision.** `TASKHUB_NATIVE:EXEC` is already labelled *Scripts* and
   `create_native_script_task` already exists. Three options: rename the `EXEC` row to **"Programs"**
   and give `SCRIPT` the *Scripts* label (clearest, but changes a label users have seen and an MCP
   tool's meaning); call the new type **"Inline scripts"** (safe, wordier, and leaves the misleading
   label standing); or fold `SCRIPT` into `EXEC` as a mode. **Recommendation: rename `EXEC` to
   Programs** — it is what the type has always actually been, the label is presentation-only
   (`platform.ts`), and no stored `jobType`, source key or saved link changes. The MCP tool name is
   the one real cost and is worth a description fix rather than a rename.
2. **Which interpreters ship in the allowlist**, and what happens on a host missing one. Detecting at
   create time is friendlier but is a precondition-based verdict — the shape §9 warns about — so the
   honest version probably validates the *name* at create and reports availability from the first run.
3. **Does `CHECK` reuse `HTTP`'s executor or replace it?** If `CHECK`'s `http` probe is strictly
   better than the `HTTP` job type, `HTTP` becomes the one type whose success criterion is weakest.
   Worth deciding whether assertions belong on `HTTP` itself instead, which would make `CHECK`'s
   remaining probes a smaller, non-HTTP type.
4. **Per-job encrypted fields.** Both `NOTIFY` and `SQL` are blocked on it, and `SCRIPT`'s `env` is
   already a plausible home for a secret today with no encryption behind it. This may deserve its
   own ADR before either deferred type is revisited.

## Decisions taken (2026-08-15, at implementation)

**Q1 — the "Scripts" name collision: renamed `EXEC` to *Programs*.** As recommended. The label is
presentation-only (`platform.ts`), so no stored `jobType`, source key, saved view or link changed.

**And the MCP tool was renamed too — reversing this ADR's own recommendation.** The text above
argued the tool name was "worth a description fix rather than a rename". That was wrong on the
§11a test it should have been measured against: leaving the wrapper calling something a *script*
while the app calls it a *program* is precisely the wrapper-describing-an-API-it-no-longer-matches
drift the rename existed to remove. So `create_native_script_task` → **`create_native_program_task`**,
and the old name now belongs to the tool that actually carries a body. A stale caller fails loudly
on a schema mismatch rather than quietly creating the wrong kind of task, and Cronsole has no
external MCP callers yet (the go-public checklist is open), so the cost is a description fix in four
mirror surfaces.

**Q3 — `CHECK` gets its own `http` probe; `HTTP` keeps status-code-only success.** The split is
**intent, not capability**: an `HTTP` job *does* something (fires a webhook, pokes a deploy hook),
and "the endpoint accepted it" genuinely is the right verdict for that; a `CHECK` *verifies*, so a
200 serving an error page must be able to fail. Folding assertions onto `HTTP` instead would have
put "is my site up?" in a row called *HTTP jobs* alongside "post to my webhook", which is the
least-informative-bucket problem the source split existed to fix.

**Q2 — six interpreters ship**, and availability is reported from the first run rather than probed
at create time, exactly as the question anticipated. `node` is the safe default and is documented as
such everywhere it is offered, because the backend runs on Node so it is present wherever the
backend is.

**Q4 — per-job encrypted fields still does not exist**, and both deferred types remain blocked on
it. Unchanged by this work.

> **Resolved 2026-08-21 by [ADR 0003](0003-per-job-secrets.md).** It answers Q4's "may deserve its
> own ADR" with yes, and lands the opposite of the shape this ADR's phrasing implied: not encrypted
> *fields*, but a separate encrypted resource the job **refers to** by name. `NOTIFY` and `SQL` are
> unblocked; ADR 0003 restates this ADR's request that they be re-evaluated **together** rather than
> picked off separately, and schedules neither.

### One thing found during implementation, and fixed with it

Publishing a new registry `action.kind` would have **blanked the entire hosted catalog for every
older install**: `RegistryCatalogSource.fetchAll` threw on the first template it could not parse and
the catch falls back to the whole bundled snapshot. The schema extension in this ADR was the trigger
that would have caused it. Fixed by skipping unreadable templates individually while still throwing
on a checksum mismatch — the version-gap/integrity distinction is the point. See
[troubleshooting #58](../troubleshooting/README.md#58-one-unreadable-template-silently-empties-the-whole-hosted-catalog).

## Follow-ups

1. ~~Settle open questions 1 and 3~~ — done, above.
2. ~~`SCRIPT` through all five places~~ — done, with the temp-file lifecycle pinned on the **timeout**
   path specifically, plus a script starter (core) and a PowerShell example.
3. ~~`CHECK` through all five places~~ — done, with the execution-host sentence on the filesystem
   probes only, and four templates (two core).
4. ~~Update the mirror surfaces in the same change~~ — done: `mcp-server/` tools + both tool tables,
   the `cronsole` skill, the connect pack, `help.ts`, the Sources Guide, `CLAUDE.md` §8/§9,
   `CHANGELOG.md`, `ROADMAP.md`, troubleshooting #58.
5. **Still to do:** publish the registry (`pwsh scripts/publish-registry.ps1`) — the bundled catalog
   and `registry/` are rebuilt and committed, but installs fetch the *hosted* copy, so the six new
   templates do not exist for anyone until that runs (§11b).
