import { describe, it, expect } from 'vitest';
import { toProject } from '../vercelApi.js';

/**
 * The parsing half of the Vercel surface, which is where the interesting cases
 * are and none of them need a network.
 *
 * Every request in `vercelApi.ts` is a `GET`, so the risk is not in what is
 * sent — it is in reading a response *more confidently than it deserves*. The
 * cases below are the three places that could happen.
 */

describe('toProject keeps "never had crons" and "has none right now" apart', () => {
  it('reports crons: null for a project that has never deployed one', () => {
    // The whole reason `crons` is nullable here rather than defaulted to an
    // empty definitions list. A project that has never deployed a cron and one
    // whose crons were all removed are different facts, and the sync says a
    // sentence about the first and nothing about the second.
    expect(toProject({ id: 'prj_a', name: 'website' }, null).crons).toBeNull();
  });

  it('reports an empty definitions list for a project with crons enabled and none declared', () => {
    const project = toProject(
      { id: 'prj_a', name: 'website', crons: { enabledAt: 1, disabledAt: null, updatedAt: 2, deploymentId: null, definitions: [] } },
      null
    );
    expect(project.crons).not.toBeNull();
    expect(project.crons!.definitions).toEqual([]);
  });
});

describe('toProject normalizes what the storage contract requires', () => {
  it('collapses runs of whitespace in a cron', () => {
    // Vercel accepts `0  9 * * *`; Cronsole's storage contract is a normalized
    // 5-field string, so it collapses here rather than in four call sites
    // downstream. Same normalization `parseWorkflowSchedules` does one platform
    // over.
    const project = toProject(
      {
        id: 'prj_a',
        name: 'website',
        crons: {
          enabledAt: 1,
          disabledAt: null,
          updatedAt: 2,
          deploymentId: null,
          definitions: [{ host: 'h', path: '/api/cron', schedule: '  0  9 *  * * ' }]
        }
      },
      null
    );
    expect(project.crons!.definitions[0]!.schedule).toBe('0 9 * * *');
  });

  it('does not convert a timezone, because there is none to convert', () => {
    // Vercel documents cron expressions as UTC with no timezone support, which
    // is Cronsole's storage contract exactly. This connector is the only one
    // besides GitHub that converts nothing anywhere — pinned so a future
    // "helpful" shift has to delete this test to land.
    const project = toProject(
      {
        id: 'prj_a',
        name: 'website',
        crons: {
          enabledAt: 1,
          disabledAt: null,
          updatedAt: 2,
          deploymentId: null,
          definitions: [{ host: 'h', path: '/api/cron', schedule: '0 9 * * *' }]
        }
      },
      null
    );
    expect(project.crons!.definitions[0]!.schedule).toBe('0 9 * * *');
  });
});

describe('toProject drops what it cannot read rather than inventing it', () => {
  it('skips a definition with no path or no schedule', () => {
    // A half-definition would become a task with no id or no cron — a row that
    // can only ever read "unknown" and cannot be acted on.
    const project = toProject(
      {
        id: 'prj_a',
        name: 'website',
        crons: {
          enabledAt: 1,
          disabledAt: null,
          updatedAt: 2,
          deploymentId: null,
          definitions: [
            { host: 'h', path: '/api/ok', schedule: '0 9 * * *' },
            { host: 'h', path: '/api/no-schedule' },
            { host: 'h', schedule: '0 9 * * *' }
          ]
        }
      },
      null
    );
    expect(project.crons!.definitions.map(d => d.path)).toEqual(['/api/ok']);
  });

  it('falls back to the id when a project has no name', () => {
    // The name is the Cronsole category, so an empty one would file every cron
    // under a blank rail node.
    expect(toProject({ id: 'prj_a' }, null).name).toBe('prj_a');
  });

  it('takes the team from the response when it names one, and from the scope otherwise', () => {
    // `teamId` decides which account a later lookup resolves against, so reading
    // it back from the project itself is more reliable than remembering which
    // listing it came from — but the scope is the honest fallback.
    expect(toProject({ id: 'prj_a', name: 'a', accountId: 'team_9' }, null).teamId).toBe('team_9');
    expect(toProject({ id: 'prj_a', name: 'a', accountId: 'user_1' }, 'team_scope').teamId).toBe('team_scope');
  });
});
