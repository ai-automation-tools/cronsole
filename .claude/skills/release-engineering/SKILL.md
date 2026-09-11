---
name: release-engineering
description: 'Cut a Cronsole release — semantic versioning across four independently-versioned components on three release trains, prefixed tags, the agent wire protocol, changelog discipline, and the source-only distribution rule. Use when cutting a release, tagging a version, bumping a version, distributing the agent, or working the go-public checklist. Also read it before attaching any artifact to a GitHub release.'
---

# Release Engineering

Cronsole is **local-first and ships as source**: a clone or the Docker stack, with the agent built
on the machine that runs it. So releasing is neither a deploy nor a packaging problem — a release is
a **marker in history** saying which commits went together, and users arrive at it with `git pull`.

Full scheme: [`docs/contributing/Versioning.md`](../../../docs/contributing/Versioning.md).

## The one thing to understand

**A release ships no binaries, and that is load-bearing.**

The moment an `.exe` or `.msi` is attached to a GitHub release, it is *downloaded*. A downloaded
file carries **Mark-of-the-Web**, MOTW summons **SmartScreen**, and clearing SmartScreen requires an
**Authenticode code-signing certificate** — weeks of identity verification, a renewal treadmill, and
a signed artifact whose provenance has to be defended forever. A binary the user compiled locally
carries no MOTW and summons nothing.

That is why signing and installers were **cancelled 2026-09-11**, not deferred
([ROADMAP › Open decisions](../../../docs/ROADMAP.md#open-decisions)). The cancellation holds only
as long as nobody uploads a convenient binary. **Nothing in CI enforces this.** It is one upload
away from being undone, and undoing it costs the certificate.

If someone asks for an installer: the answer is the trust page and better clone docs, or reopening
the decision in full. There is no half-measure.

## Versioning — four components, three release trains

| Component | Version lives in | Tag |
|:---|:---|:---|
| **App** — backend + frontend | `backend/package.json`, mirrored in `frontend/package.json` | `app/v0.9.0` |
| **Agent** | `Cronsole.Agent.csproj` › `<Version>` | `agent/v0.9.0` |
| **MCP server** | `mcp-server/package.json` | `mcp/v0.9.0` |
| **Template registry** | `registryVersion` in the artifact | **none** |

- **Backend and frontend are one version.** One deployable, one commit, no user runs a mismatched
  pair. Two numbers would always be equal — a second definition free to drift.
- **The registry is not on a release train.** Content ships by merging to `main`, which publishes
  itself. `registryVersion` is a *schema* version and has never moved. Re-coupling it undoes the
  property it exists to have.
- **Tags are prefixed.** Three trains share one repo, so a bare `v1.2.0` cannot say which moved.
  There is no `v*` tag and there should never be one.

## The protocol version is not the agent version

`AgentService.ProtocolVersion` and `backend/src/ws/protocol.ts` describe **the wire contract**, not
the build. They move independently: five agent releases can change nothing about the wire, while a
three-line change to the `SignableCommand` shape is **breaking** — HMAC canonicalization must match
byte-for-byte, so a mismatch is not a degraded feature, it is *every command rejected*.

> **Semver honestly.** If an old agent cannot talk to the new backend, that is **major** for both,
> regardless of how small the diff looked. Ship them together.

It is currently **reported, not enforced** — one protocol version exists, so a mismatch cannot
occur. **The day it becomes `2`, build the refusal first**, before the feature that needed the new
shape: an agent announcing `1` gets a sentence naming the republish. An honest refusal beats a
connection that behaves subtly wrong.

## Cutting a release

```bash
git tag -a app/v0.9.1 -m "app 0.9.1"
git push origin app/v0.9.1
```

1. **Decide which components changed.** A backend-only fix is not an agent release.
2. **Bump the manifest** (and `frontend/package.json` if it was the app).
3. **Changelog from real commits** — `git log app/v0.9.0..HEAD` — not from memory.
4. **Run every suite** (`/doctor` first if anything looks stale).
5. **Tag and push.** No artifacts attached — see above.
6. **Update `docs/ROADMAP.md`** (dated), and troubleshooting if the release surfaced a trap.

## Release checklist

- [ ] Version decided per component; a wire change called **major** on both
- [ ] Changelog written from real commits
- [ ] `cd backend && npm test && npm run test:integration`
- [ ] `cd frontend && npm run lint && npm test`
- [ ] `cd agent && dotnet test`
- [ ] `cd mcp-server && npm run build` (the host runs `dist/`, not `src/`)
- [ ] Registry drift test passes; registry published if the catalog moved
- [ ] Manual runbooks worked (`docs/testing/manual-testing/`) — real COM, agent resilience,
      security at rest, which no suite covers
- [ ] Agent + backend tagged **together** if the signed-command shape moved
- [ ] **No binary attached to the release**
- [ ] `docs/ROADMAP.md` updated (dated)

## Trust, without a signature

Source distribution moves the trust burden from a certificate to the docs, and the docs are now the
whole of it. The agent runs **elevated**, so the open *trust page* item must name:

- what it can do — enumerate, create, run and edit Task Scheduler entries
- what it **cannot** — no file-write verb, deliberately, because that would be an arbitrary-file-write
  primitive reachable from the backend
- that it **dials out** and never accepts an incoming connection
- how to remove it, including the `\Cronsole-Stack\` tasks an uninstall must sweep by hand

"Read the source you are running" is only a real answer if something tells the reader what to read.

## Legal minimum

- **LICENSE** — Apache-2.0, already in place
- **Privacy statement** — local-first is a *selling point*; say plainly what leaves the machine
  (registry fetches, webhooks the user configured) and what does not
- **Third-party notices** — bundled dependency licenses
- **Security contact** — `SECURITY.md`, already in place

## Working rules

1. **Never attach a binary to a release.** It reinstates the certificate requirement silently.
2. **Prefer the honest refusal** — a version check that blocks a mismatched agent with a clear
   message beats one that connects and behaves subtly wrong.
3. **`context7` before writing** against GitHub Actions release tooling; it changes and stale
   invocations fail confusingly.
4. **Secrets never in code**, and there are no signing secrets to hold any more.
