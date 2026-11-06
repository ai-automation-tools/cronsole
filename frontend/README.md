<h1 align="center">🖥️ Frontend</h1>

<p align="center">
  <em>The dashboard: React 19, TypeScript and Vite, dark by default.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React 19">
  <img src="https://img.shields.io/badge/dev_server-:7373-0078D4?style=for-the-badge" alt="Dev server on port 7373">
  <a href="../README.md"><img src="https://img.shields.io/badge/↩-repository_root-6B7280?style=for-the-badge" alt="Repository root"></a>
</p>

---

Everything here talks to the backend over REST, with TanStack Query holding server state and a
socket event invalidating it. Judgements such as health, creatability or whether a task is a system
task come from the server; the browser displays them and never re-derives one.

## 📂 What's in here

| Path | What it holds |
|:---|:---|
| **`src/screens/`** | The tabs: Dashboard, Sources, Templates, Tools, Quick Links. Everything but the dashboard loads on first open. |
| **`src/components/`** | Modals, panels and the shared `ui/Modal` primitive. |
| **`src/data/`** | In-app help (`help.ts`), onboarding, and `docs.ts`, which builds every link into the docs. |
| **`src/utils/`** | Filters, schedule conversion at the browser's edge, the rail, saved views. |
| **`src/hooks/`** | Settings sync, theme, auth, live task updates. |
| **`src/index.css`** | Every colour, as semantic role tokens. Raw Tailwind palette classes are not allowed. |
| **`src/demo/`** | The fixture adapter behind the hosted demo build. It is folded out of a normal build. |
| **`scripts/check-bundle-secrets.mjs`** | Fails the build if a secret reaches the bundle. |

## ⚡ Commands

```bash
npm install
npm run dev          # http://localhost:7373
npm test             # includes docsLinks.test.ts: every in-app doc link must resolve
npm run lint
npm run build        # what the reverse proxy serves from dist/
```

> [!NOTE]
> A `VITE_*` variable is inlined into the bundle as a literal, so it is public whatever the source
> looks like. The build checks the output, not the source, for that reason.

## 🔗 Related

| Resource | Why you'd go there |
|:---|:---|
| [**🖥️ UI User Guide**](../docs/user-guides/guides/UI_User_Guide.md) | What every screen does, from the user's side. |
| [**🌐 Remote Access Guide**](../docs/user-guides/guides/Remote_Access_Guide.md) | Serving a built bundle through the opt-in proxy. |
| [**🤖 AGENTS.md**](../AGENTS.md) | §9 › Frontend lists the rules this code keeps. |

---

<p align="center">
  <a href="../README.md">← Repository root</a> ·
  <a href="../backend/README.md">Backend</a> ·
  <a href="../agent/README.md">Windows agent</a>
</p>
