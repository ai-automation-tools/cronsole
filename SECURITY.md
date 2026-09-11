# Security Policy

Cronsole is a scheduled-task control plane. A local agent runs on your machine and can
**create, run, and delete scheduled tasks** — i.e. it executes commands with your
privileges. Because of that, we take security reports seriously and ask that you do too.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately through GitHub's built-in flow:

1. Go to the repository's **Security** tab → **Report a vulnerability** (GitHub Private
   Vulnerability Reporting).
2. Describe the issue, the impact, and clear steps to reproduce (a proof-of-concept helps).

We aim to acknowledge a report within a few days and to keep you updated as we
investigate and fix. Please give us reasonable time to release a fix before any public
disclosure, and avoid accessing or modifying data that isn't yours while testing.

## Scope

Cronsole runs **entirely on your own machine** (local-first) — there is no hosted service.

> **Not a researcher?** This page is written for vulnerability reports. If you are deciding
> whether to run Cronsole at all, the two pages written for you are
> [**what it can do on your machine**](docs/TRUST.md) — the elevated agent's complete verb list,
> what is enforced against it, and how to remove it — and
> [**what leaves your machine**](docs/PRIVACY.md).

The most security-relevant surfaces are:

- **The Windows agent** — registers/runs/deletes Task Scheduler entries; commands are
  registered as structured, no-shell `ExecAction`s.
- **The agent ↔ backend channel** — the agent connects *outbound* only, authenticates with
  an HMAC handshake over a shared pairing secret, and refuses any command it can't verify
  (per-session HMAC signatures + a replay guard).
- **The REST API** — JWT-scoped per user; task routes are owner-scoped. Browser origins are
  restricted to `ALLOWED_ORIGINS` (both CORS and the Socket.IO handshake).
- **Accounts** — Cronsole is single-user. The **only** way to create an account is `/setup`,
  which works on first run and refuses (409) once an owner exists. There is deliberately no
  open registration endpoint.
- **Config at rest** — platform-connection config (API keys, pairing secrets) is encrypted
  with AES-256-GCM before it's stored.
- **The template catalog / MCP server** — templates are untrusted, executable content that
  is schema-validated and structured no-shell before it can create a task.

Especially interested in: command-injection paths that reach a shell, ways to make the
agent execute an unsigned/forged command, IDOR/authorization gaps between users, or secret
exposure.

### Known limitations (by design, not vulnerabilities)

- The dashboard has a real **single-user** login (one owner, created at first run). What it
  does *not* have is the rest of a multi-user system: no password reset, no refresh tokens
  (a 24h access token, then log in again), and no per-user agent pairing. **Do not expose
  Cronsole directly to the public internet.** If you access it from another device, put it
  behind a private network layer (e.g. Tailscale) or an access-gated tunnel — see the
  [Remote Access Guide](docs/user-guides/guides/Remote_Access_Guide.md).
- The agent runs with your Windows privileges; a task you create runs as you (or elevated,
  if you configure it to). Treat template/command content you didn't author with the same
  caution as any script you'd run yourself.

## Supported versions

Cronsole is pre-1.0. Security fixes land on the latest `main`; there are no back-ported
release branches yet.

## Secrets

Never commit secrets. `JWT_SECRET`, `ENCRYPTION_KEY`, and `AGENT_PAIRING_SECRET` come from
the environment (or a gitignored local config); the backend fails fast if they're missing or
weak. See [`docs/setup/`](docs/setup/README.md) and the `.env.example` files.
