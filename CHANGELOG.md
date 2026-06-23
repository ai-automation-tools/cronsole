# Changelog

All notable changes to this repository should be documented in this file.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), adapted for the current MVP stage of TaskHub.

## [Unreleased]

### Added
- Proprietary `LICENSE` / rights notice for the private repository.
- Contributor guide in `CONTRIBUTING.md`.
- Repository contracts document in `docs/CONTRACTS.md`.
- Explicit roadmap and phase-status sync across the planning docs.
- Basic GitHub Actions CI workflow in `.github/workflows/ci.yml`.
- Windows Agent automated startup registration script `setup-agent-startup.ps1` to compile and register the agent inside a dedicated `\Task-Hub\` Task Scheduler folder.
- Headless daemon configuration (`WinExe` output type) for the C# Agent to run silently on logon.
- Setup and troubleshooting manual in `docs/user-guides/Agent_Setup_Guide.md`.

### Changed
- Aligned `README.md`, `CLAUDE.md`, and planning docs with the current implementation state.
- Clarified that the public deployment is a frontend demo backed by sample data.
- Reframed Claude Code support as experimental rather than production-ready.
- Updated immediate action items to focus on Phase 3 exit criteria and Phase 4 QA.

### Known gaps
- Phase 4 QA has not formally started.
- Claude connector behavior is still scaffold-level.
- Hosted backend, staging, and signed Windows agent installer are still pending.

## Repository baseline

Current repo baseline at the time this changelog was introduced:

- Functional Windows Task Scheduler MVP path via local .NET agent.
- React frontend with dashboard, templates, platforms/settings views, demo mode, selective import, and local task categorization.
- Node/Express/Prisma backend with auth routes, task routes, template routes, WebSocket agent bridge, and connector registry.
- Backend test coverage present for encryption, connectors, task service, and agent manager.
