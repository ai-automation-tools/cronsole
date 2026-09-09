# ADR 0003 — Per-job secrets for Cronsole-native tasks

- **Status:** **Accepted and implemented (2026-08-21).**
- **Deciders:** Mike
- **Related:** [ADR 0002 › open question 4](0002-native-job-types.md) · [ROADMAP › Next up](../ROADMAP.md#native-job-types) ·
  [CLAUDE.md §9 › Connectors, Security](../../CLAUDE.md) · [UI User Guide › Secrets](../user-guides/guides/UI_User_Guide.md#secrets)

## Context

[ADR 0002](0002-native-job-types.md) shipped `SCRIPT` and `CHECK` and left `NOTIFY` and `SQL`
deferred **behind the same missing thing**, named in its open question 4:

> **Per-job encrypted fields.** Both `NOTIFY` and `SQL` are blocked on it, and `SCRIPT`'s `env` is
> already a plausible home for a secret today with no encryption behind it.

That last clause is the part that makes this a *current* defect rather than a future blocker. Today
a Cronsole-native job stores every one of its fields as plaintext JSON in `Task.metadata`:

- `SCRIPT.env` / `EXEC.env` — the one place ADR 0002's own `childEnv()` note tells you to put a
  secret ("A job that needs a secret passes it in `env` deliberately").
- `HTTP.headers` — an `Authorization: Bearer …` line.
- `HTTP.url` — a Discord/Slack/ntfy webhook URL *is* its own authentication.
- `CHECK`'s `http` probe headers — a status endpoint behind a token.

`Task.metadata` is not a quiet place. It is returned whole by `GET /api/tasks`, by every MCP read
tool, by `GET /api/tasks/:id/export`, and it is copied verbatim into `DeletedTaskArchive.bundle`,
which by design **outlives the row**. So a token pasted into a job's `env` is currently in the
browser's memory, in an MCP host's transcript, in a downloaded `.json` in someone's Downloads
folder, and in an archive row that survives the delete that was supposed to get rid of it.

Meanwhile `PlatformConnection.config` has been AES-256-GCM encrypted at the application layer since
the first P0 pass, and the key that does it lives in this very process — which is the whole reason
`childEnv()` refuses to hand `process.env` to a child. **The doctrine exists; native jobs are the
one thing not covered by it.**

### What "per-job encrypted fields" cannot mean

The roadmap phrase suggests encrypting *designated fields in place* — `headers` stays where it is
and its values become ciphertext. Three things rule that out:

1. **It guesses.** Nothing about `headers` or `env` says *which* values are secret. Encrypting all
   of them makes `Content-Type: application/json` unreadable in the UI for no gain; encrypting some
   of them requires a marker, at which point the field is no longer the field.
2. **The ciphertext still travels.** In-place encryption leaves the blob inside `metadata`, so it
   still rides into every export, every archive and every MCP read — now as an offline-crackable
   artifact keyed to one install's `ENCRYPTION_KEY`. That is worse than not shipping it, because it
   *looks* handled.
3. **It ties the secret's lifecycle to the job's.** `PATCH /:id/job` **replaces** the job rather
   than patching it (deliberately — the job types share no fields). If secrets live inside the job,
   then editing a schedule-adjacent field means retyping every secret, and *forgetting* to means
   silently destroying them.

## Decision

**A native job's secrets are a separate, encrypted, write-only resource attached to the task, and
the job refers to them by name.**

### 1. Storage — its own table, not a column

```prisma
model TaskSecret {
  taskId    String   @id
  task      Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)
  /// AES-256-GCM ciphertext of `{ [name]: value }` — `encryptConfig`, same as
  /// PlatformConnection.config.
  data      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

**A table rather than a `Task` column, and that is the security property.** Prisma returns every
scalar field of a model by default, so a `Task.secretsEncrypted` column would be included in
`prisma.task.findMany()` — which means every task list, every export, every archive and every MCP
read would carry it *unless every one of them remembered to exclude it*. A rule every call site has
to remember is one the next call site forgets. A relation is excluded unless explicitly `include`d,
so **the default read cannot leak it**.

**One row per task, cascading.** It is `TaskFavorite`'s shape, for `TaskFavorite`'s reason, and the
deliberate opposite of `TaskExclusion`: an exclusion must *outlive* the row it describes, a secret
must *not*. Deleting a task destroys its secrets, which is the only honest reading of the gesture.

### 2. Reference syntax — `${secret.NAME}`, resolved at execution and nowhere else

A job field carries `${secret.NAME}`; the stored job is plaintext and says exactly which secrets it
needs, without containing any of them. Substitution happens inside `executeJob` and the substituted
job never leaves that function.

Refs are legal in a **named, closed set of fields** — not anywhere a string appears:

| Job type | Where a `${secret.NAME}` is legal |
|---|---|
| `HTTP` | `url`, `headers` values, `body` |
| `EXEC` | `args[]` entries, `env` values |
| `SCRIPT` | `body`, `env` values |
| `CHECK` | the `http` probe's `url` and `headers` values |

**`EXEC.executable` and `SCRIPT.interpreter` are deliberately excluded.** A secret naming *which
program runs* is not a use of a secret; it is a way to make the run log unreadable and the
allowlist unverifiable. A ref in an illegal field is refused by `validateJob`, **by name**, the same
way an unrecognized `jobType` is.

### 3. Two failure modes, two layers, and they are different facts

- **A ref in a field that cannot hold one** is a property of the *spec*. `validateJob` refuses it,
  so create and edit both 400 with the field named.
- **A ref to a secret that is not set** is a property of the *task right now*. It is refused at
  **run time**, by name, with `ran: false` — nothing executed, so the route answers 502 exactly as
  it does for any other failure to start ([#59](../troubleshooting/README.md#59-a-check-that-correctly-finds-a-problem-is-reported-as-could-not-run-the-check)).

It is *not* a create-time refusal, and that is the load-bearing half. Secrets are set through their
own routes, so "the job names a secret that is not set yet" is an ordinary intermediate state — the
same shape as a `declared` capability that is not yet `verified`. Refusing the create would make an
imported task, a restored archive and an applied template impossible to express at all. What must
never happen is a *silent* version of it, so every create/edit/import response carries
`missingSecrets: string[]`, always present and empty when there is nothing to say.

### 4. Write-only, structurally

There is **no route that returns a secret value.** `GET /api/tasks/:id/secrets` returns names and
`updatedAt`. That is not a filter someone can forget to apply; it is the absence of a read path.

Setting one is `PUT /api/tasks/:id/secrets/:name`, removing one is `DELETE` — **per secret, not per
set.** A whole-set `PUT` would make "edit one secret" a request that has to resend the others, which
is the exact shape that destroys them when a client forgets. The one exception is
`POST /api/tasks/native`, which accepts an optional `secrets` map so that creating a task and giving
it its credential is **one gesture** — a create has nothing to preserve, so replace-semantics are
unambiguous there, and it routes through the same `replaceTaskSecrets` the other paths use.

### 5. Redaction is part of running a job, not a decoration

Every log line `executeJob` produces is passed through a redactor that replaces each secret's value
with the ref that carried it — `${secret.WEBHOOK}`, not `••••`, so the reader learns *which* secret
was there. It happens in `executeJob` itself, at the one point every job type funnels through, so a
fifth job type cannot ship having forgotten it — the same argument that put the `ran` stamp there.

`ExecutionLog.log` is therefore written redacted, which means the run history, the *Failures* view
and `FailureNotificationService`'s outbound webhook all inherit it without knowing about it.

**A minimum secret length of 4 characters is enforced, and refused by name.** Redaction is a
substring replace: a one-character secret would redact that character out of every word in the
output. The refusal states that reason, because "your secret is too short" without it is a rule that
looks arbitrary and gets worked around.

**What redaction does not promise.** It removes *known values* from output Cronsole captured. A
script that base64-encodes its token before printing it defeats it, and nothing here claims
otherwise. It is the same class of guarantee as `childEnv()`: it closes the accident, not the
determined leak.

### 6. Portability: a task with secrets is not templatable, and says so

`buildTemplateFromTask` **refuses** a job carrying secret refs, by name. A template is
target-agnostic content meant to be shared; the two things it could do here are both wrong — carry
the value (a leak, into the catalog) or carry the ref (a template that applies cleanly and produces
a task that cannot run, which is the "declared-but-uncompiled target" failure ADR 0002 already
rejected).

The **native** export is unaffected and needs no format change: the bundle already contains the job,
and the job already names its secrets in plain text. Adding a `requiredSecrets` field to the bundle
would be a second derivation of a fact the file already states — and the trap of a format field
nothing reads is one this repo has already paid for
([#65](../troubleshooting/README.md#65-an-exported-task-file-has-nowhere-to-go--and-restore-refuses-it)).
Import derives the list from the job and reports it as `missingSecrets`.

### 7. MCP sets no secrets, and that is a decision, not an omission

`mcp-server/` gains exactly one tool — **`list_task_secrets`**, which returns names and never
values. No tool accepts a secret value.

**Because a secret typed into a tool call is a secret typed into a chat transcript.** It goes
through the model's context, into the host's history file, and on a hosted model out to a vendor —
three places the encryption at rest exists specifically to keep it out of. This is the same
reasoning that omits the bulk verbs from MCP: friction scales with blast radius, and MCP has no
gesture that corresponds to "type this into a password field". The tool descriptions say where to
set one instead of failing silently.

## Consequences

**Positive**
- `NOTIFY` and `SQL` are unblocked. Both were waiting on exactly this and nothing else.
- The current `SCRIPT.env` / `HTTP.headers` gap closes for tasks that exist today — an existing job
  becomes safe by moving its value into a secret and its field to a ref, with no migration.
- Run logs, archives, exports, the browser and every MCP transcript stop being places a native job's
  credential can be read. Deleting a task now actually destroys its credential.
- The job spec stays fully readable and reviewable — which was `SCRIPT`'s whole argument for
  existing — while no longer being a place a token has to live.

**Costs / risks**
- **A new syntax in a text field.** `${secret.X}` is one more thing to know, and a typo produces a
  run-time refusal rather than a create-time one. Mitigated by naming the missing secret in the
  refusal and by `missingSecrets` on every write response, but the typo is real.
- **Redaction is best-effort and must never be described as more.** Every place it is documented
  says what it does not cover.
- **Secrets are not exportable, by design**, so a task moved between installs needs its secrets
  re-entered. That is the correct trade and it is a genuine friction.
- **Key loss is data loss.** Rotating `ENCRYPTION_KEY` makes every stored secret undecryptable —
  already true of `PlatformConnection.config`, now true of one more thing. A decrypt failure is
  reported as *"stored secrets could not be read (has ENCRYPTION_KEY changed?)"* rather than as an
  empty set, because an empty set would read as "no secrets" and silently run the job wrong.

## Decisions taken, with the alternative that lost

| Question | Decision | What lost, and why |
|---|---|---|
| Where do values live? | Own table, cascade | A `Task` column rides into every default read |
| Encrypt fields in place? | No — refs + sidecar | In-place still travels in exports/archives, and requires guessing which values are secret |
| Set via the job payload? | No — own routes | `PATCH /:id/job` replaces; secrets inside it die on any job edit |
| Unset secret = create error? | No — run-time refusal | Would make import, restore and template-apply impossible to express |
| Refs anywhere a string appears? | No — closed field list | A secret naming the executable defeats the interpreter allowlist and the run log |
| Redact with `••••`? | No — with the ref | Naming the secret tells the reader what was removed |
| MCP writes secrets? | No — names only | A tool call is a transcript |
| Bundle records `requiredSecrets`? | No — derived at import | A second derivation of what the file already states, and a field nothing reads |

## Follow-ups

1. **`NOTIFY` and `SQL` are now unblocked** and should be re-evaluated *together*, as ADR 0002 asked.
   Neither is scheduled by this ADR; the blocker is removed, the decision to build them is not made.
2. **`env` has no editor in the browser.** `EXEC`/`SCRIPT` `env` is reachable through the API and MCP
   only, so a secret in `env` is set in the app but *referenced* from a field the app cannot edit.
   Wiring an env editor into `NativeJobFields` is the natural next pass and is tracked on the
   roadmap.
3. **Key rotation has no story.** Changing `ENCRYPTION_KEY` orphans every `PlatformConnection.config`
   and now every `TaskSecret`. Out of scope here; it was already true and is worth its own item.
