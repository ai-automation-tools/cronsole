<a id="adding-a-source-top"></a>

<h1 align="center">🔌 Adding a Source</h1>

<p align="center">
  <em>Make Cronsole read scheduled work from a platform it doesn't support yet.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/audience-contributors-8B5CF6?style=for-the-badge" alt="For contributors">
  <a href="../../.github/ISSUE_TEMPLATE/new_source.md"><img src="https://img.shields.io/badge/start_with-a_proposal-2ea44f?style=for-the-badge" alt="Start with a proposal issue"></a>
  <a href="README.md"><img src="https://img.shields.io/badge/↩-contributing-6B7280?style=for-the-badge" alt="Contributing home"></a>
</p>

---

> **This is the document for someone about to open an editor** — the decision to make first, the
> contract to meet, the files to touch in order, and the reasons a proposal gets declined.
>
> Using Cronsole rather than extending it? The
> [Sources Guide](../user-guides/guides/Sources_Guide.md) is the one you want.

**A source is a connector compiled into the backend.** There is no plugin folder and nothing to drop
in at runtime, deliberately: a connector holds third-party credentials, issues commands to your
machine, and decides what a sync is allowed to retire. That is not a thing to load off disk
unreviewed.

So adding a source means **a pull request**, and the honest version of that sentence is: open one and
you will get a straight answer about whether it fits. Some proposals do not fit, and the reasons are
in this document rather than in a reply three days later.

---

## 🧭 Before you write anything

