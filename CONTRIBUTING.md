# Contributing to Cronsole

Thanks for contributing to Cronsole.

Cronsole is at **MVP stage**. The goal of this guide is to keep changes small, reviewable, and aligned with the project plan in `docs/`.

## Before you change code

Read these first:

1. [`README.md`](README.md)
2. [`CLAUDE.md`](CLAUDE.md)
3. [`docs/ROADMAP.md`](docs/ROADMAP.md) — the living plan (the phase docs, specs, and research it replaced are kept locally under `docs/archive/`, not tracked in git)
4. [`docs/README.md`](docs/README.md) — the documentation map

If your change affects runtime behavior, docs, or roadmap status, update the matching docs in the same PR.

## Adding a source (a new scheduler)

Cronsole reads scheduled work from platforms through **connectors** — one class per platform,
compiled into the backend. If you want it to support a scheduler it doesn't yet, that is the most
common substantial contribution, and it has its own document:

**→ [`docs/contributing/Adding_A_Source.md`](docs/contributing/Adding_A_Source.md)**

It covers the decision to make first (controller, observer, or just a quick link), the contract a
connector has to meet, the build order file by file, which existing connector to copy, and what
gets declined. Start by opening a
[source proposal issue](.github/ISSUE_TEMPLATE/new_source.md) — five minutes, and it answers
"is this worth building" before you write four hundred lines.

**A read-only connector is a finished contribution, not a half-finished one.** Cronsole's capability
matrix states per verb what a source can and cannot do, so an observer says something true rather
than implying verbs it does not have.

## Contribution principles

- Keep one logical change per PR.
- Prefer small, reversible changes over broad refactors.
- Match the existing stack and patterns:
  - frontend: React + TypeScript + Vite + React Router
  - backend: Node.js + Express + Prisma
  - agent: .NET 10
  - mcp-server: Node.js + `@modelcontextprotocol/sdk` (stdio; a thin wrapper over the REST API)
- Do not add new infrastructure, frameworks, or dependencies without a clear reason.
- Do not market planned features as shipped features in docs or UI copy.
- Treat the repo as a **control plane MVP**, not a general workflow builder.

## Branching

Current documented branch roles:

- `mike_desktop` — active working branch
- `main` — deploy branch

Unless told otherwise, branch from the current working branch and keep `main` stable.

## Local setup

### Docker Compose

```bash
docker compose --profile docker up --build
```

> [!IMPORTANT]
> The `--profile docker` is not optional. Backend and frontend sit behind
> `profiles: ["docker"]`, so a plain `docker compose up` starts **Postgres and Redis only**
> and nothing ever answers on `:7373`.

Services:

- frontend: `http://localhost:7373`
- backend: `http://localhost:3000`
- postgres: `localhost:5432`
- redis: `localhost:6379`

### Manual setup

Backend:

```bash
cd backend
npm install
npx prisma migrate dev
npm run dev
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Windows agent:

```bash
cd agent/Cronsole.Agent
dotnet run
```

## Required checks before opening a PR

GitHub Actions now runs a basic CI workflow from `.github/workflows/ci.yml` for:

- backend tests + build
- frontend lint + build
- Windows agent build
- MCP server build

Local verification is still expected before opening a PR.

### Backend

```bash
cd backend
npm test
npm run build
```

### Frontend

```bash
cd frontend
npm run lint      # first: CI lints before it tests, and a lint error skips both steps below
npm test
npm run build
```

### Agent

Run a local build when you touch `.cs` or agent protocol behavior.

```bash
cd agent/Cronsole.Agent
dotnet build
```

### MCP server

Run a local build when you touch anything under `mcp-server/`.

```bash
cd mcp-server
npm run build
```

## Documentation expectations

Update docs when you change:

- roadmap status
- setup steps
- API behavior
- connector behavior (see [`docs/contributing/Adding_A_Source.md`](docs/contributing/Adding_A_Source.md))
- data model expectations
- agent ↔ backend protocol
- user-visible workflows

At minimum, review whether these need edits:

- `README.md`
- `docs/ROADMAP.md` (the spec of record)
- `docs/setup/README.md` (if env vars / config changed)
- `docs/CHANGELOG.md`

## Current implementation caveats

Please keep these realities in mind when contributing:

- Windows Task Scheduler is the only clearly functional end-to-end platform today.
- Claude support exists as an **experimental scaffold** and should not be presented as production-ready.
- Some planning docs describe target behavior that is not fully implemented yet.
- Auth and platform-connection flows still contain MVP shortcuts and placeholders.

If your change closes one of those gaps, update the docs to reflect the new truth.

## Code style

### TypeScript

- Prefer strict typing.
- Avoid `any` unless you are isolating a boundary and cannot avoid it.
- Keep platform-specific logic inside the connector layer.
- Preserve normalized task behavior in the service layer.

### Prisma / data model

- Respect the uniqueness of `(platform, externalId)` for tasks.
- Preserve user-assigned categories during sync.
- Do not mutate task identity semantics casually.

### Agent / protocol

- The Windows agent is an outbound client.
- Do not redesign the transport shape without updating docs and tests.
- Keep task sync and run semantics backward compatible unless the change is intentional and documented.

## Commit messages

Use conventional prefixes where possible:

- `feat:`
- `fix:`
- `docs:`
- `refactor:`
- `test:`
- `chore:`

Examples:

- `fix: preserve custom task categories during sync`
- `docs: align roadmap status with current MVP state`
- `test: add coverage for windows connector timeouts`

## Pull request checklist

Before requesting review, confirm:

- [ ] The change is scoped to one logical concern.
- [ ] Relevant tests were added or updated where practical.
- [ ] Build/test/lint commands were run locally.
- [ ] Docs were updated to match behavior.
- [ ] `docs/CHANGELOG.md` was updated for user-visible changes.
- [ ] No secrets, keys, or local-only machine details were committed.

## Security and secrets

- Never commit `.env` files or real secrets.
- Never log decrypted platform credentials.
- Do not paste real API tokens into fixtures, screenshots, or docs.
- If you change auth, encryption, or agent trust boundaries, update [`docs/ROADMAP.md`](docs/ROADMAP.md) (the spec of record) and [`docs/CHANGELOG.md`](docs/CHANGELOG.md). (The original `docs/specs/CONTRACTS.md` and per-phase docs are frozen under the local-only `docs/archive/`.)

## When in doubt

If a behavior change conflicts with the docs, either:

1. change the implementation to match the spec, or
2. update the spec in the same PR so the repo has one consistent story.
