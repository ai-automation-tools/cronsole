import { describe, it, expect } from 'vitest';
import {
  cronExternalId,
  projectFromExternalId,
  normalizeProjectInput,
  readConfig,
  redactConfig,
  removeProject,
  upsertProject,
  looksLikeVercelToken,
  type StoredProject
} from '../vercelProjects.js';

const project = (over: Partial<StoredProject> = {}): StoredProject => ({
  id: 'prj_abc123',
  name: 'website',
  ...over
});

describe('externalId ↔ category round trip', () => {
  // The invariant this pins: a Vercel task's **category is derived from its id**,
  // exactly as a Windows task's folder is, and `TaskService.extractCategory`
  // imports the same reader the connector writes with. A second copy of "how do
  // you read a project out of an id" is what took a whole folder out of every
  // sync (troubleshooting #20a).
  it('reads the project back out of an id it wrote', () => {
    const id = cronExternalId(project(), '/api/cron');
    expect(projectFromExternalId(id)).toBe('website');
  });

  it('survives a path containing slashes and a query string', () => {
    // The realistic shape: Vercel's own docs show `/api/crons/sync?hello=world`.
    // Splitting on every separator rather than the first one would report the
    // category as `website` for one path and something else for another.
    const id = cronExternalId(project(), '/api/crons/sync-something?hello=world');
    expect(projectFromExternalId(id)).toBe('website');
  });

  it('keys on the path, not the schedule', () => {
    // The whole reason the id is shaped this way: a reschedule must not read as
    // "the old task went MISSING and a new one appeared", losing its category
    // and its star.
    expect(cronExternalId(project(), '/api/cron')).toBe(cronExternalId(project(), '/api/cron'));
  });

  it('returns null for an id with no separator', () => {
    expect(projectFromExternalId('website')).toBeNull();
    expect(projectFromExternalId('#/api/cron')).toBeNull();
  });
});

describe('normalizeProjectInput', () => {
  it('takes a prj_ id', () => {
    expect(normalizeProjectInput('prj_abc123')).toEqual({ kind: 'id', id: 'prj_abc123' });
  });

  it('takes a dashboard URL and keeps the team slug', () => {
    // The slug is load-bearing, not decoration: a team project looked up without
    // it resolves against the *personal* account and 404s, which reads as a typo
    // when it is a scope problem.
    expect(normalizeProjectInput('https://vercel.com/acme/website')).toEqual({
      kind: 'name',
      name: 'website',
      teamSlug: 'acme'
    });
  });

  it('takes a dashboard URL with a trailing path', () => {
    // Someone copying the address bar from the Cron Jobs tab arrives with this.
    expect(normalizeProjectInput('https://vercel.com/acme/website/settings/cron-jobs')).toEqual({
      kind: 'name',
      name: 'website',
      teamSlug: 'acme'
    });
  });

  it('takes a bare name as a personal-account lookup', () => {
    expect(normalizeProjectInput('website')).toEqual({ kind: 'name', name: 'website' });
  });

  it('takes a bare team/project pair', () => {
    expect(normalizeProjectInput('acme/website')).toEqual({
      kind: 'name',
      name: 'website',
      teamSlug: 'acme'
    });
  });

  it('refuses a bare team page rather than guessing a project from it', () => {
    // `vercel.com/acme` is an account, not a project. Guessing would store a
    // name that 404s at the first sync with nothing to say why.
    expect(normalizeProjectInput('https://vercel.com/acme')).toBeNull();
  });

  it('refuses empty input', () => {
    expect(normalizeProjectInput('   ')).toBeNull();
  });
});

describe('readConfig', () => {
  it('tolerates a shape written by an older build', () => {
    expect(readConfig(undefined)).toEqual({ projects: [] });
    expect(readConfig({ projects: 'nope' })).toEqual({ projects: [] });
  });

  it('drops rows missing an id or a name rather than storing a half-project', () => {
    const config = readConfig({ projects: [{ id: 'prj_a', name: 'a' }, { id: 'prj_b' }, { name: 'c' }] });
    expect(config.projects).toEqual([{ id: 'prj_a', name: 'a' }]);
  });

  it('keeps a teamId when one is stored, and omits the key when it is not', () => {
    // Per project rather than per connection: one token reaches every team, and
    // `teamId` is a query parameter on each read, not a second credential.
    const config = readConfig({
      projects: [
        { id: 'prj_a', name: 'a', teamId: 'team_1' },
        { id: 'prj_b', name: 'b' }
      ]
    });
    expect(config.projects[0]).toEqual({ id: 'prj_a', name: 'a', teamId: 'team_1' });
    expect(config.projects[1]).not.toHaveProperty('teamId');
  });
});

describe('redactConfig — the token is write-only', () => {
  it('never returns the value, only a fact about it', () => {
    const redacted = redactConfig({ token: 'abcdefghijklmnopqrstuvwx', projects: [] });
    expect(JSON.stringify(redacted)).not.toContain('abcdefghijklmnopqrstuvwx');
    expect(redacted.hasToken).toBe(true);
    expect(redacted.tokenHint).toBe('uvwx');
  });

  it('reports null rather than a masked string when nothing is stored', () => {
    // So "not connected" and "connected with a token I cannot show you" stay
    // different answers on screen.
    expect(redactConfig({ projects: [] })).toEqual({ hasToken: false, tokenHint: null, projects: [] });
  });
});

describe('upsertProject / removeProject', () => {
  it('adds a project that is not there', () => {
    expect(upsertProject([], project())).toEqual([project()]);
  });

  it('replaces the stored row on a re-add, keyed on the id', () => {
    // The one difference from GitHub's `upsertRepository`, which leaves an
    // existing row alone. Nothing here is a secret, so a re-add can only ever
    // *refresh* — and it is the only path that picks up a rename or a project
    // that moved under a team.
    const before = [project({ name: 'old-name' })];
    const after = upsertProject(before, project({ name: 'new-name', teamId: 'team_1' }));
    expect(after).toEqual([{ id: 'prj_abc123', name: 'new-name', teamId: 'team_1' }]);
  });

  it('removes by id', () => {
    expect(removeProject([project(), project({ id: 'prj_other', name: 'other' })], 'prj_abc123')).toEqual([
      { id: 'prj_other', name: 'other' }
    ]);
  });
});

describe('looksLikeVercelToken is advisory', () => {
  it('accepts the format Vercel issues today', () => {
    expect(looksLikeVercelToken('A1b2C3d4E5f6G7h8I9j0K1l2')).toBe(true);
  });

  it('rejects an obviously wrong paste', () => {
    // Advisory only — the route saves an unrecognized token with a warning
    // rather than refusing it, because a token format is a fact about this year
    // and a 401 that names itself beats refusing one Vercel later introduces.
    expect(looksLikeVercelToken('ghp_this_is_a_github_token')).toBe(false);
    expect(looksLikeVercelToken('short')).toBe(false);
  });
});
