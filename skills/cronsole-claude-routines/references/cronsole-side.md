# Tracking Claude routines in Cronsole

> What the `CLAUDE_CODE` source can and cannot do, why the answer changes between installs, and what
> each reading on screen actually means.

---

## 1. Two doors, and the install decides which you have

`ClaudeConnector` is the only **dual-mode** connector in Cronsole. `services/claudeOAuth.ts` chooses
per call.

| | **OAuth mode** | **Declared mode** |
|:---|:---|:---|
| Condition | a Claude Code session is readable on the **backend's host** | no session |
| API | the undocumented `/v1/code/triggers` family | the documented `POST /v1/claude_code/routines/{id}/fire` with a per-routine token |
| `syncTasks` | a **real sync** — name, 5-field UTC cron, enabled, platform-supplied `next_run_at` | returns **the routines you declared in config**. Not a sync, and documented as not being one |
| `create` · `setStatus` · `updateSchedule` | ✅ | ❌ `unsupportedVerbs` |
| `run` | ✅ token-free | ✅ the per-routine fire token |
| `delete` | ❌ | ❌ |

Three consequences worth holding on to:

- **`unsupportedVerbs` is a getter, not a constant** — the answer is a property of the install. Any
  test asserting Claude's capabilities **must mock the credential**, and a capability matrix read on
  one machine does not describe another.
- **Neither mode can delete.** No `DELETE` exists on either family; this was verified by enumeration,
  not assumed. It is a boundary, not a missing feature.
- **The declared path is kept deliberately** as the fallback, precisely because door 2 is
  undocumented and beta-gated. Do not "simplify" it away.

**Why Claude keeps a connector at all** when ChatGPT and Jules are quick links: firing a routine is
something Cronsole can actually *do*. That single capability is the whole justification — and it
comes with a hazard, below.

---

## 2. The health hazard

**Claude's only endpoint *fires the routine*.** So "check whether this connection works" and "run the
user's job" are the same request.

> **Health reports evidence, never preconditions, and never has a side effect.**

Which means: never probe the Claude source to test it. Connection evidence there has to come from the
credential being readable, not from a call. If you find yourself writing a health check that calls
Claude, you are writing a routine trigger.

---

## 3. Connecting, and what disconnecting costs

```
list_claude_routines          # what Cronsole can see
connect_claude_routine        # declare one (declared mode) / adopt one
disconnect_claude_routine     # removes the declaration -- and its tracked tasks
edit_claude_routine
create_claude_routine         # OAuth mode only
```

> [!WARNING]
> **Disconnecting a Claude routine removes its tracked tasks along with the declaration.** That is by
> design — for a **declared** routine, as for `TASKHUB_NATIVE`, **the row *is* the task** as far as
> Cronsole is concerned, so there is nothing left to keep. It is also why **`untrack_task` 400s on a
> declared routine**: the declaration stays in the connection and the next sync would bring the row
> back. A routine **discovered in OAuth mode** has no declaration, so `untrack_task` works on it like
> on any other platform — that is the way to clear a `MISSING` row whose routine was deleted at
> claude.ai (`disconnect_claude_routine` 404s there, nothing being declared).
>
> The routine itself keeps running in the cloud. What you lose is Cronsole's record of it, and in
> declared mode that record *is* the configuration — you will have to re-declare it.

**The tracked set is declared and constant** (`['Claude']`), for the same reason Gemini's is: the API
key or session is scoped to one account and sees a flat list. There is nothing to name, so
`extractCategory` returns a constant rather than inventing a folder structure.

---

## 4. Reading the dashboard

| Reading | Means | Do |
|:---|:---|:---|
| **No Claude Code scheduled tasks at all** | Almost always the source is not connected, or you are in declared mode with nothing declared. | `list_platforms`, then `connect_claude_routine`. Cronsole's troubleshooting log covers this case under *"can't list, pause or create Claude Code routines"*. |
| **Cannot pause / create / reschedule** | You are in **declared mode**. These are genuinely `unsupportedVerbs` there, not a bug. | Use the dashboard, or make a Claude Code session readable on the backend's host. |
| **`declared` in the capability matrix** | The route would accept the verb; **nothing has been observed to work here**. `declared` is not `yes`. | Drive it once. `verified` is evidence, `declared` is a promise. |
| **Health `UNKNOWN`** | The absence of a verdict. It ranks **above** healthy in any summary and is not a defect. | Nothing. Do not probe — see §2. |
| **Schedule shown but `null` on one routine** | A schedule Cronsole could not read, reported as `null` **with a reason**, never guessed. | Read the reason. |
| **A task Cronsole says is `MISSING`** | Tracked here, absent from the platform on the last sync. | In declared mode this can just mean the declaration outlived the routine. |

Everything on screen comes from **`connector.getHealth` when asked** — a surface never reads back
`PlatformConnection.healthState`, which only the dashboard's poll writes. If two Cronsole surfaces
disagree about Claude in the same second, that is the bug shape to look for.

---

## 5. Export and history

- **`export_task` works on a Claude routine**, and it is one of the few things that does. The
  template export is built from the **DB row** (`metadata.prompt`, since a routine's command *is* its
  prompt), so it works with the agent offline and on a platform Cronsole cannot otherwise reach.
- **`ExecutionLog` records runs Cronsole *performed*, not runs that *happened*.** A routine firing on
  its own cloud schedule writes nothing here. An empty history means "Cronsole has nothing", never
  "it never ran".
- A `SUCCESS` from a manual `run_task` means **the fire request was accepted**. It is not a claim
  about the routine's outcome.

---

## 6. The `/doctor` list, for when nothing works

Before debugging the connector, rule out the parts of a Cronsole install that **run stale without
turning anything red** — a containerized backend still on old code, a published agent binary, a built
`dist/`, and above all **an unapplied database migration**, which makes a whole feature return a bare
*"Internal server error"* on every route including reads while the schema file, the generated client
and the entire test suite hold the new value.

Cronsole ships a **`/doctor`** command that checks these, and it is **read-only by default** (`--fix` is an opt-in that applies only safe fixes): three of
four agent-health incidents there were the *readout* lying, so a "reconnect" button would have
reconnected a working connector forever and looked like it worked. **A diagnostic reports; it does
not repair.**
