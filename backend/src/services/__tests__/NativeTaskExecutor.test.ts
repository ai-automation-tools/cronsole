import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { validateJob, executeJob, NativeJob } from '../NativeTaskExecutor.js';

vi.mock('axios', () => ({
  default: { request: vi.fn() }
}));

describe('validateJob', () => {
  it('accepts a valid HTTP job', () => {
    expect(validateJob({ jobType: 'HTTP', url: 'https://example.com' })).toBeNull();
    expect(validateJob({ jobType: 'HTTP', url: 'http://localhost:3000/x', method: 'post' })).toBeNull();
  });

  it('rejects missing or malformed specs', () => {
    expect(validateJob(undefined)).toMatch(/Missing/);
    expect(validateJob({})).toMatch(/jobType/);
    expect(validateJob({ jobType: 'SHELL', url: 'https://x.com' })).toMatch(/Unsupported/);
    expect(validateJob({ jobType: 'HTTP', url: 'ftp://x.com' })).toMatch(/url/);
    expect(validateJob({ jobType: 'HTTP', url: 'https://x.com', method: 'TRACE' })).toMatch(/method/);
  });
});

describe('executeJob', () => {
  beforeEach(() => {
    vi.mocked(axios.request).mockReset();
  });

  it('reports success on 2xx responses', async () => {
    vi.mocked(axios.request).mockResolvedValue({ status: 200, data: 'ok' });

    const job: NativeJob = { jobType: 'HTTP', url: 'https://example.com/ping' };
    const result = await executeJob(job);

    expect(result.success).toBe(true);
    expect(result.log).toContain('GET https://example.com/ping → 200');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(axios.request).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://example.com/ping',
      method: 'GET',
      timeout: 15000
    }));
  });

  it('reports failure on non-2xx responses', async () => {
    vi.mocked(axios.request).mockResolvedValue({ status: 503, data: 'unavailable' });

    const result = await executeJob({ jobType: 'HTTP', url: 'https://example.com' });

    expect(result.success).toBe(false);
    expect(result.log).toContain('503');
  });

  it('reports failure on network errors', async () => {
    vi.mocked(axios.request).mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await executeJob({ jobType: 'HTTP', url: 'https://example.com' });

    expect(result.success).toBe(false);
    expect(result.log).toContain('ECONNREFUSED');
  });

  it('fails fast on invalid job specs without calling axios', async () => {
    const result = await executeJob({ jobType: 'HTTP', url: 'notaurl' } as NativeJob);

    expect(result.success).toBe(false);
    expect(axios.request).not.toHaveBeenCalled();
  });

  it('truncates long response bodies in the log', async () => {
    vi.mocked(axios.request).mockResolvedValue({ status: 200, data: 'x'.repeat(2000) });

    const result = await executeJob({ jobType: 'HTTP', url: 'https://example.com' });

    expect(result.log.length).toBeLessThan(600);
  });
});