**Open a [source proposal issue](https://github.com/michaelschecht/cronsole/issues/new?template=new_source.md)
first.** It takes five minutes and asks the four questions that decide whether the connector is worth
building — which shape it is, what its auth surface is, which verbs it can honestly support, and
whether the platform reports run outcomes. Every one of those is cheap to answer in prose and
expensive to discover after 400 lines.

The proposal is not a gate you have to pass to be allowed to code. It is there so that *"this should
be a quick link, not a connector"* costs you a paragraph instead of a weekend.

---

## 1️⃣ Decide which shape it is

Three shapes. **Picking the wrong one is the usual reason a connector stalls half-built.**

| Shape | When it fits | What it costs |
|:--|:--|:--|
| **Controller** | The platform has an API to read **and** change scheduled work — run, enable/disable, edit, delete. | The most work and the most trust. Windows Task Scheduler and Cronsole-native are the local two; **Gemini API Triggers** is the hosted one, and the worked example if your platform is somebody else's HTTP API. |
| **Observer** | It can be read, but should not be written or cannot be. | Much less — and it is a **finished** state, not a stalled one. GitHub Actions and Vercel Cron are the worked examples. |
| **Quick link** | No public API for scheduled work exists at all. | A bookmark. Anyone adds one from the Sources tab in ten seconds; it needs no PR. |

**An observer is a good default for a hosted platform, but not an automatic one.** Two of the three hosted sources here are observers, and the third is not: Gemini API Triggers is a controller because every verb it offers reaches an endpoint that does the thing the verb says. Decide by asking what each write verb would actually *do*, not by whether the platform is in the cloud.

Cronsole says plainly which half a connector is — `PlatformDescriptor.access` is `controller` or
`observer`, declared and rendered — so
shipping a read-only source is not an apology and does not read as unfinished work.

> **Read-only does not mean second-class.** It means the capability matrix tells the truth. Before
> that matrix existed (2026-08-12) a partial connector *lied*: the UI implied every verb the
> interface mandated, so a platform Cronsole could only read still rendered a Run button that did
> nothing. `unsupported` is what makes an observer honest, and therefore finished.

### The test a source has to pass

**Does it do something a bookmark cannot?** Firing a routine does. So does telling you a nightly
workflow GitHub silently disabled two months ago has not run since. Rendering ten struck-through
cells does not — that says strictly *less* than a link to the platform's own dashboard.

---

## 2️⃣ Meet the contract

Every one of these has cost someone real time. They are not style preferences.

- **A 5-field cron in UTC, for every task you report.** That is the storage contract everywhere in
  Cronsole — the API, the signed agent commands and the MCP tools all assume it. Conversion happens
  at the browser's edge and nowhere else. If the platform's schedule cannot be expressed as one, the
  conversion is lossy and you have to say so; an unmentioned approximation is the one outcome ruled
  out.
- **If the platform stores a time zone, Cronsole stores UTC — and the conversion is not optional.**
  Gemini API Triggers is the first source that carries `{ schedule, time_zone }`, and it is why
  `utils/cron.ts` has a server-side `shiftCronToUtc` at all: the browser cannot do this one, because a
  sync, an MCP session and the rail all have to normalize the same trigger identically and none of them
  has a browser. Write UTC on everything you create or edit, so a round trip through Cronsole is exact.
  Normalize on read, keep the platform's original pair in metadata, and refuse — with the reason — any
  expression that has no honest UTC equivalent.
- **A schedule you could not read is `null` with a reason**, never a guessed cron. *"Cronsole could
  not read this"* and *"this has no schedule"* are different facts that demand different actions, so
  they must never be the same code path.
- **A stable `externalId`, unique within the platform.** It is the identity every tracked row, star
  and exclusion is keyed on. Choose the thing that survives a rename: GitHub uses the numeric
  workflow id, not the file path, so renaming `nightly.yml` does not retire the task and lose its
  category.
- **Your boundaries, stated once.** A verb the platform genuinely cannot support goes in
  `unsupportedVerbs`, which turns an attempt into a refusal (`400`) rather than a failure (`502`).
  An optional verb you simply do not implement is unsupported **by its absence** — do not state the
  same boundary twice, or the two are free to disagree.
- **Health as evidence, never as a precondition, and never with a side effect.** A health check that
  *fires* the thing it is checking is not a health check. Having no verdict is `UNKNOWN`, which is
  not a synonym for healthy. Read back stored sync evidence rather than probing: `getHealth` runs
  every 45 seconds **per open browser tab**, and spending someone's API rate limit there answers a
  question the next sync answers for free. **Sync is the user's probe** — every connector that talks
  to a remote platform has reached that conclusion independently, from a different direction each
  time: a rate limit, a metered quota, an agent round trip.
- **A sync that fails loudly.** If *every* source in a sync failed, **throw**. Returning an empty
  list reads as "the platform no longer has these tasks" and retires the lot. A partial failure
  returns what it got and sets `partial`, which suppresses retirement for that pass.
- **A sync that says what it looked at.** Return a `SyncOutcome` with `notes` whenever importing
  zero can be *correct* — a repository whose workflows are all push-triggered imports nothing and is
  working perfectly, which is the same empty screen as a broken sync. That ambiguity hid a real
  defect until the database was read by hand ([#75](../troubleshooting/README.md#75-a-github-repository-is-watched-sync-succeeds-and-no-workflows-ever-arrive)).

---

## 3️⃣ Build it, in this order

Steps 1–7 are the backend. **Do not stop there** — steps 8–10 are what make the source appear as
itself rather than as a grey globe labelled `SCREAMING_ENUM`, and none of them fails a test when you
skip it.

### The backend

1. **Implement `PlatformConnector`** in `backend/src/connectors/<Name>Connector.ts`.
2. **Register it** in `backend/src/connectors/registry.ts`.
3. **Only implement the optional methods you can honestly do.** Leaving `deleteTask?` undefined *is*
   the design — a stub returning `{ success: true }` converts a missing capability into a lie.
4. **If the platform publishes its own run history, implement `listPlatformRuns` — and
   `getRunOutput` if it publishes what a run produced.** Optional, unsupported by absence, and worth
   more than it looks on any source that runs work by itself: `ExecutionLog` records only runs
   *Cronsole* performed, so without these the Run History tab honestly reports *"no recorded runs"*
   over a platform with a week of them. Do **not** solve that by writing the platform's runs into
   `ExecutionLog` — the two populations render as separate groups and are never summed. Keep output
   behind `getRunOutput` rather than inlining it in the list: one transcript can be ~90KB, and the
   list is usually opened to read four timestamps. Where the platform names the tools a run used,
   return them in `steps` — an agent can finish `completed` having skipped the part the user asked
   for, and the step list is the only place that shows.
5. **Add the `PlatformType` value** to `backend/prisma/schema.prisma`, with a migration. A new
   platform value needs no table, no column and no backfill: `PlatformConnection`, `Task`,
   `TaskExclusion` and `PlatformCapability` are all keyed on the enum and gain it for free.
6. **Declare `access`** in `PLATFORM_DESCRIPTORS` (`backend/src/services/platformCapabilities.ts`),
   and add the platform to `MATRIX_PLATFORMS`. Declared, **never counted from the cells**: a finished
   read-only connector and one whose write verbs are merely unbuilt produce an identical row of
   refusals, and only one of them is worth waiting for.
7. **Is your tracked set declared or observed?** If the user names what to watch in the connection
   config — repositories, projects, accounts — rather than by picking folders off a machine,
   implement **`trackedCategories(config)`**. Otherwise a plain Sync filters out everything you just
   read and reports success, forever, with no second gesture to reach for
   ([#75](../troubleshooting/README.md#75-a-github-repository-is-watched-sync-succeeds-and-no-workflows-ever-arrive)).
8. **Can the platform report run outcomes?** Put `reportsRunResult` in every task's metadata —
   **present-and-`false`**, never absent, because `services/taskHealth.ts` reads an absent key as
   *"Cronsole never asked"* rather than *"the platform has nothing to say"*. Then give the platform
   its own arm in `scoreTask`. There is deliberately **no fallback arm**. If the platform publishes
   no run history at all (Vercel Cron), the honest answer is `unknown` **permanently**, with the
   reason naming the platform — never *"configured, therefore healthy"*, because **configured** and
   **working** are different claims.

### The frontend

9. **`frontend/src/platform.ts`** — `platformLabel`, `platformSourceLabel`, `sourceDescription`,
   `platformBadgeClass`, `SOURCE_ICON`, `platformAccent`, and **`sourceSetupHint`** (whose `hasPanel`
   decides whether an unconnected card offers a *Set up* button or just a sentence explaining that
   the source connects itself).
10. **`frontend/src/index.css`** — an identity pair `--x` / `--x-text` in **all three** blocks
   (`:root`, `.dark`, `.light`) plus the `@theme` exports. Then add both to
   `__tests__/themeContrast.test.ts`, because **the palette is measured, not reviewed**: colour is
   the one thing that breaks silently, since a failing role still renders perfectly.
11. **If the connection is composed by hand**, render its panel from **both** `ConnectedSourceCard`
    and `UnconnectedSourceCards` — setting a source up and maintaining it later must be one surface,
    not two that drift. Reuse `components/sources/ConnectionField` for credential inputs rather than
    writing a third copy of a `type="password"` field.

### The records, in the same change

`CLAUDE.md` §11a calls these **mirror surfaces**: they *describe* Cronsole rather than implementing
it, so **none of them breaks loudly when it drifts.** The suite stays green and the drift surfaces
weeks later as someone confidently doing the wrong thing.

- A `HelpTopic` in `frontend/src/data/help.ts`, pointing at **a new section in the
  [Sources Guide](../user-guides/guides/Sources_Guide.md)** — `docsLinks.test.ts` fails if the anchor
  does not resolve.
- `ALL_PLATFORMS` and the platform sentences in `mcp-server/src/tools.ts`, plus the `list_tasks` and
  `list_platforms` rows in **both** MCP tool tables (`mcp-server/README.md` and
  `docs/user-guides/guides/MCP_Server_Guide.md`).
- The platform line in `CLAUDE.md` §2, and any new invariant in §9.
- [`docs/CHANGELOG.md`](../CHANGELOG.md) and [`docs/ROADMAP.md`](../ROADMAP.md), dated.

---

## 4️⃣ Copy the closest one

**Start from a real connector rather than from this document.** There is no scaffold or template file
on purpose — a template that nothing compiles against drifts from the interface, which is the exact
failure mode this project spends the most effort avoiding.

| Start here | When |
|:--|:--|
| [`VercelCronConnector.ts`](../../backend/src/connectors/VercelCronConnector.ts) | **The best starting point for a read-only source.** The smallest complete connector: a hosted observer, one account token, a declared tracked set, health from stored evidence, and the honest handling of a platform that reports no run outcomes. |
| [`GeminiTriggersConnector.ts`](../../backend/src/connectors/GeminiTriggersConnector.ts) | **The starting point for a hosted source you can act on.** The only connector with an empty `unsupportedVerbs`: every mandated verb reaches a documented endpoint. Read it for how a write verb earns its name (its `run` is the real scheduled invocation, where GitHub's and Vercel's would not have been), for a **constant** declared tracked set on a platform with no containers, and for the one case where a platform stores a time zone and Cronsole has to reconcile it server-side. |
| [`GitHubActionsConnector.ts`](../../backend/src/connectors/GitHubActionsConnector.ts) | Your platform keeps its schedule somewhere the list endpoint does not return (a file, a second request), or it *does* report real run outcomes you want scored. |
| [`ClaudeConnector.ts`](../../backend/src/connectors/ClaudeConnector.ts) | Your platform's capabilities depend on the **install** rather than on the connector — then `unsupportedVerbs` is a getter, not a constant. |
| [`WindowsAgentConnector.ts`](../../backend/src/connectors/WindowsAgentConnector.ts) | You are adding a **local OS scheduler** reached through an agent. Read the agent protocol in [`skills/cronsole/references/architecture.md`](../../skills/cronsole/references/architecture.md) first. |

Each connector's class comment explains *why* it is shaped the way it is, including what was
deliberately left out. Those comments are the densest documentation in the repo — read the one you
are copying before you change it.

---

## 5️⃣ What will not be accepted

- **A connector for a platform with no public scheduled-task API.** It renders as a row of
  *Unsupported* cells that say strictly less than a bookmark does. Add a quick link instead — the
  Sources tab does that with no PR at all.
- **A write verb that is really a different action wearing the verb's name.** GitHub Actions refuses
  *Run now* even though `workflow_dispatch` exists, because a dispatched run is **not the scheduled
  run** you came to check. Vercel Cron refuses it too, even though its cron path is an ordinary HTTP
  endpoint, because calling it yourself bypasses the platform's own `CRON_SECRET` and the scheduler
  never records it.
- **Platform-specific logic outside the connector layer.** A `switch` on the platform in a route or
  a component is what review sends back, every time.
- **Anything that makes the agent write files.** The Windows agent is elevated and local, so a
  file-write verb would be a general arbitrary-file-write primitive reachable from the backend.
- **A credential stored anywhere but `PlatformConnection.config`**, which is AES-256-GCM encrypted at
  the application layer. Never log a decrypted value; never add a route that reads one back.
- **A health check that probes the platform.** See the contract above.

---

## 6️⃣ Open the PR

Say, in the description:

- **Which of the three shapes it is, and why** — especially if it is an observer, since that is a
  choice rather than a limitation.
- **The verbs you are not supporting, and whether each is "cannot" or "not yet."** They are different
  cells on the matrix, and only you know which one you meant.
- **The auth surface it needs** — what kind of credential, what scopes, and what the user has to do
  to get one.
- **Whether the platform reports run outcomes**, and what a task's health reads as if it does not.

Then run the checks:

```bash
cd backend    && npx tsc --noEmit && npx vitest run
cd ../frontend && npm run lint && npx tsc --noEmit && npx vitest run
cd ../mcp-server && npm run build && npx vitest run
```

**`npm run lint` is not optional and nothing else covers it.** It is its own CI gate — `npx vitest
run` and `tsc --noEmit` both pass straight through an ESLint error — and the frontend job lints
*before* it tests, so one violation means the suite and the build never ran either. A red CI with
every other job green is usually this
([#80](../troubleshooting/README.md#80-ci-is-red-on-a-commit-whose-tests-and-typecheck-both-passed-locally)).

[`CONTRIBUTING.md`](../../CONTRIBUTING.md) has the rest — commit format, branch roles, and what a
review looks at.

> **A connector with an honest capability matrix and half the verbs beats a complete-looking one that
> guesses.** If you are unsure whether to implement a verb, don't — an absent method is a boundary
> the UI renders correctly, and a wrong one is a button that lies.

---

*See also: the [Sources Guide](../user-guides/guides/Sources_Guide.md) for what each shipped source
does, [`CLAUDE.md`](../../CLAUDE.md) §9 for the full invariant list, and
[`DESIGN_NOTES.md`](../DESIGN_NOTES.md) for the argument behind any rule you want to push back on.*

*Last Updated: August 24, 2026*

<p align="right"><sub><a href="#adding-a-source-top">back to top</a></sub></p>

---

<p align="center">
  <a href="README.md">← Contributing home</a> ·
  <a href="../../CONTRIBUTING.md">CONTRIBUTING.md</a> ·
  <a href="../user-guides/guides/Sources_Guide.md">Sources Guide →</a>
</p>
