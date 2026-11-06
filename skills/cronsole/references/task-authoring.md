# Task authoring & management

**The guide is the Connect Pack copy:
[`backend/src/tools/connect-pack/references/task-authoring.md`](../../../backend/src/tools/connect-pack/references/task-authoring.md).**
Read it before creating or managing a task through Cronsole — every creation path, command
recipes and quoting, composing a hosted-agent prompt, the schedule traps, folders and refusals,
the verb table (MCP tool ↔ REST route), verifying, backing up, and the checklist.

There is deliberately no second copy here. This file used to be a hand-kept fork of that one and
drifted: it marked tools that exist as "no MCP tool", named the wrong delete route, and lacked the
backup section. The pack copy is the one users download, so it is the one that stays right.

---

## Editing the guide

- Edit the markdown under `backend/src/tools/connect-pack/`, then `cd backend && npm run
  connectpack:build`. It is compiled into `connectPackBundled.ts` because `tsc` emits only `.js`;
  `connectPack.test.ts` fails if the bundle and the markdown disagree.
- **Bump `CONNECT_PACK_VERSION`** (`backend/src/tools/connectPack.ts`, with a dated note) and the
  `vX.Y` stamp in every pack file on any wording change. Two downloads must never carry the same
  version and different words; the test checks every file carries the current stamp.
- The pack describes how to **use** Cronsole and must not need the source: no file paths, no
  internal function names. Developer-only facts belong here, below.
- The verb table is read as complete — a missing or "—" cell is a claim that no tool exists.
  After adding, renaming or gating an MCP tool, check it against the `registerTool(` calls in
  `mcp-server/src/tools.ts` (the §11a row in `AGENTS.md`).

## What the guide states, and where it is enforced

| Claim in the guide | Where it lives |
|:---|:---|
| A Windows command becomes `{executable, args[]}` with no implied shell (the P0 injection guarantee) | the command tokenizer on the backend; §9 › Security, *structured `exec` stays no-shell* |
| `folder`, `overwrite`, `createFolders` and the restore XML's sha256 cannot be tampered with in transit | they ride **inside** the per-session HMAC signature (§9 › Agent ↔ server protocol) |
| `\Microsoft\` is refused | in the backend **and** independently in the agent |
| Prompt warnings (question · gutter characters · unaddressed email) | `services/promptPreflight.ts`, `POST /api/tools/prompt-preflight` and `promptWarnings` on the create — warns, never refuses |
| `${secret.NAME}` is substituted and redacted | `services/jobSecrets.ts` / `executeJob` in `services/NativeTaskExecutor.ts` (ADR 0003) |
| `delete_task` is native-only and archives first | the **backend route** `DELETE /api/tasks/:id/native`, not the MCP wrapper; `DELETE /api/tasks/:id` (Windows, UI only) has no MCP tool by design |
| Only `delete_task` and `delete_template` are gated | `CRONSOLE_MCP_ALLOW_DESTRUCTIVE`; when off they are **absent** from `tools/list` |
| A rare cron becomes an hourly trigger | [#14](../../../docs/troubleshooting/README.md#14-a-rare-cron-becomes-an-hourly-trigger) |
| `SUCCESS` on a hung command | [#12](../../../docs/troubleshooting/README.md#12-a-template-passes-every-test-and-still-hangs-on-the-target) |
| An em-dash breaks a BOM-less `.ps1` | troubleshooting #6 |
| Unattended AI CLI recipes | [templates.md](templates.md) › AI Pack |

## Canonical sources

| Topic | Doc |
|:---|:---|
| MCP tools, wiring, tokens | [`docs/user-guides/guides/MCP_Server_Guide.md`](../../../docs/user-guides/guides/MCP_Server_Guide.md) |
| Routes, data model, agent protocol | [architecture.md](architecture.md) |
| The catalog / registry | [templates.md](templates.md) |
| Traps in full | [`docs/troubleshooting/README.md`](../../../docs/troubleshooting/README.md) |
| What's shipped / next | [`docs/ROADMAP.md`](../../../docs/ROADMAP.md) |
