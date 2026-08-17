<h1 align="center">🌐 Remote Access Guide <sub>(advanced · optional)</sub></h1>

<p align="center">
  <em>Reach your own local Cronsole from your phone or another computer —
  self-hosted, private, no cloud account required.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-tooling_shipped-10B981?style=for-the-badge" alt="Status: tooling shipped">
  <img src="https://img.shields.io/badge/model-self--hosted-8B5CF6?style=for-the-badge" alt="Self-hosted">
  <img src="https://img.shields.io/badge/audience-power_users-F59E0B?style=for-the-badge" alt="Power users">
</p>

---

> [!IMPORTANT]
> **Cronsole is designed as a local-first application.** It runs entirely on your own machine
> and is meant to be used from that machine. This guide is an **optional, advanced
> enhancement** for reaching your own instance from other devices — it is **not** a supported
> launch feature, and it is deliberately sequenced as the *last* item on the
> [Roadmap](../../ROADMAP.md). Follow it only if you understand the security trade-offs below.

## Why this is "advanced"

Cronsole can **create and run commands on your machine** — that's the whole point, but it also
means exposing the dashboard is effectively exposing **remote command execution**.

There *is* a real login screen (single-user, since 2026-07-16: one owner account, created on
first run, with a rate-limited login). What there is **not** is the rest of an internet-facing
account system: no password reset, no refresh tokens (a 24h access token, then you log in
again), no second account, and no per-user agent pairing. A single password in front of remote
command execution is one credential away from a very bad day. So the rule is unchanged:

> [!WARNING]
> **Never put Cronsole directly on the public internet** (no naked port-forwarding of `:3000`
> or `:7373`). The **network layer must be your authentication** — use a private VPN
> (Tailscale) or an access-gated tunnel (Cloudflare Access). Both options below do exactly
> that. Treat Cronsole's own login as a second factor behind that gate, never as the gate.

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

