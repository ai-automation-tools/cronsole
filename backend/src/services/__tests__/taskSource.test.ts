import { describe, it, expect } from 'vitest';
import { PlatformType } from '@prisma/client';
import { taskSourceKey, sourceMatches } from '../taskSource.js';

/**
 * The split between *platform* (what Cronsole talks to) and *source* (what the
 * user navigates by). These are pinned because getting either half wrong is
 * silent: a bad key just files tasks under the wrong button.
 */

describe('taskSourceKey', () => {
  it('leaves a platform that does not subdivide alone', () => {
    expect(taskSourceKey(PlatformType.WINDOWS_TASK_SCHEDULER, { job: { jobType: 'HTTP' } }))
      .toBe('WINDOWS_TASK_SCHEDULER');
    expect(taskSourceKey(PlatformType.CLAUDE_CODE, null)).toBe('CLAUDE_CODE');
  });

  it('splits Cronsole-native by job type', () => {
    expect(taskSourceKey(PlatformType.TASKHUB_NATIVE, { job: { jobType: 'HTTP' } }))
      .toBe('TASKHUB_NATIVE:HTTP');
    expect(taskSourceKey(PlatformType.TASKHUB_NATIVE, { job: { jobType: 'EXEC' } }))
      .toBe('TASKHUB_NATIVE:EXEC');
  });

  it('falls back to the bare platform rather than guessing a job type', () => {
    // Every native task this app has ever written carries an explicit jobType,
    // so a missing one means the row is wrong. Filing it under HTTP anyway would
    // hide that behind a button where it looks perfectly normal.
    for (const metadata of [null, undefined, {}, { job: {} }, { job: { jobType: 'MYSTERY' } }, 'nonsense']) {
      expect(taskSourceKey(PlatformType.TASKHUB_NATIVE, metadata)).toBe('TASKHUB_NATIVE');
    }
  });
});

describe('sourceMatches', () => {
  it('matches everything under All', () => {
    expect(sourceMatches('TASKHUB_NATIVE:EXEC', 'All')).toBe(true);
    expect(sourceMatches('WINDOWS_TASK_SCHEDULER', 'All')).toBe(true);
  });

  it('matches an exact source', () => {
    expect(sourceMatches('TASKHUB_NATIVE:EXEC', 'TASKHUB_NATIVE:EXEC')).toBe(true);
    expect(sourceMatches('TASKHUB_NATIVE:EXEC', 'TASKHUB_NATIVE:HTTP')).toBe(false);
  });

  it('matches subtypes under their bare platform', () => {
    // The rule that made splitting native safe to ship: a stored preference or a
    // link naming the *platform* keeps working now that sources are finer.
    // Without it, splitting would have silently emptied every one of them.
    expect(sourceMatches('TASKHUB_NATIVE:HTTP', 'TASKHUB_NATIVE')).toBe(true);
    expect(sourceMatches('TASKHUB_NATIVE:EXEC', 'TASKHUB_NATIVE')).toBe(true);
    expect(sourceMatches('TASKHUB_NATIVE', 'TASKHUB_NATIVE')).toBe(true);
  });

  it('does not match a different platform that shares a prefix', () => {
    // Guards the prefix rule against being a substring rule: without the
    // separator, "TASKHUB_NATIVE" would match a hypothetical
    // "TASKHUB_NATIVE_V2" and quietly merge two sources.
    expect(sourceMatches('TASKHUB_NATIVE_V2', 'TASKHUB_NATIVE')).toBe(false);
    expect(sourceMatches('WINDOWS_TASK_SCHEDULER', 'WINDOWS')).toBe(false);
  });

  it('never matches a subtype selection against the bare platform', () => {
    // The asymmetry is deliberate: selecting "Cronsole (Scripts)" must not show
    // a native task whose job type could not be read.
    expect(sourceMatches('TASKHUB_NATIVE', 'TASKHUB_NATIVE:EXEC')).toBe(false);
  });
});
