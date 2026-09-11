<a id="privacy-top"></a>

<h1 align="center">🔒 What Leaves Your Machine</h1>

<p align="center">
  <em>Not a privacy policy. A list of every outbound connection Cronsole can make, and how to check it.</em>
</p>

<p align="center">
  <a href="TRUST.md"><img src="https://img.shields.io/badge/see_also-what_it_can_do-8B5CF6?style=for-the-badge" alt="Trust"></a>
  <a href="../SECURITY.md"><img src="https://img.shields.io/badge/reporting-SECURITY.md-2ea44f?style=for-the-badge" alt="Security policy"></a>
  <a href="README.md"><img src="https://img.shields.io/badge/↩-documentation-6B7280?style=for-the-badge" alt="Docs"></a>
</p>

---

## Why this is not a privacy policy

A privacy policy is a document about a service that collects your data. Cronsole is not a service.
There is no Cronsole server, no Cronsole account, no Cronsole database anywhere but the one running
on your own computer. Nobody here receives your data, because there is no *here* to receive it.

What is actually useful to you is narrower and more concrete: **which outbound network connections
this software can make, when, and to where.** That is the list below, and at the bottom is how to
verify it rather than take our word for it.

---

## The short version

**A default install initiates no outbound connection of its own.** Not telemetry, not a version
check, not a catalog fetch, not a font. Everything that goes out of your machine goes out because
you connected a source, wrote a job that calls something, or turned on remote access.

---

## 1. What a default install sends: nothing

Three specific claims, each one checkable:

- **There is no telemetry or analytics anywhere in the codebase.** No Sentry, no PostHog, no Google
  Analytics, no crash reporter, in any of the four workspaces (backend, frontend, agent,
  MCP server). Not disabled by a flag — **absent**.
- **The template catalog is compiled in, not fetched.** `TEMPLATE_REGISTRY_URL` is commented out in
  `backend/.env.example`, so a fresh install reads the bundled templates from its own binary.
  Pointing it at the hosted registry is a line *you* uncomment.
- **The dashboard loads nothing from the internet.** No CDN, no web fonts, no remote scripts —
  every asset is served from your own machine. (The dashboard contains plenty of *links* to
  external sites; a link is a page you can choose to click, not a request the page makes.)

