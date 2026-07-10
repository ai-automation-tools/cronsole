# TaskHub Performance Baseline - 2026-07-10

## Scope

Local performance baseline after the P1 backend hygiene, stale-pruning guard, mock-agent E2E, and security dependency remediation work.

Environment:

- Windows local dev stack.
- Backend on `localhost:3000`.
- Frontend Vite dev server on `localhost:5173`.
- Postgres and Redis in Docker.
- Windows agent running as a host process.
- Dataset after cleanup: 285 total tasks, 284 Windows-synced tasks, 1 TaskHub-native task, 0 E2E mock tasks.

## API Timing

Read-only timings used 15 calls per endpoint, discarding the first call and reporting 14 samples.

| Endpoint | Result shape | Avg | P50 | P95 |
| --- | ---: | ---: | ---: | ---: |
| `GET /api/health` | `status=ok` | 2.7 ms | 2.6 ms | 3.3 ms |
| `GET /api/tasks` | 285 rows | 76.6 ms | 74.1 ms | 96.9 ms |
| `GET /api/tasks/health` | 2 platforms | 12.8 ms | 12.1 ms | 15.1 ms |
| `GET /api/templates` | 24 templates | 12.5 ms | 10.1 ms | 20.9 ms |

Full sync timing:

| Operation | Result | Elapsed |
| --- | --- | ---: |
| `POST /api/tasks/sync` | Windows count 284, removed 0; native count 0 | 1674.7 ms |

The full sync time is consistent with the previous backend hygiene result: batched upserts avoid one DB round trip per task, so the dominant cost is agent enumeration and socket/serialization overhead rather than 284 sequential database writes.

## Frontend Build

`npm run build` in `frontend`:

- Build time: 1.00 s reported by Vite.
- `dist/index.html`: 1.27 kB raw, 0.68 kB gzip.
- `dist/assets/index-Do6mwmbT.css`: 46.77 kB raw, 8.02 kB gzip.
- `dist/assets/index-IWX2SBeh.js`: 436.62 kB raw, 128.91 kB gzip.

Local browser navigation smoke via Playwright against the dev server:

- `page.goto('/', waitUntil: 'networkidle')`: 1285 ms wall time.
- Navigation `DOMContentLoaded`: 157 ms.
- Navigation `loadEventEnd`: 158 ms.

Interpretation: the app shell loads quickly; dashboard network-idle time is driven by live API/socket work against the local stack and development-server overhead. The production JS bundle is moderate for an MVP dashboard, but future dashboard splitting/router work should code-split the large `Dashboard.tsx` surface.

## Regression Verification

Commands run after dependency remediation:

- Backend typecheck/build: passed.
- Backend unit tests: 123 passed.
- Backend integration tests: 22 passed.
- Frontend lint: passed.
- Frontend unit tests: 45 passed.
- Frontend production build: passed.
- Frontend Playwright E2E: 6 passed.
- Agent xUnit tests: 56 passed.

## Notes And Follow-Ups

- The API read path is healthy for the current 285-task local dataset.
- Full sync is acceptable for manual use at 284 Windows tasks.
- The frontend bundle is not alarming, but P3's planned dashboard split/router work should avoid continuing to grow one large entry chunk.
- Playwright mock-agent E2E can displace the real local agent socket because the MVP has one shared `cli_user_placeholder` agent slot. After E2E, restarting the real agent restored socket health; a real platform sync removed the stale E2E task row.

