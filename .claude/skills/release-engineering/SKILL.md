---
name: release-engineering
description: 'Ship Cronsole to strangers — semantic versioning across four independently-versioned components, WiX MSI installer packaging, Windows Authenticode code signing, macOS notarization, agent auto-update and trust, changelogs, and GitHub releases. Use when cutting a release, tagging a version, building or signing an installer, distributing the agent, or working the go-public checklist.'
---

# Release Engineering

Cronsole is **local-first**: users run the frontend, backend, and a native agent on their own
machine. That makes releasing a *distribution* problem, not a deploy problem — you are
asking a stranger to run an **unattended, elevated, scheduled process** they did not build.

Covers four open roadmap items: **Installer packages**, **Agent distribution & trust**,
**Versioning & releases**, and **Legal minimum** (`docs/ROADMAP.md` › P3 + Go-public).

## The one thing to understand

**Trust is the product.** A code-signing certificate is not a compliance checkbox — it is
the difference between "install this" and a SmartScreen wall that says the publisher is
unknown. Cronsole’s whole value is that state it reports is *true* and actions it takes
*actually happen*; a user cannot verify that from the outside, so the signature is the only
claim they can check.

**An unsigned agent asking for elevation is indistinguishable from malware.** Treat it that
way when weighing whether signing is worth the cost.

## Quick start — cutting a release

1. **Decide the version** per the component matrix below. Confirm which components changed.
2. **Update the changelog** from the actual commits, not from memory.
3. **Build and test everything** (`/doctor` first if anything looks stale).
4. **Build + sign the installer**; verify the signature on a *clean* machine, not the build box.
5. **Tag and release**, attaching the installer and its checksum.
6. **Update `docs/ROADMAP.md`** (dated) and the troubleshooting log if the release surfaced a trap.

## Versioning — four components, four lifecycles

The repo ships things that version **independently**, and conflating them is the trap:

| Component | Versioned by | Breaks when |
|:---|:---|:---|
| **Backend + frontend** | App version | API contract changes |
| **Agent** (`agent/`) | Its own version, **and the wire protocol** | The protocol or the signed-command shape changes |
| **MCP server** (`mcp-server/`) | Its own `package.json` | A tool is removed/renamed or its params change |
| **Template registry** | **Schema version** (`Registry v1`) + content | The schema changes; content updates are *not* releases |

Rules that follow from that:

- **The registry is not on the app's release cycle.** That is the entire point of decoupling
  it — content updates ship without redeploying the app. Do not tie them together again.
- **The agent's wire protocol is a contract with software you do not control** — an old agent
  on a user's machine talks to your new backend. A `SignableCommand` change is **breaking**:
  HMAC canonicalization must match byte-for-byte, so a mismatch is not a degraded feature,
  it is every command rejected.
- **The MCP server is a public tool surface.** Renaming a tool breaks prompts and configs you
  cannot see.

> **Semver honestly.** If an old agent cannot talk to the new backend, that is **major** —
> regardless of how small the diff looked.

## Windows: MSI + Authenticode

WiX builds the MSI (`agent/installer/`). What actually matters:

- **The agent installs as an elevated scheduled task** (RunLevel Highest). The installer is
  asking for a lot; the UAC dialog naming a verified publisher is what earns it.
- **Sign the `.exe` *and* the `.msi`.** Signing only the installer leaves the binary
  unverifiable after extraction.
- **Timestamp the signature** (`/tr`). Without a timestamp the signature dies with the
  certificate; with one it stays valid after expiry.
- **EV vs OV**: an OV certificate still accrues SmartScreen reputation from zero — expect
  warnings on early downloads. EV gets instant reputation. That reputation gap is a real
  launch consideration, not a formality.
- **Verify on a clean machine.** Your build box trusts things a stranger's does not.

```powershell
signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /a artifact.msi
signtool verify /pa /v artifact.msi
```

## macOS: notarization (when the launchd agent lands)

Different model, stricter: **sign → notarize → staple**, or Gatekeeper refuses.

- Requires a **Developer ID Application** certificate and a **hardened runtime**.
- **Notarization is Apple scanning your binary**, not a signature — it is a network round
  trip that can fail on entitlements after signing succeeded.
- **Staple the ticket** so it verifies offline. Unstapled binaries fail for users without
  network at first launch.
- A launchd agent needs its plist scoped correctly — `LaunchAgents` (per-user) vs
  `LaunchDaemons` (root). Match the Windows model: the agent is a **client**, dials out, and
  never binds a port.

## Agent distribution & trust

The agent auto-updating is the highest-risk feature Cronsole could ship: an elevated process
that replaces its own binary is exactly what an attacker wants to compromise.

- **Verify the signature before swapping the binary**, not after.
- **The update channel must be authenticated** — HTTPS with pinned expectations, not "fetch
  a URL and run it."
- **Never auto-update across a breaking protocol change** without the user knowing.
- **Publish checksums** alongside releases and make them easy to check.
- The agent **never hot-reloads** — an update means stopping an elevated process and
  replacing a locked exe. Plan the restart, do not hide it.

## Legal minimum (before strangers install it)

- **LICENSE** — pick it deliberately; it constrains contribution and reuse.
- **Privacy statement** — Cronsole is local-first and that is a *selling point*. Say plainly
  what leaves the machine (registry fetches, webhooks the user configured) and what does
  not.
- **Third-party notices** — the bundled dependency licenses.
- **Security contact** — where to report a vulnerability.

## Release checklist

- [ ] Version decided per component; breaking protocol changes called **major**
- [ ] Changelog written from real commits
- [ ] `cd backend && npm test && npm run test:integration`
- [ ] `cd frontend && npm run lint && npm test`
- [ ] `cd agent && dotnet test`
- [ ] `cd mcp-server && npm run build` (the host runs `dist/`, not `src/`)
- [ ] Registry drift test passes; registry published if the catalog moved
- [ ] Manual runbooks worked (`docs/testing/manual-testing/`) — they cover what no suite can:
      real COM, agent resilience, security at rest
- [ ] Installer built **and signed**, signature verified on a **clean** machine
- [ ] Checksums published
- [ ] Agent + backend shipped **together** if the signed-command shape moved
- [ ] `docs/ROADMAP.md` updated (dated)

## Working rules

1. **Never ship an unsigned elevated binary to strangers.** It is indistinguishable from
   malware, and asking users to click past the warning trains them to click past warnings.
2. **Prefer the honest refusal.** A version check that blocks a mismatched agent with a
   clear message beats one that connects and behaves subtly wrong.
3. **Verify on a machine that is not yours.** Every trust check on your box is
   pre-contaminated.
4. **`context7` before writing** against WiX, `signtool`, `notarytool`, or GitHub Actions
   release tooling — this area changes and stale invocations fail confusingly.
5. **Secrets never in code.** Signing certs and notarization credentials live in the CI
   secret store, never in the repo.
