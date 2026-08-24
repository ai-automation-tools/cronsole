import { describe, it, expect } from 'vitest';
import {
  normalizeRepository,
  repoFullName,
  workflowExternalId,
  repositoryFromExternalId,
  readConfig,
  redactConfig,
  upsertRepository,
  removeRepository,
  looksLikeGitHubToken
} from '../githubRepositories.js';

describe('normalizeRepository', () => {
  it('accepts the bare owner/repo', () => {
    expect(normalizeRepository('acme/website')).toEqual({ owner: 'acme', repo: 'website' });
  });

  it('accepts the browser URL, which is what people actually paste', () => {
    expect(normalizeRepository('https://github.com/acme/website')).toEqual({
      owner: 'acme',
      repo: 'website'
    });
  });

  it('accepts a deep URL — someone copying from the Actions tab', () => {
    expect(normalizeRepository('https://github.com/acme/website/actions/workflows/nightly.yml')).toEqual({
      owner: 'acme',
      repo: 'website'
    });
  });

  it('accepts the SSH remote and drops the .git suffix', () => {
    expect(normalizeRepository('git@github.com:acme/website.git')).toEqual({
      owner: 'acme',
      repo: 'website'
    });
  });

  it('accepts the HTTPS clone URL', () => {
    expect(normalizeRepository('https://github.com/acme/website.git')).toEqual({
      owner: 'acme',
      repo: 'website'
    });
  });

  it('refuses anything without two segments', () => {
    // The caller turns this into a 400 that says what to paste. Storing a
    // one-segment name would be accepted here and 404 much later, inside a sync,
    // with nothing pointing at the paste as the cause.
    expect(normalizeRepository('acme')).toBeNull();
    expect(normalizeRepository('https://github.com/acme')).toBeNull();
    expect(normalizeRepository('   ')).toBeNull();
  });

  it('does not police the characters GitHub allows in a name', () => {
    // Deliberate: that list is GitHub's and has changed. Refusing a name GitHub
    // accepts is worse than a 404 that explains itself — the same call the
    // Claude route makes about `trig_` ids.
    expect(normalizeRepository('acme/web.site_2')).toEqual({ owner: 'acme', repo: 'web.site_2' });
  });
});

describe('the external id', () => {
  const repo = { owner: 'acme', repo: 'website' };

  it('is keyed on the numeric workflow id, not the file path', () => {
    // `(platform, externalId)` is the identity every tracked row, star and
    // exclusion hangs off, so it has to survive renaming `nightly.yml` or
    // changing the workflow's `name:`. GitHub's workflow id survives both; a
    // path-keyed id would turn a rename into "old task MISSING, new task
    // appeared", losing its category and its star.
    expect(workflowExternalId(repo, 12345)).toBe('acme/website#12345');
  });

  it('round-trips to the repository, which is the category', () => {
    expect(repositoryFromExternalId(workflowExternalId(repo, 12345))).toBe('acme/website');
  });

  it('returns null rather than a guess for an id from another platform', () => {
    expect(repositoryFromExternalId('\\Cronsole\\Nightly')).toBeNull();
    expect(repositoryFromExternalId('trig_01ABC')).toBeNull();
    expect(repositoryFromExternalId('#123')).toBeNull();
  });
});

describe('the stored config', () => {
  it('drops rows it cannot read rather than carrying half a repository', () => {
    const config = readConfig({
      token: 'ghp_abcdefghijklmnopqrstuvwxyz012345',
      repositories: [{ owner: 'acme', repo: 'website' }, { owner: 'acme' }, null, 'nope']
    });
    expect(config.repositories).toEqual([{ owner: 'acme', repo: 'website' }]);
  });

  it('reads an absent config as an empty, well-formed one', () => {
    expect(readConfig(undefined)).toEqual({ repositories: [] });
    expect(readConfig({})).toEqual({ repositories: [] });
  });

  it('never lets the token leave', () => {
    // The only shape that leaves the server. Four characters is enough to answer
    // "is this the token I just made?" when someone has two, and not enough to
    // be one. There is no reveal endpoint, because GitHub cannot re-display a
    // PAT either.
    const redacted = redactConfig({
      token: 'ghp_abcdefghijklmnopqrstuvwxyz012345',
      repositories: [{ owner: 'acme', repo: 'website' }]
    });
    expect(redacted.hasToken).toBe(true);
    expect(redacted.tokenHint).toBe('2345');
    expect(JSON.stringify(redacted)).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz012345');
  });

  it('reports no token as a distinct state, not an empty string', () => {
    const redacted = redactConfig({ repositories: [] });
    expect(redacted).toEqual({ hasToken: false, tokenHint: null, repositories: [] });
  });
});

describe('the watched list', () => {
  const website = { owner: 'acme', repo: 'website' };

  it('is idempotent — a duplicate add is someone checking, not an error', () => {
    const once = upsertRepository([], website);
    expect(upsertRepository(once, website)).toEqual(once);
  });

  it('treats owner and repository names case-insensitively, as GitHub does', () => {
    // Storing both `Acme/Website` and `acme/website` would sync every workflow
    // twice, under two categories that are the same place.
    const once = upsertRepository([], website);
    expect(upsertRepository(once, { owner: 'Acme', repo: 'Website' })).toEqual(once);
    expect(removeRepository(once, { owner: 'ACME', repo: 'WEBSITE' })).toEqual([]);
  });

  it('leaves other repositories alone when one is removed', () => {
    const list = upsertRepository(upsertRepository([], website), { owner: 'acme', repo: 'api' });
    expect(removeRepository(list, website).map(repoFullName)).toEqual(['acme/api']);
  });
});

describe('looksLikeGitHubToken', () => {
  it('recognises the formats GitHub issues today', () => {
    expect(looksLikeGitHubToken('ghp_abcdefghijklmnopqrstuvwxyz012345')).toBe(true);
    expect(looksLikeGitHubToken('github_pat_11ABCDEFG0abcdefghij_KLMNOP')).toBe(true);
    expect(looksLikeGitHubToken('a'.repeat(40).replace(/a/g, 'f'))).toBe(true);
  });

  it('is advisory — an unfamiliar shape is a warning, never a refusal', () => {
    // GitHub has shipped four token formats and will ship more. Refusing one it
    // introduces later would be worse than the 401 that names itself, so the
    // route saves an unrecognised token that *verifies* and warns beside it.
    expect(looksLikeGitHubToken('some_new_prefix_2030_abcdef')).toBe(false);
  });
});
