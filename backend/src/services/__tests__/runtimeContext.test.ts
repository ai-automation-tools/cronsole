import { describe, it, expect } from 'vitest';
import { describeRights, executionHost } from '../runtimeContext.js';

describe('describeRights', () => {
  it('warns when Cronsole itself is elevated, and never calls that normal', () => {
    const text = describeRights(true, 'win32');
    expect(text).toContain('WARNING');
    expect(text).toContain('Register-CronsoleStack.ps1');
    expect(text).not.toContain('without administrator rights');
  });

  it('names the scheduler that admin work belongs in, per operating system', () => {
    expect(describeRights(false, 'win32')).toContain('Windows Task Scheduler');
    expect(describeRights(false, 'linux')).toContain('cron');
    // Unknown is not "fine": it still states the rule, and claims nothing about this process.
    expect(describeRights(null, 'win32')).toContain('Windows Task Scheduler');
    expect(describeRights(null, 'win32')).not.toContain('They run without');
  });

  it('reports elevation as a fact about this process', () => {
    expect([true, false, null]).toContain(executionHost.elevated);
  });
});