- Cronsole running locally and working in your own browser (see the
  [Quick Start](../../../README.md#-quick-start)).
- Admin access to your PC to install one small networking tool.
- The two remote devices (e.g. PC + phone) both able to run that tool or reach the tunnel.

## Option A — Tailscale (recommended)

[Tailscale](https://tailscale.com) puts your devices on a private, encrypted mesh network with
stable addresses. Nothing is exposed publicly. This is the closest match to "how I access
code-server," and the safest.

**Do the reverse-proxy steps above first.** They are not optional on this path — they are what
makes it one HTTPS URL instead of two plaintext ports.

1. **Install Tailscale** on your PC *and* on each device you want to reach Cronsole from (phone,
   laptop). Sign in to the same account on all of them.

   ```powershell
   winget install Tailscale.Tailscale
   ```

2. **Publish the proxy on your tailnet with `tailscale serve`.**

   ```powershell
   tailscale serve --bg --http=8080 http://127.0.0.1:8080
   ```

   This is the step that makes the loopback binding work rather than fighting it. The proxy
   listens on **`127.0.0.1:8080`** deliberately — binding it to `0.0.0.0` would publish your
   dashboard to every device on whatever café or hotel Wi‑Fi you are on, which is precisely what
   this setup exists to avoid. `tailscale serve` reaches it over loopback from `tailscaled` and
   re-serves it **on the tailnet only**. Nothing binds a public interface at any point, and the
   config persists across reboots.

   Confirm the URL it prints (and see it any time with `tailscale serve status`):

   ```
   http://my-pc.tailnet-name.ts.net:8080/
   ```

   > [!IMPORTANT]
   > **Use `--http=` unless you have enabled HTTPS for your tailnet.** The shorter
   > `tailscale serve --bg 8080` implies TLS, and if certificates are not enabled it **hangs
   > indefinitely** trying to provision one rather than failing with a message — you have to kill
   > it. Check first: `tailscale status --json` reporting `"CertDomains": null` means HTTPS is
   > off.
   >
   > **Plain HTTP here is not the security hole it looks like.** Every byte on a tailnet is
   > WireGuard-encrypted device to device, so this is private without TLS; the browser simply
   > cannot see that and will say "Not secure".

   **To upgrade to HTTPS** (worth it — a secure context is required for the PWA/home-screen work,
   and it removes the warning): enable **HTTPS Certificates** under
   [DNS in the admin console](https://login.tailscale.com/admin/dns), then re-run as
   `tailscale serve --bg 8080` and update `ALLOWED_ORIGINS` to the `https://` origin (no `:8080`).
   The trade-off to know before you flip it: issuing certificates publishes your machine names to
   public **Certificate Transparency logs**, so `my-pc.tailnet-name.ts.net` becomes publicly
   *knowable* — not reachable, but no longer private. That is a real (if small) disclosure, which
   is why it is a deliberate step rather than the default here.

3. **Allow that origin in the backend.** Add it to `ALLOWED_ORIGINS` in `backend/.env`
   (comma-separated, no trailing slash) and restart the backend. One list gates both REST CORS
   and the Socket.IO handshake. Match the scheme **and port** that `serve status` printed —
   `http://…:8080` for the HTTP form above, `https://…` with no port once you enable HTTPS:

   ```bash
   ALLOWED_ORIGINS="http://localhost:7373,http://127.0.0.1:8080,http://my-pc.tailnet-name.ts.net:8080,http://my-pc:8080"
   ```

   Add the **short MagicDNS name** (`http://my-pc:8080`) too — `tailscale serve` publishes both,
   and a phone that resolves the short name would otherwise be refused by CORS while the long
   name works, which reads as "it works on one device and not another".

   **Leave `TRUST_PROXY` unset on this path** — the opposite of the Cloudflare advice below, and
   for a concrete reason: Tailscale makes the *whole machine* reachable on the tailnet, so
   `:3000` is directly addressable and a trusted `X-Forwarded-For` would be forgeable by anything
   on it. The cost of leaving it unset is that the login limiter is one shared bucket, which is
   the right trade when the only callers are your own devices.

4. **Turn off key expiry on the PC.** [Admin → Machines](https://login.tailscale.com/admin/machines)
   → your PC → **Disable key expiry**.

   > [!WARNING]
   > **This is the one that will catch you months later.** Tailscale node keys expire after
   > **180 days** by default. When that happens the machine drops off the tailnet and needs
   > re-authentication — the URL still resolves, it simply stops answering, with no warning
   > beforehand and no obvious connection to anything you changed. Check yours with
   > `tailscale status --json` and look at `Self.KeyExpiry`.
   >
   > Disable it for the machine in the **server** role. Leaving expiry **on** for your phone is
   > the right call: a phone that needs re-auth tells you immediately, whereas the PC failing
   > silently is what leaves you with no way in.

5. **Open it on your phone.** `http://my-pc.tailnet-name.ts.net:8080` — one origin, the login
   screen, and no per-device API-origin override to set, because the `remote` build resolves the
   API against `window.location`. Add it to your home screen and you have the roadmap's "trigger
   from your phone in under 30 seconds", with zero public exposure.

> [!NOTE]
> **`tailscale serve`, not `tailscale funnel`.** They look interchangeable and are opposites:
> `serve` publishes to your tailnet, `funnel` publishes to the **public internet**. Funnel would
> put remote command execution on a public URL behind nothing but Cronsole's single password —
> the exact configuration this guide refuses. If you want a public hostname, use the
> Access-gated tunnel in Option B instead.

## Option B — Cloudflare Tunnel + Access

A real HTTPS URL (e.g. `cronsole.yourdomain.com`) with no inbound ports open:
[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
runs an **outbound-only** connector from your PC. Cronsole ships it as a Compose profile, so it
sits on the same private network as the reverse proxy and never needs a published port.

> [!WARNING]
> **This publishes a hostname on the public internet.** Unlike Tailscale, the address exists for
> everyone; the [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)
> policy is the *entire* network-layer gate. Configure Access **before** you route the hostname,
> not after — a tunnel without a policy in front is a naked port with better TLS.

**Complete the reverse-proxy steps above first** — the tunnel points at the proxy, not at
Cronsole's two ports.

**1. Create the tunnel.** In the [Zero Trust dashboard](https://one.dash.cloudflare.com):
**Networks → Tunnels → Create a tunnel → Cloudflared**. Name it, then copy the **connector
token** from the install command (the long string after `--token`). Do not run the command it
shows — Compose runs the connector for you.

**2. Store the token.** Put it in the repo-root `.env` (gitignored — it is a credential that
authenticates a route into your machine):

```bash
CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoi...
```

**3. Route the hostname to the proxy.** Still in the tunnel's config, add a **Public hostname**:
your chosen hostname, service type **HTTP**, URL **`proxy:80`**. That is the Compose service
name — cloudflared reaches it over the private compose network, which is why nothing has to be
published.

**4. Gate it with Access — do not skip this.** **Access → Applications → Add a self-hosted
application**, pointed at the same hostname, with a policy that allows only you (your email via
one-time PIN, or an identity provider). Cronsole's own login is **not** a substitute: one
password, no reset, no MFA, no lockout beyond rate limiting, in front of remote command
execution. Treat Cronsole's login as the second factor behind Access, never as the gate.

**5. Add the hostname to `ALLOWED_ORIGINS`** in `backend/.env` (full origin, `https://` and no
trailing slash), and set `TRUST_PROXY=1` while you are there:

```bash
ALLOWED_ORIGINS="http://localhost:7373,http://127.0.0.1:8080,https://cronsole.yourdomain.com"
TRUST_PROXY=1
```

`TRUST_PROXY=1` tells Express to read the client address from `X-Forwarded-For` (one hop —
Caddy). Without it every request appears to come from the proxy, so the login rate-limiter
collapses to a **single global bucket** and ten wrong passwords from anywhere lock you out of
your own dashboard. Only set it when the backend is not directly reachable — which is the case
here, since `:3000` stays on the host and only the proxy is routed.

**6. Start it.**

```bash
docker compose --profile remote up -d      # proxy + cloudflared
docker compose logs -f tunnel              # confirm it registers
```

Then restart the backend so it picks up the new env, and open the hostname on your phone. You
should get **Cloudflare Access first**, then Cronsole's login.

> [!TIP]
> An unset `CLOUDFLARE_TUNNEL_TOKEN` shows up in `docker compose logs tunnel`, not at `up`. The
> connector image is distroless, so there is no shell to check it earlier — and making the
> variable *required* would break every other compose command, including starting Postgres. See
> [troubleshooting #54](../../troubleshooting/README.md#54-a-compose-profile-you-never-start-breaks-every-compose-command).

## Making it one URL (the bundled reverse proxy)

Unlike code-server (a single port), Cronsole is two origins — the frontend and the backend API
+ Socket.IO, which the browser calls directly. That is workable over Tailscale (expose both
ports), but for a public tunnel it is much cleaner to collapse them behind **one origin**.

**This is now bundled**, as an opt-in Compose profile: a [Caddy](https://caddyserver.com)
container that serves the built dashboard at `/` and forwards `/api/*` and `/socket.io/*` to the
backend. Set it up once:

**1. Build the dashboard.**

```bash
cd frontend
npm run build
```

Every production build resolves the API against `window.location` rather than a baked-in address,
so **one build is correct at every address it is served from** — `https://cronsole.example.com`
through the tunnel *and* `http://localhost:8080` locally. That is what removes the per-device
**Settings → About → API origin** override. `npm run build:remote` does the same thing and sets
`VITE_API_URL=same-origin` explicitly; either is fine.

> [!IMPORTANT]
> The proxy serves `frontend/dist`, a **build artifact**. It does not track the dev server, so a
> frontend change is invisible remotely until you rebuild. This is a fourth thing that runs stale
> alongside the Dockerized backend, `agent/publish/` and `mcp-server/dist/`
> — see [troubleshooting #53](../../troubleshooting/README.md#53-the-proxied-dashboard-is-stale-while-the-dev-server-is-current).

> [!NOTE]
> **This used to require `build:remote` specifically, and no longer does** *(changed 2026-08-17)*.
> Plain `npm run build` baked `http://localhost:3000` in as the API address — which is the *phone*
> when the phone loads it — while building cleanly and passing every check, so the page rendered
> perfectly and failed every request. It caught people twice, so the default moved into the code
> instead: the dev server keeps its `localhost:3000` default because the API really is on another
> port there, and a build defaults to same-origin because the only thing that reads `dist` is a
> proxy. If you are on an older checkout, keep using `build:remote`.
> ([#63](../../troubleshooting/README.md#63-the-proxied-dashboard-loads-on-the-phone-but-cannot-reach-the-backend))

**2. Start the proxy and check it locally.**

```bash
docker compose --profile proxy up -d
```

It listens on **`127.0.0.1:8080`** — loopback only, deliberately. Publishing it to the LAN would
be an unauthenticated-at-the-network-layer copy of exactly the thing the tunnel's access gate is
being asked to guard. Open `http://127.0.0.1:8080` and confirm you get the login screen.

**3. Allow the new origin.** Add it to `ALLOWED_ORIGINS` in `backend/.env` and restart the
backend. This one list gates both REST CORS and the Socket.IO handshake, and the failure is
asymmetric in a way that wastes time: `curl` keeps working (it sends no `Origin`) while the
browser shows an empty dashboard and a CORS error.

```bash
ALLOWED_ORIGINS="http://localhost:7373,http://127.0.0.1:8080"
```

If the backend runs in Docker rather than on the host, also set
`CRONSOLE_BACKEND_UPSTREAM=backend:3000` — the default, `host.docker.internal:3000`, points at
the host-run stack that `scripts/cronsole.ps1` starts.

## Security checklist

- [ ] Cronsole is reachable **only** over Tailscale or an Access-gated tunnel — never a raw
      public port.
- [ ] **The dashboard bundle carries no credential.** Run `cd frontend && npm run check:bundle`.
      A `VITE_*` variable is compiled into the JavaScript and served to every visitor, so it is
      public by construction — and a `VITE_DEV_TOKEN` left in `.env.local` was, until
      2026-08-15, inlined into `npm run build` output as a valid owner token, which made the
      login screen decorative for anyone who could load the page. The check runs automatically
      on every build; run it by hand if you are serving a `dist/` built before that date. See
      [troubleshooting #55](../../troubleshooting/README.md#55-the-dashboard-is-already-signed-in-on-a-browser-that-never-logged-in).
- [ ] **Cloudflare Access has a policy attached to the hostname**, and you have verified it by
      opening the URL in a private window — the tunnel is public the moment it is routed, and an
      application created without a policy admits everyone.
- [ ] `TRUST_PROXY` is set **only** behind the reverse proxy, never when `:3000` is reachable
      directly — a trusted `X-Forwarded-For` on a directly-reachable backend lets a caller forge
      their address and evade the login rate-limiter entirely.
- [ ] `ALLOWED_ORIGINS` lists exactly your remote frontend origin(s) and nothing broader. It
      gates **both** the REST API's CORS headers and the Socket.IO handshake, so a missing
      origin means "no data and no live updates", and an over-broad one is a real widening.
      **Leaving it empty is permissive, not safe** — the backend warns at boot when it is.
- [ ] You understand that anyone who reaches the dashboard **and knows the one password** can
      run/create tasks on your machine, so the access gate (VPN membership / Access login) is
      your real security boundary — Cronsole's login is the layer behind it, not instead of it.
- [ ] Keep your `JWT_SECRET`, `ENCRYPTION_KEY`, and `AGENT_PAIRING_SECRET` strong and private
      (see [Setup](../../setup/README.md)).

## Troubleshooting

| Symptom | Likely cause / fix |
|:---|:---|
| Dashboard loads but shows "backend offline" | The API-origin override (Settings → About) isn't set to the reachable backend address, or the backend isn't listening on that interface. |
| Tasks list is empty / CORS errors in console | The remote frontend origin isn't in `ALLOWED_ORIGINS` — add it and restart the backend. |
| Live updates don't arrive | Same as above — the `/ui` Socket.IO connection needs the origin allowed and the backend reachable on `:3000`. |
| Works on PC, not on phone | Confirm both devices are on the tailnet (Tailscale) or that the tunnel hostname resolves on the phone. |
| Dashboard loads but is an **older version** than `:7373` | The proxy serves `frontend/dist`. Rebuild it (`npm run build`). ([#53](../../troubleshooting/README.md#53-the-proxied-dashboard-is-stale-while-the-dev-server-is-current)) |
| Dashboard loads, is **up to date**, and cannot reach the backend | The opposite of the row above: the bundle has an absolute API address baked in rather than resolving same-origin. On a current checkout this only happens if `VITE_API_URL` is set to an absolute origin somewhere; on an older one it means `dist` was built with `npm run build` back when that baked in `http://localhost:3000`. Rebuild (`npm run build:remote` on an older checkout). ([#63](../../troubleshooting/README.md#63-the-proxied-dashboard-loads-on-the-phone-but-cannot-reach-the-backend)) |
| Every `docker compose` command fails on a missing `CLOUDFLARE_TUNNEL_TOKEN` | A `${VAR:?}` is interpolated for the whole file regardless of profile. Fixed in-repo; if you added your own, use `${VAR:-}`. ([#54](../../troubleshooting/README.md#54-a-compose-profile-you-never-start-breaks-every-compose-command)) |
| Dashboard opens **already signed in** with no login | A credential was compiled into the bundle. Run `npm run check:bundle` and rebuild. ([#55](../../troubleshooting/README.md#55-the-dashboard-is-already-signed-in-on-a-browser-that-never-logged-in)) |
| `502` from `/api/*` through the proxy | `CRONSOLE_BACKEND_UPSTREAM` points at the wrong place — `host.docker.internal:3000` for the host-run stack, `backend:3000` for the Dockerized one. |
| `tailscale serve --bg 8080` **hangs forever**, no output, no error | It is trying to provision a TLS certificate on a tailnet where HTTPS is not enabled. Kill it, then use `tailscale serve --bg --http=8080 http://127.0.0.1:8080`, or enable HTTPS Certificates in the admin console. `"CertDomains": null` in `tailscale status --json` is the tell. |
| Tailnet URL loads but the task list is empty | The origin in `ALLOWED_ORIGINS` does not match what `tailscale serve status` prints — check the **scheme and the port**, and add the short MagicDNS name as well as the full one. |
| Nothing resolves on the phone | Both devices must be signed into the **same** tailnet (`tailscale status` should list the phone). MagicDNS must be on in the admin console. |
| Worked for months, then stopped, and nothing changed | **Node key expiry** — the 180-day default. The URL still resolves but the machine has left the tailnet. Check `Self.KeyExpiry` in `tailscale status --json`, re-authenticate, then disable key expiry for the PC so it cannot recur. |
| The URL changed by itself | The Tailscale device name follows the OS hostname, so renaming the machine renames the URL. Pin the machine name in the admin console to decouple them. Enabling HTTPS also changes it — to `https://…` with **no** `:8080`, which needs a matching `ALLOWED_ORIGINS` update. |
| Locked out after a few wrong passwords, from every device | `TRUST_PROXY` is unset, so the per-IP limiter is one global bucket. Set `TRUST_PROXY=1` (only behind the proxy) and wait out the 15-minute window. |

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
