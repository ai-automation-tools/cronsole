<h1 align="center">📦 Clone the Repo</h1>

<p align="center">
  <em>The first step for every install path — get the code and the common prerequisites.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/OS-any-6B7280?style=for-the-badge" alt="Any OS">
  <img src="https://img.shields.io/badge/step-1_of_2-2ea44f?style=for-the-badge" alt="Step 1 of 2">
</p>

---

Every path — Windows or macOS, Docker or manual — starts here. Clone the repository, make
sure the common prerequisites are in place, then continue with the guide for your OS.

## 1. Clone

```bash
git clone https://github.com/michaelschecht/taskhub.git
cd cronsole
```

## 2. Install the common prerequisites

| Requirement | Why you need it |
|:---|:---|
| [**Node.js LTS**](https://nodejs.org/) (+ npm) | Builds and runs the frontend and backend. |
| [**Docker Desktop**](https://www.docker.com/products/docker-desktop/) *(recommended)* | Brings up Postgres + Redis + backend + frontend together with one command. Without it, you'll run a PostgreSQL 16 instance yourself. |

## 3. Continue with your OS

| Next guide | Use this when… |
|:---|:---|
| [**🪟 Windows Install Guide**](Windows_Install_Guide.md) | You want the full experience — live Windows Task Scheduler sync and remote triggering. |
| [**🍎 macOS Install Guide**](macOS_Install_Guide.md) | You want to run and explore Cronsole, minus the Windows agent. |

---

<p align="center">
  <a href="../README.md">← Installation home</a> ·
  <a href="Windows_Install_Guide.md">Windows →</a> ·
  <a href="macOS_Install_Guide.md">macOS →</a>
</p>
