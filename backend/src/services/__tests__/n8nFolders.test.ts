import { describe, it, expect } from 'vitest';
import { describeDbUrl, isPostgresUrl, readFolderPaths } from '../n8nFolders.js';

describe('n8nFolders', () => {
  it('shows where a URL points and never who it logs in as', () => {
    expect(describeDbUrl('postgresql://reader:s3cret@db.example.com:5432/n8n?sslmode=require'))
      .toBe('db.example.com:5432/n8n');
  });

  it('accepts only postgres URLs', () => {
    expect(isPostgresUrl('postgres://u:p@h/db')).toBe(true);
    expect(isPostgresUrl('mysql://u:p@h/db')).toBe(false);
  });

  // Found driving the route: a connection failure is a
  // PrismaClientInitializationError with `errorCode`, not `code`, so the
  // friendly sentence never fired. Port 1 refuses at once — no network needed.
  it('turns an unreachable database into a sentence without the password', async () => {
    const result = await readFolderPaths('postgresql://reader:s3cret@127.0.0.1:1/n8n');
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/Could not reach the n8n database/) });
    expect(JSON.stringify(result)).not.toContain('s3cret');
  }, 30_000);
});
