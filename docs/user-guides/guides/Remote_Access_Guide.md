<h1 align="center">🌐 Remote Access Guide <sub>(advanced · optional)</sub></h1>

<p align="center">
  <em>Reach your own local TaskHub from your phone or another computer —
  self-hosted, private, no cloud account required.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-future_enhancement-6B7280?style=for-the-badge" alt="Status: future enhancement">
  <img src="https://img.shields.io/badge/model-self--hosted-8B5CF6?style=for-the-badge" alt="Self-hosted">
  <img src="https://img.shields.io/badge/audience-power_users-F59E0B?style=for-the-badge" alt="Power users">
</p>

---

> [!IMPORTANT]
> **TaskHub is designed as a local-first application.** It runs entirely on your own machine
> and is meant to be used from that machine. This guide is an **optional, advanced
> enhancement** for reaching your own instance from other devices — it is **not** a supported
> launch feature, and it is deliberately sequenced as the *last* item on the
> [Roadmap](../../ROADMAP.md). Follow it only if you understand the security trade-offs below.

## Why this is "advanced"

TaskHub can **create and run commands on your machine** — that's the whole point, but it also
means exposing the dashboard is effectively exposing **remote command execution**.

There *is* a real login screen (single-user, since 2026-07-16: one owner account, created on
first run, with a rate-limited login). What there is **not** is the rest of an internet-facing
account system: no password reset, no refresh tokens (a 24h access token, then you log in
again), no second account, and no per-user agent pairing. A single password in front of remote
command execution is one credential away from a very bad day. So the rule is unchanged:

> [!WARNING]
> **Never put TaskHub directly on the public internet** (no naked port-forwarding of `:3000`
> or `:7373`). The **network layer must be your authentication** — use a private VPN
> (Tailscale) or an access-gated tunnel (Cloudflare Access). Both options below do exactly
> that. Treat TaskHub's own login as a second factor behind that gate, never as the gate.

## The model (how this differs from "hosting")

