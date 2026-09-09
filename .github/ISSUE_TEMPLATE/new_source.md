---
name: New source (connector)
about: Propose a scheduler Cronsole should read scheduled work from
title: "[Source] "
labels: enhancement, source
---

<!--
Read docs/contributing/Adding_A_Source.md first — it is short, and it answers most of what
follows. This issue exists so that "this should be a quick link, not a connector" costs you a
paragraph instead of a weekend.

You do NOT have to open this before writing code. It is a way to get a straight answer cheaply,
not a gate.
-->

## The platform

<!-- Name it, and link its scheduled-task docs. -->

## Which shape is it?

<!--
Pick one. Getting this wrong is the usual reason a connector stalls half-built.

- Controller — the API can read AND change scheduled work (run, enable/disable, edit, delete).
               Hosted does not rule this out: Gemini API Triggers is a hosted controller.
               Ask what each write verb would actually DO, not where the platform runs.
- Observer   — it can be read, but should not be written or cannot be. A FINISHED state, not a
               stalled one. The right default for a hosted platform.
- Quick link — no public API for scheduled work exists. This needs no PR at all: add it from the
               Sources tab in ten seconds.
-->

- [ ] Controller
- [ ] Observer
- [ ] Quick link (no code needed — you can close this and add it in the app)

**Why that one:**

## Does it beat a bookmark?

<!--
The one test a source has to pass: does a connector do something a link to the platform's own
dashboard cannot?

Firing a routine does. So does surfacing that a nightly workflow was silently disabled two months
ago. Rendering ten struck-through capability cells does not — that says strictly LESS than a link.
-->

## The auth surface

<!--
What credential does it need, what scopes, and what does a user have to do to get one?

Note if the credential is per-account (one token reads everything — GitHub, Vercel) or per-item
(a token per routine — Claude). It changes the shape of the connection config and the panel.
-->

## Which verbs can it honestly support?

<!--
For each of `sync`, `run`, `create`, `setStatus`, `updateSchedule`, `updateAction`, `export`,
`restore`, `delete`, `listFolders` — say supported, "cannot", or "not yet".

"Cannot" and "not yet" are different cells on the capability matrix, and only you know which one
you mean. Watch for a verb that is really a DIFFERENT action wearing the verb's name: GitHub
Actions refuses Run now despite `workflow_dispatch` existing, because a dispatched run is not the
scheduled run.
-->

## Does it report run outcomes?

<!--
Can Cronsole find out whether a scheduled run actually succeeded or failed?

If not, that is fine and shippable — Vercel Cron is exactly this — but say so, because those tasks
sit at `unknown` health permanently and every surface has to admit it rather than reporting
"configured, therefore healthy".
-->

## Are its schedules expressible as 5-field UTC cron?

<!--
That is Cronsole's storage contract everywhere. If the platform's schedules are richer
(systemd OnCalendar, a rate expression, a "every weekday at" builder), say what is lost in the
conversion — a lossy conversion is acceptable, an unmentioned one is not.
-->

## Anything else

<!-- Rate limits, pagination quirks, a sandbox account for testing, or whether you plan to build it. -->
