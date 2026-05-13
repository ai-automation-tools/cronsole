# API Examples

Raw request/response samples for the REST endpoints described in [`../Phase1.md`](../Phase1.md) (API contracts) and [`../Phase2.md`](../Phase2.md) (WebSocket protocol).

| File | Endpoints |
|---|---|
| [`platforms.json`](platforms.json) | `POST /platforms/windows/agent/register`, `POST /platforms/claude/connect` |
| [`tasks.json`](tasks.json) | `GET /tasks`, `POST /tasks/{id}/run`, `GET /tasks/{id}/logs` |
| [`templates.json`](templates.json) | `GET /templates`, `POST /templates/{id}/apply`, `POST /templates/convert` |

These are reference-only — keep them in sync when the OpenAPI spec changes. The canonical contract source remains Phase 1.
