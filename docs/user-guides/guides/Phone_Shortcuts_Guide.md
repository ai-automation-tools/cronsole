<h1 align="center">📱 Phone Shortcuts Guide <sub>(optional)</sub></h1>

<p align="center">
  <em>One tap on your phone's home screen runs one Cronsole task, using a token that can
  do nothing else.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-shipped_2026--10--05-10B981?style=for-the-badge" alt="Status: shipped 2026-10-05">
  <img src="https://img.shields.io/badge/needs-remote_access-8B5CF6?style=for-the-badge" alt="Needs remote access">
  <img src="https://img.shields.io/badge/iOS_%2B_Android-no_app_to_install-F59E0B?style=for-the-badge" alt="iOS and Android">
</p>

---

A phone shortcut is a home-screen icon (or a widget) that sends one request to Cronsole: *run
this task now*. It is the same thing as pressing **Run Now** in the dashboard, without opening
the dashboard, signing in, or finding the task.

It uses apps your phone already has — **Shortcuts** on iPhone, **HTTP Shortcuts** on Android —
so Cronsole ships no mobile app. What Cronsole provides is the part that has to be safe: a token
that can run that one task and is refused for everything else.

## Contents

- [Before you start](#before-you-start)
- [Create the token](#create-the-token)
- [iPhone — Shortcuts](#iphone--shortcuts)
- [Android — HTTP Shortcuts](#android--http-shortcuts)
- [What the response means](#what-the-response-means)
- [What the token can and cannot do](#what-the-token-can-and-cannot-do)
- [Revoking a shortcut](#revoking-a-shortcut)
- [Troubleshooting](#troubleshooting)
- [Why it works this way](#why-it-works-this-way)

## Before you start

- **Your phone must be able to reach Cronsole.** Cronsole is local-first, so this means setting up
  [Remote Access](Remote_Access_Guide.md) first: Tailscale (recommended) or a Cloudflare Tunnel
  behind Access. If you can open the dashboard in your phone's browser, you are ready.
- **The task must be runnable.** The **Phone shortcut** button only appears on tasks that have a
  working **Run Now**. A source that cannot start runs (GitHub Actions, Vercel Cron) has no
  button.

## Create the token

1. Open the task in the dashboard and click **Phone shortcut** in the footer.
2. **Address your phone uses to reach Cronsole** — set this to your Tailscale or tunnel URL, such
   as `https://my-pc.tailnet-name.ts.net`. If you are on the desktop it starts as `localhost`,
   and the dialog warns you until you change it: on your phone, `localhost` is the phone.
3. Choose a lifetime (30, 60 or 90 days, or never) and enter your password.
4. Click **Create shortcut token**. The dialog shows two values with copy buttons:
   - **URL** — `https://<your address>/api/tasks/<task id>/run`
   - **Authorization header** — `Bearer <token>`

> [!WARNING]
> **The token is shown once.** Cronsole stores only its ID, so it cannot show it again. If
> you lose it, revoke it and create another.

The easiest way to get the values onto your phone is to create the token **on the phone**: open
the dashboard there, open the task, and the copy buttons put each value straight onto the
phone's clipboard.

## iPhone — Shortcuts

1. Open **Shortcuts** → **+** (new shortcut). Name it after the task.
2. Add **Get Contents of URL**. Paste the **URL**.
3. Tap the arrow to expand it:
   - **Method:** `POST`
   - **Headers:** add one — key `Authorization`, value the **Authorization header** you copied
     (including `Bearer `).
4. Add **Get Dictionary Value** → key `message` (from *Contents of URL*).
5. Add **Show Notification** with that value.
6. Optional: add **Ask Before Running** at the top if an accidental tap would cost you something.
7. Tap the shortcut's name → **Add to Home Screen**, pick an icon, and you're done. You can also
   add the Shortcuts widget to your home screen and put the shortcut in it.

## Android — HTTP Shortcuts

[HTTP Shortcuts](https://http-shortcuts.rmy.ch/) is free and open source.

1. **+** → **Regular shortcut**. Name it after the task.
2. **Basic request settings:** method `POST`, URL the **URL** you copied.
3. **Request headers:** add `Authorization` with the **Authorization header** value.
4. **Response handling:** show the response as a toast (or a window).
5. Optional: **Trigger & execution settings** → require confirmation.
6. Long-press the shortcut → **Place on home screen**. The app also offers a widget.

## What the response means

The response is the same one **Run Now** gets, as JSON. Its `message` is the line to show.

| Response | Means |
|:---|:---|
| `200`, a message like *Task run command sent* | Cronsole started the run. |
| `200`, a failing message | The task ran and reported failure — for example a Cronsole-native **check** that found a problem. The shortcut worked; the news is about your system. |
| `502` | The platform would not start it: the agent is offline, a routine is paused, and so on. The `error` says which. |
| `403` *This token can only run one task* | The URL names a different task from the one the token was issued for. |
| `403` *This API token has been revoked* | You revoked it. Create a new one. |
| `404` *Task not found* | The task was deleted, or untracked and re-imported (which gives it a new ID). Create a new shortcut for the new task. |

> [!NOTE]
> **For a Windows task, success means the agent *started* it.** Task Scheduler runs it from
> there. Whether it did its job shows up later in Cronsole as the task's last result — the
> same as Run Now on the dashboard.

## What the token can and cannot do

A phone can be lost, so the credential on it is as small as it can be.

- **It can:** send `POST /api/tasks/<that task>/run`. Nothing else.
- **It cannot:** list or read tasks (even its own), change or delete anything, run any other task,
  open the live-update connection the dashboard uses, or create another token. All of these are
  refused with `403`.
- **It is yours:** it runs the task as you, and the run is recorded in the task's history like
  any other manual run.

The restriction is enforced in the one place every request is authenticated, not in the run
route, so a route added later is covered automatically.

> [!CAUTION]
> **Don't put a full API token in a shortcut.** A token from **Settings › API tokens › New API
> token** can do everything your account can, including deleting tasks. Use the task's
> **Phone shortcut** button instead.

## Revoking a shortcut

Phone shortcut tokens are listed under **Settings › API tokens** with a second line, *Runs
only: \<task name\>*, alongside when they were last used. **Revoke** stops the shortcut at once.
If the task has since been deleted, the line says so, and the token stays listed so you can see
it existed.

If a phone is lost, revoke every *Runs only* token issued for it. Then change your password if the
dashboard was signed in on that phone too.

## Troubleshooting

| Symptom | Cause and fix |
|:---|:---|
| The shortcut times out or says it can't connect | The phone can't reach Cronsole. Open the same address in the phone's browser. On Tailscale, check the app is connected; see [Remote Access › Troubleshooting](Remote_Access_Guide.md#troubleshooting). |
| It worked at home and fails elsewhere | The URL is a LAN address (`192.168.…`) or `localhost`. Use your Tailscale or tunnel address, which works from anywhere. |
| Behind Cloudflare Access, it gets an HTML login page | A shortcut cannot complete Access's browser login. Create an Access [service token](https://developers.cloudflare.com/cloudflare-one/identity/service-tokens/), add a *Service Auth* policy for it, and add its `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers to the shortcut alongside `Authorization`. |
| `403` *This token can only run one task* | The URL and the token are for different tasks. Copy both again from one dialog. |
| `401` *Access token required* | The `Authorization` header is missing or misspelled. The value must start with `Bearer ` (with the space). |
| It stopped working after months | The token reached its lifetime. Create a new one; the list in Settings shows the expiry. |

## Why it works this way

- **A `POST`, never a link.** A URL that runs a task when it is opened gets opened by things you
  didn't ask — chat-app link previews, browser prefetching, a security scanner. A run needs a
  `POST` with a header.
- **No mobile app.** iOS Shortcuts and Android HTTP Shortcuts already give you icons, widgets, a
  confirmation step and a notification. A Cronsole app would be a second codebase for that.
- **Not the PWA manifest's shortcuts.** Those are fixed when the app is built, are Android-only,
  and iOS ignores them.
- **Deleting a task cannot widen its token.** The token records which task it may run as a plain
  ID. If that task is deleted the token keeps its restriction and gets `404`; it never falls back
  to full access. (The full reasoning is in CLAUDE.md §9, *A credential on a phone can do one
  thing*.)

## 🔗 Related

| Resource | Why you'd go there |
|:---|:---|
| [**🌐 Remote Access Guide**](Remote_Access_Guide.md) | Making Cronsole reachable from your phone — required first. |
| [**🖥️ UI User Guide**](UI_User_Guide.md) | The task modal, Run Now, and Settings › API tokens. |
| [**🧩 MCP Server Guide**](MCP_Server_Guide.md) | The other long-lived token: a full-account one for AI tools on your desktop. |

---

<p align="center">
  <a href="../README.md">← User Guides</a> ·
  <a href="../../README.md">Docs home</a> ·
  <a href="../../ROADMAP.md">Roadmap</a>
</p>
