<a id="rest-prompts-top"></a>

<h1 align="center">🌐 REST API Prompts</h1>

<p align="center">
  <em>Drive Cronsole directly over its REST API — including the operations MCP doesn't expose.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/surface-REST_API-8B5CF6?style=for-the-badge" alt="REST API">
  <img src="https://img.shields.io/badge/auth-JWT-F97316?style=for-the-badge" alt="JWT">
</p>

---

Not every interaction needs an MCP host. When you're in a plain terminal, writing a script, or
you need one of the operations the MCP server doesn't wrap, you can have an assistant drive
Cronsole's **REST API** directly with `curl` (or any HTTP client).

Two reasons to reach for this surface:

1. **No MCP host handy** — you just want the assistant to hit the API from a shell.
2. **A REST-only operation** — template **import/export**, **save-a-task-as-a-template**,
   registry **sync**, and agent **pairing** are *not* exposed over MCP by design. REST is the
   supported path.

> [!IMPORTANT]
> **Prerequisites:** the backend running (default `http://localhost:3000`) and a **JWT** for
> your user. The MCP server's `CRONSOLE_TOKEN` is exactly such a token — see the
> [**MCP Server Guide**](../../user-guides/guides/MCP_Server_Guide.md) for how it's minted. Pass it
> as `Authorization: Bearer <token>`. Never paste a real token into a shared prompt.

For request/response shapes to hand the assistant, see
[**reports/examples/**](../../reports/examples/README.md).

---

## 🔎 Read

```text
Using curl against the Cronsole REST API at http://localhost:3000 with my bearer
token in $CRONSOLE_TOKEN, GET /api/tasks and summarize my tasks by category and
status.
```

```text
Using the Cronsole REST API, fetch the run history for task <task-id>
(GET /api/tasks/:id/executions) and tell me if the last three runs succeeded.
```

```text
Using the Cronsole REST API, GET /api/tasks/folders and list only the folders I
can create a task in.
```

```text
Using the Cronsole REST API, GET /api/tools/platforms and tell me which
capabilities are verified on this machine versus only declared. Treat
"declared" as untested, not as supported.
```

## ➕ Create & apply

```text
Using the Cronsole REST API, POST to /api/tasks to create a task that runs
"powershell.exe -NoProfile -File C:\jobs\report.ps1" on the cron "0 15 * * 1-5"
(that's UTC — I want 8am Pacific weekdays). Show me the request body first.
```

```text
Using the Cronsole REST API, list templates (GET /api/templates), pick the
webhook-ping starter, and apply it (POST /api/templates/:id/apply) with the URL
https://example.com/health and a 10-minute schedule.
```

```text
Using the Cronsole REST API, preview how the cron "0 */4 * * *" converts before I
commit to it (POST /api/tasks/preview), and read back the resulting trigger.
```

## 📦 Import & export (the REST-only operations)

These have **no MCP tool** — REST or the dashboard only.

```text
Using the Cronsole REST API, export task <task-id> (GET /api/tasks/:id/export)
and save it. For a Windows task the body is UTF-16 LE with a BOM — save it back
in that encoding or Windows will reject the re-import.
```

```text
Using the Cronsole REST API, export all my templates (GET /api/templates/export)
to a JSON file so I can back up my catalog.
```

```text
Using the Cronsole REST API, import the template JSON in ./my-template.json
(POST /api/templates/import) and tell me if it validated.
```

```text
Using the Cronsole REST API, turn my existing task <task-id> into a reusable
template (POST /api/tasks/:id/save-as-template) named "Nightly Repo Sync".
```

## ⚙️ Manage

```text
Using the Cronsole REST API, disable task <task-id> (PATCH /api/tasks/:id/status
with { "status": "DISABLED" }) and confirm the new status.
```

```text
Using the Cronsole REST API, re-schedule task <task-id> (PATCH
/api/tasks/:id/schedule) to "0 2 * * *" — verify the trigger conversion first.
```

```text
Using the Cronsole REST API, run task <task-id> now (POST /api/tasks/:id/run) and
report the result.
```

> [!TIP]
> Ask the assistant to **echo the full curl command and the request body before running it**,
> especially for writes. It's the cheapest way to catch a wrong id, a local-vs-UTC schedule
> mistake, or a body that would overwrite the wrong field.

## 🔗 Related

| Resource | Why |
|:---|:---|
| [**🧪 API examples**](../../reports/examples/README.md) | Real request/response JSON to hand the assistant. |
| [**🧩 MCP Server Guide**](../../user-guides/guides/MCP_Server_Guide.md) | How the JWT these prompts need is minted. |
| [**🧩 MCP prompts**](../mcp-server/README.md) | The same operations in natural language, when you have an MCP host. |
| [**✍️ Task authoring & management**](../../../skills/cronsole/references/task-authoring.md) | The rules the API enforces — UTC cron, no-shell, folder refusals. |

---

<p align="center">
  <a href="../README.md">← Prompt Library</a> ·
  <a href="../mcp-server/README.md">MCP Server</a> ·
  <a href="../skills/README.md">Skills</a>
</p>

<p align="right">(<a href="#rest-prompts-top">back to top</a>)</p>
