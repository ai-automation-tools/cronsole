# Phase 5: Deployment & Rollout

**Duration:** 1–2 weeks
**Status:** Not started
**Master plan:** [`Project_Plan.md`](Project_Plan.md)
**Predecessor:** [`Phase4.md`](Phase4.md)

---

## Goal

Promote the staging build to production, distribute the Windows agent installer, and complete the controlled rollout from private beta → public beta → GA.

---

## Deliverables

- Production environment (staging → prod) on the chosen host (AWS ECS Fargate or Render).
- User documentation: getting-started guide, agent install guide, template contribution guide.
- Monitoring & alerting: structured logs, metric dashboards, paging on critical errors and agent disconnect spikes.
- Signed `.msi` installer published behind a stable URL with checksum.
- Backup & restore runbook for user task mappings and platform connections.

---

## Production Architecture (recap)

| Layer | Production |
|---|---|
| Frontend | Static build deployed to S3 + CloudFront (or Vercel) |
| Backend API | Docker container on ECS Fargate (or Render) behind ALB |
| WebSocket server | Same container as backend; sticky sessions + Redis adapter for Socket.io |
| Database | AWS RDS Postgres 16 (Multi-AZ for prod) or Render managed Postgres |
| Cache / pub-sub | AWS ElastiCache Redis (or Render Redis) |
| Secrets | AWS Secrets Manager (or 1Password / Vault) |
| TLS | ACM cert on ALB; HSTS enforced |
| Domain | TBD — candidate: `taskhub.mikesailab.com` |

> If the project lands on `*.mikesailab.com`, also update `michaelschecht.github.io/index.html` per the workspace CLAUDE.md rules.

---

## Pre-Launch Checklist

### Infrastructure

- [ ] Terraform / Pulumi (or hand-clicked) prod environment created.
- [ ] RDS Multi-AZ, automated backups, 7-day PITR.
- [ ] ElastiCache deployed; Socket.io Redis adapter wired.
- [ ] ALB target groups configured with sticky sessions on the WebSocket path.
- [ ] DNS records pointing apex + `www` (or chosen subdomain) at CloudFront/ALB.
- [ ] TLS cert provisioned; HTTPS-only redirect enabled.

### Application

- [ ] Production env vars set in Secrets Manager (`DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`, `AGENT_WS_SECRET_SALT`, `REDIS_URL`, `CLAUDE_API_BASE`).
- [ ] `prisma migrate deploy` runs successfully against prod DB.
- [ ] Health-check endpoint returns 200 from ECS.
- [ ] Sentry / equivalent error reporter wired.
- [ ] Rate limiting active on auth + run-trigger endpoints.

### Agent Distribution

- [ ] WiX MSI built and **code-signed** with EV cert.
- [ ] Installer publishes to a stable URL (`https://taskhub.app/agent/TaskHubAgent-1.0.0.msi`) with SHA-256 checksum file.
- [ ] Auto-update mechanism wired: agent polls `/api/v1/agent/version` every 24h.
- [ ] Uninstall flow tested.

### Observability

- [ ] CloudWatch / Datadog dashboards: request rate, error rate, p50/p95 latency, agent-connected count, run-trigger success rate.
- [ ] Alerts:
  - 5xx rate > 1% for 5 min → page.
  - Connected-agent count drops > 20% in 5 min → page.
  - DB CPU > 80% sustained 10 min → warn.
  - Redis evictions > 0 → warn.
- [ ] Log retention: 30 days hot, 365 days cold.

### Documentation

- [ ] **Getting started** — sign up, connect Claude, install Windows agent.
- [ ] **Agent install guide** — Windows requirements, firewall ports, troubleshooting.
- [ ] **Template authoring** — JSON schema, validation rules, submission flow.
- [ ] **API reference** — generated from OpenAPI spec.
- [ ] **README** in the repo (use the **`github-readme`** skill).

### CI/CD

- [ ] `main` → staging auto-deploy.
- [ ] `release/*` tags → prod deploy gated by manual approval.
- [ ] Migration step runs before container swap; rollback path documented.
- [ ] Semantic versioning (`MAJOR.MINOR.PATCH`) on releases.

---

## Rollout Plan

### Stage 1 — Private Beta (Week 1)
- 10–20 power users invited by email.
- Closed feedback channel (private Discord or shared GitHub project).
- Daily monitoring sweep; hotfix turnaround target ≤ 24h.

### Stage 2 — Public Beta (Week 2)
- Open signup with a "beta" badge.
- In-app banner inviting feedback.
- Add a status page (e.g., `status.taskhub.app`).
- Cap at 200 users until autoscaling validated.

### Stage 3 — General Availability
- Remove beta badge.
- Publish announcement post (blog or X/LinkedIn).
- Submit Windows agent for SmartScreen reputation building (if signed with EV).
- Open template gallery for community submissions (moderated until Phase 6 voting ships).

---

## Backup & Restore

- **Database:** RDS automated daily snapshots + 7-day PITR. Quarterly manual snapshot exported to S3 with KMS encryption.
- **User task mappings export:** `/api/v1/users/me/export` returns a JSON dump of platform connections (encrypted blob), tasks, and templates. Documented in the user guide.
- **Restore drill:** at least once per quarter, restore a snapshot to a staging DB and run smoke tests.

---

## Tools

- **`senior-devops`** skill — pipelines, IaC, monitoring.
- **`technical-writer`** subagent — user docs.
- **`github-readme`** skill — final repo README.
- **`update-docs`** skill — keep `docs/Project_Plan.md` status column current.
- **`github`** MCP — release tags, GitHub Releases, deployment PRs.

---

## Phase 5 Exit Criteria

- [ ] Prod environment serving real traffic with zero P0 alerts for 7 consecutive days.
- [ ] ≥ 100 GA signups (or per Mike's threshold).
- [ ] Public docs site live.
- [ ] Agent installer published with checksum and signature verifiable.
- [ ] Status page live.
- [ ] Quarterly restore drill scheduled.

→ Advance to **[Phase 6: Post-Launch & Iteration](Phase6.md)**.
