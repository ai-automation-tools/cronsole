<h1 align="center">🧪 API Examples</h1>

<p align="center">
  <em>Raw request/response samples for the Cronsole REST API.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/format-JSON-000000?style=for-the-badge&logo=json&logoColor=white" alt="JSON">
  <img src="https://img.shields.io/badge/status-reference_only-6B7280?style=for-the-badge" alt="Reference only">
</p>

---

Sample payloads for the REST endpoints. These are **reference-only** — illustrations of the
request/response shapes the Cronsole API uses. Keep them in sync as the API evolves.

## 📂 Sample files

| File | Endpoints it illustrates |
|:---|:---|
| [**platforms.json**](platforms.json) | `POST /platforms/windows/agent/register`, `POST /platforms/claude/connect` |
| [**tasks.json**](tasks.json) | `GET /tasks`, `POST /tasks/{id}/run`, `GET /tasks/{id}/logs` |
| [**templates.json**](templates.json) | `GET /templates`, `POST /templates/{id}/apply`, `POST /templates/convert` |

## 🔗 Related

| Resource | Why you'd go there |
|:---|:---|
| [**🧩 Templates**](../templates/README.md) | The template catalog behind `templates.json`. |
| [**🖥️ UI User Guide**](../../user-guides/guides/UI_User_Guide.md) | Using these endpoints from the dashboard. |

---

<p align="center">
  <a href="../README.md">← Reports</a> ·
  <a href="../templates/README.md">Templates</a>
</p>
