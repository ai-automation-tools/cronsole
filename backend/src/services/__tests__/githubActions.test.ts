import { describe, it, expect } from 'vitest';
import { parseWorkflowSchedules } from '../githubActions.js';

/**
 * **Every interesting case here is in the YAML, and none of them need a
 * network.**
 *
 * A workflow's schedule is the one thing GitHub's API will not tell you: the
 * workflows endpoint returns id, name, path and state and never the triggers,
 * so reading a cron means fetching the file and parsing it. That makes this
 * function the single point where a wrong answer becomes a wrong schedule on
 * screen — and the wrong answer that matters is not a crash. It is returning an
 * **empty list** where the truth is *"I could not read this"*, because the two
 * render identically as "no schedule" and only one of them is a fact.
 *
 * That is troubleshooting #60's shape exactly: `shiftCron` declined to convert a
 * multi-value hour, returned no reason, and the renderer turned the silence into
 * *"the timezone doesn't matter"*. So the assertions below check `reason` as
 * carefully as they check `crons`.
 */
describe('parseWorkflowSchedules', () => {
  it('reads the canonical block form', () => {
    const result = parseWorkflowSchedules(`
name: Nightly
on:
  schedule:
    - cron: '0 9 * * 1-5'
jobs:
  build:
    runs-on: ubuntu-latest
`);
    expect(result).toEqual({ crons: ['0 9 * * 1-5'] });
  });

  it('reads a quoted `on` key', () => {
    // Written this way in a great many real workflows, because under YAML 1.1
    // the bare word `on` is the boolean true. js-yaml v4 follows YAML 1.2 and
    // keeps it a string — but a file written defensively must still read.
    const result = parseWorkflowSchedules(`
"on":
  schedule:
    - cron: "30 2 * * *"
`);
    expect(result.crons).toEqual(['30 2 * * *']);
  });

  it('reads the boolean key a YAML 1.1 parser would have produced', () => {
    // A file that literally says `true:` — the shape a 1.1 round-trip leaves
    // behind. Cheap to accept, and the alternative is silently reporting a
    // scheduled workflow as unscheduled.
    const result = parseWorkflowSchedules(`
true:
  schedule:
    - cron: '0 0 * * 0'
`);
    expect(result.crons).toEqual(['0 0 * * 0']);
  });

  it('keeps every cron when a workflow declares several', () => {
    const result = parseWorkflowSchedules(`
on:
  schedule:
    - cron: '0 6 * * *'
    - cron: '0 18 * * *'
`);
    expect(result.crons).toEqual(['0 6 * * *', '0 18 * * *']);
  });

  it('collapses whitespace runs GitHub tolerates', () => {
    // GitHub accepts `0  9 * * *`; Cronsole's storage contract is a normalized
    // 5-field string, so it is normalized here rather than at four call sites.
    const result = parseWorkflowSchedules(`
on:
  schedule:
    - cron: '  0   9  *  * *  '
`);
    expect(result.crons).toEqual(['0 9 * * *']);
  });

  it('reads a schedule beside other triggers', () => {
    const result = parseWorkflowSchedules(`
on:
  push:
    branches: [main]
  workflow_dispatch:
  schedule:
    - cron: '15 3 * * *'
`);
    expect(result.crons).toEqual(['15 3 * * *']);
  });

  it('returns an honest empty for a workflow with no schedule trigger', () => {
    // Read successfully, and the answer is "no cron". No reason, because there
    // is nothing we failed to do — this workflow simply is not scheduled, and
    // the connector drops it rather than showing a task with no cadence.
    const result = parseWorkflowSchedules(`
on:
  push:
    branches: [main]
`);
    expect(result).toEqual({ crons: [] });
  });

  it('returns an honest empty for the flow-sequence trigger form', () => {
    const result = parseWorkflowSchedules('on: [push, pull_request]\n');
    expect(result).toEqual({ crons: [] });
  });

  it('gives a reason when the file does not parse', () => {
    const result = parseWorkflowSchedules('on:\n  schedule:\n   - cron: "unterminated\n');
    expect(result.crons).toEqual([]);
    expect(result.reason).toMatch(/could not parse/i);
  });

  it('gives a reason when there is no `on:` block at all', () => {
    const result = parseWorkflowSchedules('name: Broken\njobs: {}\n');
    expect(result.crons).toEqual([]);
    expect(result.reason).toMatch(/no `on:` block/);
  });

  it('gives a reason when `schedule` is not a list', () => {
    // Invalid to GitHub too — but "invalid" and "absent" must not render the
    // same, or a broken workflow reads as an unscheduled one.
    const result = parseWorkflowSchedules('on:\n  schedule: nightly\n');
    expect(result.crons).toEqual([]);
    expect(result.reason).toMatch(/not a list/);
  });

  it('skips a schedule entry with no cron rather than inventing one', () => {
    const result = parseWorkflowSchedules(`
on:
  schedule:
    - {}
    - cron: '0 4 * * *'
`);
    expect(result.crons).toEqual(['0 4 * * *']);
  });

  it('does not execute YAML tags', () => {
    // js-yaml v4's default schema has no JS types, so a `!!js/function` tag is
    // a parse error rather than a code path. Pinned because the input is a file
    // from a repository Cronsole does not own.
    const result = parseWorkflowSchedules('on: !!js/function "function(){}"\n');
    expect(result.crons).toEqual([]);
    expect(result.reason).toBeDefined();
  });
});
