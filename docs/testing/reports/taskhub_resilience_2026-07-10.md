# TaskHub Resilience QA - 2026-07-10

## Scope

P1 QA resilience slice focused on sync/run/create flows that can damage trust if they fail badly:

- Agent-backed browser flows through the mock Socket.IO agent.
- Repeated sync + Run Now + template-create E2E loop.
- Agent offline status after disconnect.
- Destructive stale-pruning safety when a connector returns a bad partial snapshot.

## Changes Verified

- Added a stale-pruning guard in `TaskService.removeStaleTasks`:
  - Empty snapshots prune nothing.
  - Established platforms with 20+ tracked rows skip pruning when the returned snapshot is less than 50% of tracked rows.
  - Small task sets still prune normally, so legitimate low-count test/dev platforms keep existing behavior.
- Added backend unit coverage for:
  - Normal stale pruning.
  - Empty snapshot skip.
  - Suspicious partial snapshot skip.
- Added real-Postgres integration coverage for:
  - Normal stale pruning.
  - Suspicious partial snapshot preserving 30 existing rows.
- Re-ran the mock-agent Playwright suite and a short single-worker repeat loop.

## Results

| Check | Result |
|---|---:|
| Backend unit tests | 123 passed |
| Backend integration tests | 22 passed |
| Frontend lint | passed |
| Frontend unit tests | 45 passed |
| Playwright E2E | 6 passed |
| Mock-agent repeated E2E soak | 12 passed, `--repeat-each=3 --workers=1` |

## Notes

- A parallel `--repeat-each=3` run is not valid for the current MVP because the backend intentionally maps all authenticated agents to `cli_user_placeholder`; parallel mock agents displace each other's socket. The correct soak mode is single-worker until per-user / multi-agent pairing lands.
- The stale-pruning guard is intentionally conservative. It prevents catastrophic deletion on bad partial snapshots, but a real mass-delete of most Windows tasks may require a second explicit sync strategy in the future.
- Remaining P1 QA items: security audit and performance report.

