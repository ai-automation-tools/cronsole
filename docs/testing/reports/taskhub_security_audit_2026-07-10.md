# TaskHub Security Audit - 2026-07-10

## Scope

Audit of the local MVP control plane after the P0/P1 hardening work:

- Express REST API auth, validation, CORS, and error handling.
- Agent Socket.IO authentication and command execution path.
- Task sync/stale-pruning safety.
- Frontend token/storage/XSS-sensitive patterns.
- Native HTTP job executor.
- npm and NuGet dependency advisories.

## Result

Status: acceptable for the current single-user local MVP after dependency remediation.

Not cleared for public multi-user hosting yet. The remaining public-hosting gaps are tracked in `docs/ROADMAP.md` under the Go-public checklist.

## Remediated During Audit

Production dependency audit initially found high-severity advisories:

- Backend: 4 high advisories (`ws` via Socket.IO transitive packages, plus `form-data`).
- Frontend: 1 high advisory (`form-data`).
- Agent NuGet packages: no known vulnerable packages for `TaskHub.Agent` or `TaskHub.Agent.Tests`.

Remediation applied:

- `backend/package-lock.json`
  - `engine.io` 6.6.8 -> 6.6.9
  - `socket.io-adapter` 2.5.7 -> 2.5.8
  - `ws` 8.20.1 -> 8.21.0
  - `form-data` 4.0.5 -> 4.0.6
- `frontend/package-lock.json`
  - `form-data` 4.0.5 -> 4.0.6

Post-fix `npm audit --omit=dev --json`:

- Backend production dependencies: 0 vulnerabilities.
- Frontend production dependencies: 0 vulnerabilities.

## Positive Controls Observed

- Backend fails fast on weak/missing `JWT_SECRET`, `ENCRYPTION_KEY`, and `AGENT_PAIRING_SECRET`.
- REST task routes derive `userId` from the JWT and owner-scope by-id operations.
- `PlatformConnection.config` is encrypted at rest with AES-256-GCM; legacy plaintext rows still read.
- Agent Socket.IO channel requires HMAC handshake with nonce replay protection.
- State-changing agent commands are signed per session; `task:create` signs the structured action and trigger.
- Agent rejects replayed command signatures inside the freshness window.
- Windows task creation uses structured `ExecAction` data instead of implicit `cmd.exe /c`.
- Template apply now substitutes parameters server-side per token, so quoted values cannot split into extra arguments.
- App-level error boundary returns generic 500s for unexpected errors and field-qualified 400s for validation failures.
- Frontend search found no `dangerouslySetInnerHTML`, `eval`, or `new Function` usage in app source.
- Dev JWT is environment-sourced (`VITE_DEV_TOKEN`) with no committed fallback.
- Agent `appsettings.json` is gitignored; only `appsettings.example.json` is committed.
- Stale-pruning now skips empty snapshots and suspicious partial snapshots for established platforms.

## Findings

### Medium - REST CORS is open

`backend/src/app.ts` uses `cors()` without origin restriction for REST routes. Socket.IO has origin restrictions elsewhere, but REST does not.

Local MVP impact is low because the backend is intended for localhost. Public-hosting impact is medium: restrict REST CORS to configured frontend origins before hosting beyond a trusted local network.

### Medium - No API or auth rate limiting

The archived test plan expected `429` behavior on login, but `/api/auth/login` and the general API currently have no rate limiter.

This is already tracked under Go-public operations. It should be implemented before public multi-user exposure.

### Medium - Missing HTTP security headers

The Express app does not mount Helmet or equivalent response security headers.

Local MVP impact is low. Hosted impact is medium, especially once the backend is reachable from browsers outside localhost.

### Medium - MVP auth/session model is not production-ready

The frontend uses a dev token from environment config, and JWTs are 24h bearer tokens with no refresh, session revocation, password reset, or real account UI.

This is acceptable for the current single-user local workflow, but public hosting needs the roadmap's real account system and session management work.

### Medium - Shared agent pairing secret maps every agent to the placeholder user

Agent auth is cryptographically enforced, but pairing is still MVP-wide: every authenticated agent resolves to `cli_user_placeholder`.

Public multi-user launch needs per-user pairing codes/secrets and agent ownership binding.

### Medium - Native HTTP jobs can reach arbitrary HTTP(S) URLs

`NativeTaskExecutor` validates scheme and method, but does not block private-network targets, metadata endpoints, loopback, or untrusted hostnames.

This is fine for trusted local-only jobs. In a hosted multi-user backend, this becomes an SSRF class risk and needs allowlisting or network-range blocking.

### Low - Dev/local storage contains non-secret preferences and quick links

Frontend `localStorage` usage is limited to theme/settings/platform quick links. No bearer token is stored in `localStorage`.

Treat user-added platform links as untrusted display data, but current React rendering escapes it by default.

## Verification

Commands run after remediation:

- `npm audit --omit=dev --json` in `backend`: 0 production vulnerabilities.
- `npm audit --omit=dev --json` in `frontend`: 0 production vulnerabilities.
- `dotnet list TaskHub.Agent.csproj package --vulnerable --include-transitive`: no vulnerable packages.
- `dotnet list TaskHub.Agent.Tests.csproj package --vulnerable --include-transitive`: no vulnerable packages.
- `npm run build` in `backend`: passed.
- `npm test` in `backend`: 123 passed.
- `npm run test:integration` in `backend`: 22 passed.
- `npm run lint` in `frontend`: passed.
- `npm test` in `frontend`: 45 passed.
- `npm run build` in `frontend`: passed.
- `npm run test:e2e` in `frontend`: 6 passed.
- `dotnet test agent/TaskHub.Agent.slnx`: 56 passed.