This is the [code-server](https://github.com/coder/code-server) pattern: you don't run a
public server that others log into — you run **your own** full stack locally and simply reach
it remotely over a private connection.

```
   Your phone / laptop                Your Windows PC (everything runs here)
   ┌──────────────┐                   ┌───────────────────────────────────────┐
   │  browser     │ ── private VPN ──►│  frontend :7373                        │
   │  (dashboard) │    or tunnel      │  backend  :3000 ── agent ── Task Sched. │
   └──────────────┘                   │  postgres                              │
                                      └───────────────────────────────────────┘
```

The agent, backend, and database never leave your machine. Only the **dashboard view** is
reachable remotely, and only over an encrypted, access-controlled channel.

## Prerequisites

- TaskHub running locally and working in your own browser (see the
  [Quick Start](../../../README.md#-quick-start)).
- Admin access to your PC to install one small networking tool.
- The two remote devices (e.g. PC + phone) both able to run that tool or reach the tunnel.

## Option A — Tailscale (recommended)

[Tailscale](https://tailscale.com) puts your devices on a private, encrypted mesh network with
stable addresses. Nothing is exposed publicly. This is the closest match to "how I access
code-server," and the safest.

1. **Install Tailscale** on your PC *and* on each device you want to reach TaskHub from (phone,
   laptop). Sign in to the same account on all of them.
2. **Find your PC's Tailscale address** — either the `100.x.y.z` IP or its MagicDNS name (e.g.
   `my-pc.tailnet-name.ts.net`) from the Tailscale admin console or `tailscale ip`.
3. **Allow the remote origin in the backend.** In the backend env, add the frontend's Tailscale
   origin to `ALLOWED_ORIGINS` (comma-separated) so CORS and the live-update socket accept it,
   then restart the backend:
   ```bash
   ALLOWED_ORIGINS=http://my-pc.tailnet-name.ts.net:7373
   ```
4. **Point the remote dashboard at the backend.** On the remote device, open
   `http://my-pc.tailnet-name.ts.net:7373`, then in **Settings → About → API origin** set the
   backend origin to `http://my-pc.tailnet-name.ts.net:3000`. This uses the runtime
   API-origin override (stored per-device), so no rebuild is needed. *(Alternatively, build the
   frontend with `VITE_API_URL` set to that backend origin.)*
5. **Bookmark it.** You now reach TaskHub from that device whenever both are on the tailnet —
   hitting the roadmap's "trigger from your phone in under 30 seconds" goal, with zero public
   exposure.

> [!TIP]
> Tailscale's **Serve** feature can put HTTPS in front of your local ports on the tailnet, so
> you can use `https://…` addresses instead of `http://…:7373`. Optional, but nicer.

## Option B — Cloudflare Tunnel

If you want a real HTTPS URL (e.g. `taskhub.yourdomain.com`) without opening any inbound
ports, [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
runs an outbound-only connector from your PC.

1. Install `cloudflared` on your PC and authenticate it to your Cloudflare account/domain.
2. Create a tunnel and route a hostname to your **single exposed origin** (see the reverse
   proxy note below — a public URL is much cleaner as one origin than two).
3. **Gate it with [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)**
   — require a login (your email, an identity provider, or a one-time PIN) in front of the
   tunnel. TaskHub's own single-user login is **not** a substitute for this: one password, no
   reset, no lockout beyond rate limiting, in front of remote command execution. **Do not
   skip it.**
4. Add the tunnel hostname to the backend `ALLOWED_ORIGINS`.

## Making it one URL (optional reverse proxy)

Unlike code-server (a single port), TaskHub is two origins — the frontend and the backend API
+ Socket.IO, which the browser calls directly. That's fine over Tailscale (expose both ports),
but for a public tunnel it's cleaner to collapse them behind **one origin** with a small
reverse proxy that serves the frontend and forwards `/api` + `/socket.io` to the backend.

A [Caddy](https://caddyserver.com) or nginx container in front does this in a few lines
(serve `/` → frontend, proxy `/api/*` and `/socket.io/*` → `backend:3000`). A bundled,
opt-in reverse-proxy Compose profile is a **planned convenience** tied to this roadmap item —
until then, you can add one yourself if you want the single-URL setup.

## Security checklist

- [ ] TaskHub is reachable **only** over Tailscale or an Access-gated tunnel — never a raw
      public port.
- [ ] `ALLOWED_ORIGINS` lists exactly your remote frontend origin(s) and nothing broader. It
      gates **both** the REST API's CORS headers and the Socket.IO handshake, so a missing
      origin means "no data and no live updates", and an over-broad one is a real widening.
      **Leaving it empty is permissive, not safe** — the backend warns at boot when it is.
- [ ] You understand that anyone who reaches the dashboard **and knows the one password** can
      run/create tasks on your machine, so the access gate (VPN membership / Access login) is
      your real security boundary — TaskHub's login is the layer behind it, not instead of it.
- [ ] Keep your `JWT_SECRET`, `ENCRYPTION_KEY`, and `AGENT_PAIRING_SECRET` strong and private
      (see [Setup](../../setup/README.md)).

## Troubleshooting

| Symptom | Likely cause / fix |
|:---|:---|
| Dashboard loads but shows "backend offline" | The API-origin override (Settings → About) isn't set to the reachable backend address, or the backend isn't listening on that interface. |
| Tasks list is empty / CORS errors in console | The remote frontend origin isn't in `ALLOWED_ORIGINS` — add it and restart the backend. |
| Live updates don't arrive | Same as above — the `/ui` Socket.IO connection needs the origin allowed and the backend reachable on `:3000`. |
| Works on PC, not on phone | Confirm both devices are on the tailnet (Tailscale) or that the tunnel hostname resolves on the phone. |

## 🔗 Related

| Resource | Why you'd go there |
|:---|:---|
| [**⚙️ Setup & Configuration**](../../setup/README.md) | Environment variables (`ALLOWED_ORIGINS`, `VITE_API_URL`, secrets). |
| [**🖥️ UI User Guide**](UI_User_Guide.md) | Using the dashboard once you can reach it. |
| [**🗺️ Roadmap**](../../ROADMAP.md) | Where remote access sits — the final, optional P3 enhancement. |

---

<p align="center">
  <a href="../README.md">← User Guides</a> ·
  <a href="../../README.md">Docs home</a> ·
  <a href="../../ROADMAP.md">Roadmap</a>
</p>
