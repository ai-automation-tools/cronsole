# ADR 0004: How a native task runs (parallel runs, time limits, retries, catch-up)

- **Status:** **Accepted (2026-11-06).**
- **Deciders:** Mike
- **Related:** [ADR 0002](0002-native-job-types.md) · [ADR 0003](0003-per-job-secrets.md) ·
  [ROADMAP › Native scheduler reliability](../ROADMAP.md#native-run-policy) ·
  [Cronsole-native guide](../user-guides/sources/Cronsole_Native.md)

## Context

Native tasks were meant to be an alternative to Windows Task Scheduler. On a real machine with 215
user tasks, almost none of them could have moved, and the reasons had nothing to do with job types:

| What the tasks relied on | How many | Native before this ADR |
|:---|:---|:---|
| A time limit over an hour | 131 | Capped at 60 minutes |
| Running beside other jobs | most of them | `tick()` awaited every run, so one slow job held up **every** native task, not just the ones due with it |
| *Run as soon as possible after a missed start* | 40 | A run more than 5 minutes late was skipped |
| Retry after a failure | n/a | No retries at all |

The goal is not to move those tasks. It is to stop native losing on reliability, so it can win on
what it already does better: output in the run log, secrets, checks, templates.

## Decision

Four changes, all stored on the job as one optional `policy` object plus the existing `timeoutMs`.
They live on the job because `buildNativeJob` / `validateJob` are already the one definition of a
native job; a second record would be a second definition.

```ts
job.policy?: {
  overlap?: 'skip' | 'queue';   // default 'skip'
  retries?: number;             // 0–5, default 0
  retryDelayMinutes?: number;   // 1–60, default 1
  catchUp?: boolean;            // default false
}
```

### 1. Runs are independent

`tick()` now only decides what is due and advances `nextRunTime`. Each run starts on its own and the
tick returns without waiting for it. The scheduler keeps an in-memory set of running task ids.

**What happens when a task is still running at its next due time is the task's choice**, the same
question Task Scheduler asks:

- `skip` (default): the new run does not start. The log says so.
- `queue`: one run is held and starts when the current one ends. Never more than one; a backlog of
  queued runs is how a stuck job turns into a burst.

**Run now on a running task is refused** with *"already running"*, whatever the policy. Someone
clicking a button wants a run now, not a queued one later. The connector returns `busy: true` and
the route answers **409 and records nothing**: no history row, no health evidence, no notification.
Found by driving it live, where the first version logged the refusal as a FAILURE and marked
native's Run verb broken on the Sources tab.

There is no global concurrency cap. Task Scheduler has none either, and a cap would bring back the
head-of-line blocking this fixes.

### 2. Time limit up to 24 hours

`MAX_EXEC_TIMEOUT_MS` goes from 60 minutes to 24 hours. The default stays 5 minutes so existing jobs
behave as they did. The form shows the limit, because a job killed at 5 minutes with no visible
setting was the most likely surprise.

### 3. Retries, for runs that failed, and never for checks

A scheduled run is retried when it **ran and failed** (`ran: true, success: false`). Not when it
could not start (`ran: false`: a missing secret, an invalid spec, an undecryptable store), because
those fail identically on every attempt.

**A `CHECK` cannot have retries.** Its failure is a measurement (ADR 0002), and retrying a
measurement until it passes is how a real outage reads as green. `validateJob` refuses the field
on a check, by name.

Each attempt writes its own `ExecutionLog` row (*attempt 2 of 3*). **Only the final attempt
notifies**, or a three-attempt job sends three alerts for one failure. Run now is never retried:
the person who clicked is watching.

Retries wait on an in-process timer. A backend restart drops a pending retry; the next scheduled run
still happens. Persisting them would need a table for a case where the whole scheduler was down.

### 4. Catch-up, once

With `catchUp`, a run missed while Cronsole was down runs **once** when the scheduler next ticks,
logged as a catch-up. Once, not once per missed slot: `nextRunTime` is advanced from *now*, so a
task down for a week runs one time, not 168. That matches Task Scheduler's *run as soon as possible
after a scheduled start is missed*.

## Consequences

- A native task can now run for hours, beside other tasks, and recover from a flaky failure. The
  guide's *Use something else* list loses three rows.
- What remains Windows-only is what native cannot be by construction: running while Cronsole is
  down, logon and session triggers, and your desktop session.
- `ExecutionLog` gains no column. The attempt number and catch-up are in the log text, as
  `[scheduled]` already was. No migration.
- A timed-out run is still recorded as `FAILURE`, not the unused `TIMEOUT` status. Changing that is
  a separate decision about what every reader of `ExecutionLog.status` expects.

## Rejected

- **A global concurrency cap.** It reintroduces the blocking this fixes, for a risk (hundreds of
  simultaneous native jobs) nobody has.
- **Retrying checks with a "confirm before alerting" meaning.** Useful, but a different feature:
  *fail after N consecutive failures* belongs on the notification, not on the run.
- **Persisted retries.** See §3.
