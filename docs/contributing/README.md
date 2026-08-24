# Contributing — extending Cronsole

Documents for people writing code *for* Cronsole rather than using it. The general rules — branch
roles, commit format, local setup, the checks CI runs — are in
[`CONTRIBUTING.md`](../../CONTRIBUTING.md) at the repo root. What lives here is the deeper guidance
for the extension points that have one.

| Doc | What's inside |
|:---|:---|
| [**Adding a source**](Adding_A_Source.md) | Make Cronsole read scheduled work from a platform it doesn't support yet. The three shapes (controller · observer · quick link) and how to pick, the contract a connector must meet, the build order file by file, which existing connector to copy, and what gets declined. |

## Why there is no plugin folder

Every extension point here is **compiled in**, and that is a decision rather than an unfinished
feature. A connector holds third-party credentials, issues commands to the user's own machine, and
decides what a sync is allowed to retire — loading that off disk unreviewed would put arbitrary code
behind Cronsole's trust boundary. So extending Cronsole means a pull request, and the tradeoff is
stated out loud in the app itself rather than only here.

The upside is that an extension cannot silently disagree with the interface it implements: the type
checker and the suite see every connector, so a contract change breaks the build instead of breaking
someone's install.

---

*See also: [`CLAUDE.md`](../../CLAUDE.md) §9 for the full invariant list,
[`DESIGN_NOTES.md`](../DESIGN_NOTES.md) for the argument behind any rule you want to push back on,
and the [Sources Guide](../user-guides/guides/Sources_Guide.md) for what each shipped source does.*

*Last Updated: August 24, 2026*
