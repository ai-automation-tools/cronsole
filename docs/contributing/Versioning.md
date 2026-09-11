<h1 align="center">🏷️ Versioning &amp; releases</h1>

<p align="center">
  <em>Four components, three release trains, and one contract with software we do not control.</em>
</p>

<p align="center">
  <a href="README.md"><img src="https://img.shields.io/badge/↩-contributing-6B7280?style=for-the-badge" alt="Contributing"></a>
  <a href="../ROADMAP.md"><img src="https://img.shields.io/badge/plan-ROADMAP-8B5CF6?style=for-the-badge" alt="Roadmap"></a>
  <a href="../CHANGELOG.md"><img src="https://img.shields.io/badge/log-CHANGELOG-2ea44f?style=for-the-badge" alt="Changelog"></a>
</p>

---

Cronsole is **local-first**, so releasing is a *distribution* problem, not a deploy problem. A
user's agent from June talks to today's backend, and nothing makes them upgrade. That single fact
decides everything below.

## The components

| Component | Version lives in | Ships as | Tag |
|:---|:---|:---|:---|
| **App** — backend + frontend | `backend/package.json`, mirrored in `frontend/package.json` | The Docker stack / source | `app/v0.9.0` |
| **Agent** | `agent/Cronsole.Agent/Cronsole.Agent.csproj` › `<Version>` | A published binary on a user's machine | `agent/v0.9.0` |
| **MCP server** | `mcp-server/package.json` | An npm-shaped package a host runs | `mcp/v0.9.0` |
| **Template registry** | `registryVersion` in the artifact | A content-addressed JSON artifact on a CDN | **none** |

### Why backend and frontend are one version

They are one deployable. The frontend talks to exactly one backend over an API that is not public,
they are built from the same commit, and no user runs a mismatched pair. Two numbers would be two
numbers that are always equal — a second definition, free to drift, telling nobody anything.

### Why the registry has no tag

**The registry is not on a release train, and that is the entire point of decoupling it.** Content
updates ship by merging to `main`, which publishes itself; an install picks them up without anyone
upgrading anything. `registryVersion` is a **schema** version — it changes when the shape changes,
which has happened zero times. Tying the catalog back to the app's cycle would undo the property it
exists to have.

## Everything starts at `0.9.0`

Cronsole is pre-1.0 and [says so](../STATUS.md). Before 2026-09-11 the manifests read `1.0.0`
(backend, mcp-server) and `0.0.0` (frontend, the Vite default), and **zero git tags existed** — so
no version was ever advertised, nothing downstream pinned one, and nothing goes backwards by
correcting them.

`1.0.0` means the installer exists, the agent is signed, and the wire protocol is one we will
support. None of those is true yet.

## The protocol version is not the agent version

This is the one that bites. `PROTOCOL_VERSION` — `agent/Cronsole.Agent/AgentService.cs` and
`backend/src/ws/protocol.ts`, one value at each end — describes **the wire contract**, not the
build:

- The agent can ship five releases that change nothing about the wire. Protocol stays put.
- A change to the `SignableCommand` shape is **breaking** even if the diff is three lines. HMAC
  canonicalization has to match byte-for-byte, so a mismatch is not a degraded feature — it is
  *every command rejected*.

So: **a wire change is a major version of the app and the agent, together, whatever the diff looked
like.** Semver is a promise about compatibility, not a measure of effort.

### It is reported, not enforced — on purpose

The agent sends `protocolVersion` in `agent:hello`; the backend records it and diagnostics prints
it. Nothing is refused, because **there is exactly one protocol version in existence** — a
mismatch cannot occur, and machinery guarding an impossible state is machinery nobody has ever
seen run.

**The day `PROTOCOL_VERSION` becomes `2`, the refusal is the first thing to build**, before the
feature that needed the new shape: an agent announcing `1` should be told, in a sentence naming the
republish, that it cannot talk to this backend. An honest refusal beats a connection that behaves
subtly wrong — and by then the check has something real to compare.

## Cutting a release

Tags are **prefixed**, because three trains share one repo and `v1.2.0` alone cannot say which
moved. There is no `v*` tag and there should never be one.

```bash
git tag -a app/v0.9.1 -m "app 0.9.1"
git push origin app/v0.9.1
```

1. **Decide which components actually changed.** A backend-only fix is not an agent release.
2. **Bump the manifest**, and `frontend/package.json` too if it was the app.
3. **Write the changelog from real commits** — `git log app/v0.9.0..HEAD` — not from memory.
4. **Run the suites** (`/doctor` first if anything looks stale):
   ```bash
   cd backend  && npm test && npm run test:integration
   cd ../frontend && npm run lint && npm test
   cd ../agent  && dotnet test
   cd ../mcp-server && npm run build   # the host runs dist/, not src/
   ```
5. **Tag, push, release** — attach artifacts and their checksums once there are artifacts.
6. **Update [`ROADMAP.md`](../ROADMAP.md)** (dated), and
   [`troubleshooting`](../troubleshooting/README.md) if the release surfaced a trap.

**Ship the agent and backend together whenever the signed-command shape moved.** They are one
change wearing two version numbers.

## What is not built yet

Signed installers, an update channel, and release notes generated from commits are all open on the
[roadmap](../ROADMAP.md#-go-public-checklist) under *Agent distribution & trust*. **The code-signing
certificate is a hard prerequisite for the whole-stack installer** and has weeks of identity
verification in front of it — start it before it blocks.
