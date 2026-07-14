<!-- Thanks for contributing to TaskHub. Keep one logical change per PR. -->

## What & why

<!-- What does this change do, and why? Link any related issue. -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / cleanup (no behavior change)
- [ ] Docs
- [ ] CI / tooling

## Checklist

- [ ] Ran the relevant local checks before opening (see [CONTRIBUTING.md](../CONTRIBUTING.md)):
  - backend: `npm test` + `npm run build`
  - frontend: `npm test` + `npm run build` + `npm run lint`
  - agent: `dotnet build` (if `.cs` / protocol touched)
  - mcp-server: `npm run build` (if touched)
- [ ] No secrets, credentials, or personal machine paths are committed.
- [ ] Commands that reach a shell are opted into explicitly (no implicit `cmd.exe /c`); agent commands stay structured/no-shell.
- [ ] Docs updated where behavior or contracts changed (README / ROADMAP / CHANGELOG / guides as appropriate).
- [ ] I did not market a planned feature as shipped.

## How I verified

<!-- Tests added/updated, and any manual/live verification (e.g. against a real agent or browser). -->
