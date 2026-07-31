# 🔐 Security Checks

> **Covers:** F4.3, F4.4, F4.5, F4.6 · I2.2, I2.4, I3.2, I6.3 · R3.1, R3.5, R3.6, R3.7, R3.8
> **Time:** ~20 min · **Needs:** the stack + `psql` (via the db container)

P0 hardening is **complete** — this runbook exists to prove it stayed that way, by inspecting
the **actual database** and the **actual wire**, not by trusting the tests that assert it.

The automated suites cover most of this ([`encryption-at-rest.integration.test.ts`](../../../../backend/test/integration/encryption-at-rest.integration.test.ts),
[`idor.integration.test.ts`](../../../../backend/test/integration/idor.integration.test.ts)).
Run this before a release anyway: those tests prove the code path, this proves the **running
system**.

Complete the [preflight](../README.md#-preflight--do-this-once-per-session) first. `$H` holds
your auth header.

---

## 1. ⭐ Config is ciphertext in the database

Look at the real bytes:

```powershell
docker exec taskhub-db-1 psql -U cronsole -d cronsole `
  -c 'SELECT id, platform, "config" FROM "PlatformConnection";'
```

**Expect:** `config` is **unreadable ciphertext** (AES-256-GCM). You must **not** be able to
spot an API key, a hostname, or any JSON structure.

**If you can read it, stop and treat it as a P0.** The whole at-rest guarantee is that someone
with your DB file gets nothing.

## 2. It still decrypts correctly

```powershell
Invoke-RestMethod http://localhost:3000/api/tasks/health -Headers $H | ConvertTo-Json -Depth 5
```

**Expect:** health resolves — which it can only do by decrypting that config. Ciphertext at
rest *and* a working round-trip is the pass; ciphertext alone could just mean it's corrupt.

## 3. Decrypted values never hit the logs

```powershell
docker logs taskhub-backend-1 2>&1 | Select-String -Pattern 'apiKey|api_key|secret|password|Bearer '
```

**Expect:** **no hits** containing real secret values. Encryption at rest is pointless if the
plaintext is sitting in `docker logs`.

## 4. ⭐ Tenant isolation (IDOR)

Act as a second user and try to reach the first user's data.

There is **no registration endpoint** — account creation is `/setup`, which 409s once the
owner exists (that refusal is itself part of the check). So mint a token for a second
identity directly, which tests the same thing more sharply: owner scoping is enforced on the
`userId` **inside the token**, not on which accounts happen to exist.

```powershell
# From backend/ — signs a valid token for a user id that owns nothing.
$t2 = node -e "require('dotenv').config(); console.log(require('jsonwebtoken').sign({ id: 'manual-test-user-b', email: 'manual-test-b@example.com' }, process.env.JWT_SECRET, { expiresIn: '1h' }))"

$H2 = @{ Authorization = "Bearer $t2" }

# Confirm the closed door while you're here: /setup must refuse a second account.
try {
  Invoke-RestMethod -Method Post http://localhost:3000/api/auth/setup `
    -ContentType 'application/json' `
    -Body (@{ email = 'manual-test-b@example.com'; password = 'TestPassword123!' } | ConvertTo-Json)
} catch { $_.Exception.Response.StatusCode.value__ }   # expect 409

# User B lists their own tasks — should be empty
(Invoke-RestMethod http://localhost:3000/api/tasks -Headers $H2).Count

# User B tries to read one of User A's tasks by id
try { Invoke-RestMethod "http://localhost:3000/api/tasks/<user-A-task-id>" -Headers $H2 }
catch { $_.Exception.Response.StatusCode.value__ }
```

**Expect:** `0` tasks for User B, and **403/404** on User A's task id. Anything else is a
cross-tenant leak.

Now try to **mutate** it — reads aren't the only risk:

```powershell
try {
  Invoke-RestMethod -Method Post "http://localhost:3000/api/tasks/<user-A-task-id>/run" -Headers $H2
} catch { $_.Exception.Response.StatusCode.value__ }

try {
  Invoke-RestMethod -Method Delete "http://localhost:3000/api/tasks/<user-A-task-id>" -Headers $H2
} catch { $_.Exception.Response.StatusCode.value__ }
```

**Expect:** both refused. Then confirm User A's task **still exists** — a refused delete that
deleted anyway is the worst outcome.

> [!IMPORTANT]
> **Re-run step 4 against every route you add.** Each new endpoint is a fresh chance to forget
> the `userId` scope. This is the highest-value check in this runbook.

## 5. Token rejection

```powershell
# No token
try { Invoke-RestMethod http://localhost:3000/api/tasks } catch { $_.Exception.Response.StatusCode.value__ }

# Malformed
try { Invoke-RestMethod http://localhost:3000/api/tasks -Headers @{ Authorization = 'Bearer not.a.jwt' } }
catch { $_.Exception.Response.StatusCode.value__ }

# Well-formed but signed with the wrong secret
$bad = node -e "console.log(require('jsonwebtoken').sign({id:'cli_user_placeholder'},'wrong-secret',{expiresIn:'1d'}))"
try { Invoke-RestMethod http://localhost:3000/api/tasks -Headers @{ Authorization = "Bearer $bad" } }
catch { $_.Exception.Response.StatusCode.value__ }
```

**Expect:** `401`/`403` for all three. The third matters most — it proves signature
verification, not just parsing.

## 6. Passwords are hashed

```powershell
docker exec taskhub-db-1 psql -U cronsole -d cronsole `
  -c 'SELECT email, password FROM "User";'
```

**Expect:** a hash (bcrypt/argon prefix), **never** `TestPassword123!` in plaintext.

## 7. No implicit shell

```powershell
Get-ScheduledTask -TaskPath '\Cronsole\' -ErrorAction SilentlyContinue | ForEach-Object {
  [pscustomobject]@{
    Task    = $_.TaskName
    Execute = $_.Actions.Execute
    Args    = $_.Actions.Arguments
  }
} | Format-Table -AutoSize
```

**Expect:** `Execute` is a **real executable**. Any `cmd.exe` + `/c "…"` must be a template
that **explicitly opted into a shell** — never an implicit one. This is the P0 injection
guarantee; implicit shell means arbitrary parameter text becomes arbitrary code.

## 8. Injection resistance

Apply a template with a hostile parameter value:

```
test" & calc.exe & echo "
```

**Expect:** it lands as a **literal argument** — quoted, escaped, inert. `calc.exe` must not
launch. Verify what actually got registered:

```powershell
(Get-ScheduledTask -TaskPath '\Cronsole\' -TaskName '<name>').Actions | Format-List Execute, Arguments
```

## 9. HMAC replay rejection

Capture a signed command envelope and replay it after its window expires.

**Expect:** **401**. Signed run commands are per-session HMAC'd specifically to stop replay —
so a captured envelope must not be re-usable later.

## 10. CORS refuses unknown origins

**Read the headers, not the status code.** CORS is enforced by the *browser*: a refused
origin still gets a normal `200` and a full response body — what it does not get is the
`Access-Control-Allow-Origin` header that makes the body readable to the calling page. A
check that only prints `%{http_code}` here cannot fail, which is worse than no check.

```powershell
# Refused: expect NO Access-Control-Allow-Origin line.
curl.exe -s -D - -o NUL -H "Origin: https://evil.example.com" `
  -H "Authorization: Bearer $env:TH_TOKEN" http://localhost:3000/api/tasks |
  Select-String -Pattern 'access-control-allow-origin'

# Admitted: expect the origin echoed back verbatim.
curl.exe -s -D - -o NUL -H "Origin: http://localhost:7373" `
  -H "Authorization: Bearer $env:TH_TOKEN" http://localhost:3000/api/tasks |
  Select-String -Pattern 'access-control-allow-origin'
```

**Expect:** no header for `evil.example.com`, and `Access-Control-Allow-Origin:
http://localhost:7373` for the configured origin. Since 2026-07-31 this list gates the
**REST API and the Socket.IO handshake** from one definition (`backend/src/config/origins.ts`);
before that Express reflected any origin while only the socket was restricted.

**Two things that are *not* failures:** a request with **no `Origin` header** is admitted on
purpose (every non-browser caller sends none, and authentication is their gate — which is
why the `curl` above must set `Origin` explicitly to test anything), and an **empty
`ALLOWED_ORIGINS`** is permissive by design — check the backend's boot log for
`ALLOWED_ORIGINS is unset` before concluding the restriction is broken.

## 11. Login rate limit — ⬜ known gap

```powershell
1..10 | ForEach-Object {
  try {
    Invoke-RestMethod -Method Post http://localhost:3000/api/auth/login `
      -ContentType 'application/json' `
      -Body (@{ email = 'manual-test-b@example.com'; password = 'wrong' } | ConvertTo-Json)
  } catch { $_.Exception.Response.StatusCode.value__ }
}
```

**Expect today:** ten `401`s — **no `429`**.

> [!WARNING]
> **This is a documented gap, not a passing test.** The archived Test Plan called for `429`
> after 10 attempts in 10s; it was never implemented. Tracked in the Go-public checklist in
> [ROADMAP](../../../ROADMAP.md). When it ships, this step's pass condition becomes a `429` —
> and it should get an automated test at the same time.

## 12. Dependency audit

```powershell
cd backend  ; npm audit --omit=dev
cd ..\frontend ; npm audit --omit=dev
```

**Expect:** **0 production vulnerabilities**. Nothing gates this in CI, so this reading is the
check. Baseline:
[`artifacts/cronsole_security_audit_2026-07-10.md`](../../../../artifacts/cronsole_security_audit_2026-07-10.md).

## 13. No secrets committed

```powershell
git log --all -p | Select-String -Pattern 'JWT_SECRET\s*=\s*[^$]|ENCRYPTION_KEY\s*=\s*[^$]|AGENT_PAIRING_SECRET\s*=\s*[^$]' |
  Select-Object -First 20
git ls-files | Select-String -Pattern '^\.env|\.env\.local$'
```

**Expect:** no real secret values in history, and **no `.env*` tracked**. The dev-only defaults
baked into `docker-compose.yml` are known and intentional — real rotated secrets live in
`backend/.env` and the root `.env`, both gitignored.

---

## ✅ Pass criteria

- [ ] Config is unreadable ciphertext **and** decrypts correctly (1–2)
- [ ] No plaintext secrets in logs (3)
- [ ] Cross-tenant read **and** write both refused (4)
- [ ] All three bad-token classes rejected (5)
- [ ] Passwords hashed (6)
- [ ] No implicit shell in registered actions (7)
- [ ] Hostile params stay inert (8)
- [ ] Replayed HMAC envelope rejected (9)
- [ ] CORS refuses unknown origins (10)
- [ ] Rate limit gap confirmed as still-open (11)
- [ ] Production `npm audit` = 0 (12)
- [ ] No secrets in git (13)

## 🧹 Cleanup

```powershell
# Remove the test user created in step 4
docker exec taskhub-db-1 psql -U cronsole -d cronsole `
  -c "DELETE FROM \"User\" WHERE email = 'manual-test-b@example.com';"

# Remove any tasks created in step 8
Get-ScheduledTask -TaskPath '\Cronsole\' -ErrorAction SilentlyContinue |
  Where-Object TaskName -like 'manual-test-*' |
  Unregister-ScheduledTask -Confirm:$false

Invoke-RestMethod -Method Post http://localhost:3000/api/tasks/sync -Headers $H
```

---

<p align="center">
  <a href="Agent_Resilience.md">← Agent Resilience</a> ·
  <a href="../README.md">Manual Testing</a> ·
  <a href="../../uat/README.md">UAT →</a>
</p>