**Error reporting was considered and deliberately cancelled** *(2026-09-11)*. Shipping a tool whose
entire claim is that it runs on your machine, and having it mail stack traces to a third party,
would contradict the claim — and a stack trace from a scheduled-task manager is not an anonymous
artifact. The cost is real and worth naming: Cronsole's maintainers find out about a crash when
somebody opens an issue, and not before. That is the trade
([the decision](ROADMAP.md#application-goes-public)).

---

## 2. What goes out when you connect a source

Cronsole connects to other schedulers on your instruction. Each one is an account you already have,
reached with a credential you supply, and **none of them is contacted until you connect it.**

| Source | Talks to | What it sends |
|:---|:---|:---|
| **GitHub Actions** | `api.github.com` | Your token, and reads of the repositories you named |
| **Vercel Cron** | `api.vercel.com` | Your token, and reads of your projects' cron configuration |
| **Gemini API Triggers** | `generativelanguage.googleapis.com` | Your API key, and the triggers you create — **including their prompts** |
| **Claude Code routines** | `api.anthropic.com`, `claude.ai` | Your Claude credential, and reads of your routines |
| **Windows Task Scheduler** | *nothing* | Local only. The agent talks to your backend and to Windows |
| **Cronsole native jobs** | *nothing, unless the job does* | See §3 |

Two of these deserve more than a table row:

**Gemini is the one source where a credential of yours is stored on somebody else's system.**
Creating a trigger means handing Google an API key so the trigger can do its work later — that is
how the platform functions, not something Cronsole adds. Cronsole states what a create actually
granted (which tools, which domains, and that a credential now lives on the platform) at the moment
you create it, because reach is the consequential half of scheduling an autonomous agent.

**Claude routines are read with a credential Cronsole never stores.** It is read at call time and
never written down, on the standing rule that a task manager must not be able to invalidate the
login of the tool that created the task.

---

## 3. What goes out because you told it to

- **HTTP jobs** call the URL you typed, with the headers and body you wrote.
- **Webhook and notification templates** post where you pointed them.
- **`EXEC` and `SCRIPT` jobs** run the program you named, which can do anything that program does.
  Cronsole gives such a child process an **allowlisted environment**, never the backend's own —
  that process holds the key encrypting every stored credential, and it does not get handed down.
- **The hosted template registry** (`mikesailab.com/cronsole-registry`) is fetched only if you set
  `TEMPLATE_REGISTRY_URL`. It is a static JSON file; the request carries no identity beyond an
  ordinary HTTP request's, and Cronsole sends nothing about your tasks with it.
- **Remote access**, if you turn it on, deliberately publishes your dashboard through a tunnel you
  configure. It is opt-in, binds to loopback, and expects an access gate in front of it — see the
  [Remote Access Guide](user-guides/guides/Remote_Access_Guide.md).

---

## 4. Where your data actually lives

| What | Where | Protection |
|:---|:---|:---|
| Tasks, run history, archives, collections | Your Postgres container's volume | Local disk |
| Platform credentials (API keys, tokens) | `PlatformConnection.config` | **AES-256-GCM**, encrypted before storage |
| Per-job secrets | `TaskSecret` | **AES-256-GCM**. **No route returns a value** — not a filter, an absent read path |
| Your login | Your Postgres, single user | Created once at first run; there is no registration endpoint at all |
| Agent configuration | `appsettings.json` in the clone | Not `AppData`, not the registry |

Two properties worth stating because they are easy to get wrong and expensive to notice late:

- **A job stores a *reference* to a secret, never the secret.** `${secret.NAME}` is what lives in
  the task, so every downstream reader — exports, archives, log lines, MCP responses — is structurally
  incapable of leaking a value it never held.
- **Cronsole redacts what it writes, and never stores what a platform shows you.** Secret values are
  stripped out of the run logs Cronsole keeps. A platform's *own* run output is fetched live when you
  open it and stored nowhere.

---

## 5. Your data, and getting rid of it

There is no "export my data" request to file and nobody to file it with — it is your database on
your disk.

- **Export** already exists per task, in two formats: `native` (full fidelity — Task Scheduler XML
  or a Cronsole bundle) and `template` (portable). Run history exports as CSV.
- **Deletion** is `docker compose down -v`. **And it has an edge worth reading before you rely on
  it:** that removes Cronsole's database, *not the scheduled tasks Cronsole created*. Those keep
  running, because they are ordinary Windows tasks and Cronsole never owned them. The full removal
  sequence is in [**What Cronsole can do on your machine › How to remove it
  completely**](TRUST.md#6-how-to-remove-it-completely).

---

## 6. The public website

[`cronsole.mikesailab.com`](https://cronsole.mikesailab.com) is one static page listing the template
catalog. It sets **no cookies**, has no analytics and no third-party scripts. It stores exactly one
thing in your browser — `cronsole.gallery.theme`, remembering whether you chose dark or light — and
that never leaves your browser.

---

## 7. How to check all of this

Every claim above is about code you have a copy of:

```bash
# No telemetry SDK anywhere. Expect zero results.
grep -ril "sentry\|posthog\|mixpanel\|analytics" backend/src frontend/src mcp-server/src

# The catalog is compiled in by default — expect this line commented out.
grep -n "TEMPLATE_REGISTRY_URL" backend/.env.example

# Every external host the backend can reach.
grep -rhoin "https://[a-z0-9.-]*" backend/src --include=*.ts | sort -u
```

And from outside the code:

- Open the dashboard with your browser's **Network tab** on. Every request should be to your own
  machine.
- `docker compose logs -f backend` shows what the backend is doing, as it does it.
- The **Diagnostics** screen and `/doctor` report which platforms are connected — which is exactly
  the list of who Cronsole can talk to.

If any of this turns out to be wrong, that is a bug and a serious one:
[`SECURITY.md`](../SECURITY.md) has the reporting path.

---

<p align="center">
  <a href="TRUST.md">← What Cronsole can do on your machine</a> ·
  <a href="README.md">Documentation home</a> ·
  <a href="../SECURITY.md">Security policy</a>
</p>
