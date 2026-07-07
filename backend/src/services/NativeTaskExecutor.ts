import axios from 'axios';

export interface NativeJob {
  jobType: 'HTTP';
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface NativeRunResult {
  success: boolean;
  log: string;
  durationMs: number;
}

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];
const LOG_SNIPPET_LENGTH = 500;

/**
 * Validates a job spec from client input / task metadata.
 * Returns an error message, or null if valid.
 */
export function validateJob(job: unknown): string | null {
  if (!job || typeof job !== 'object') return 'Missing job spec';
  const j = job as Record<string, unknown>;

  if (j.jobType !== 'HTTP') return `Unsupported jobType: ${j.jobType}`;
  if (typeof j.url !== 'string' || !/^https?:\/\//i.test(j.url)) {
    return 'Job url must start with http:// or https://';
  }
  if (j.method !== undefined && !ALLOWED_METHODS.includes(String(j.method).toUpperCase())) {
    return `Job method must be one of ${ALLOWED_METHODS.join(', ')}`;
  }
  return null;
}

/**
 * Executes a TaskHub-native job. HTTP is the only MVP job type
 * (docs/resources/Native_Tasks.md).
 */
export async function executeJob(job: NativeJob): Promise<NativeRunResult> {
  const invalid = validateJob(job);
  if (invalid) {
    return { success: false, log: invalid, durationMs: 0 };
  }

  const method = (job.method ?? 'GET').toUpperCase();
  const startedAt = Date.now();
  try {
    const response = await axios.request({
      url: job.url,
      method,
      headers: job.headers,
      data: job.body || undefined,
      timeout: 15000,
      // Treat any HTTP response as a completed request; status is judged below.
      validateStatus: () => true
    });

    const snippet = typeof response.data === 'string'
      ? response.data.slice(0, LOG_SNIPPET_LENGTH)
      : JSON.stringify(response.data)?.slice(0, LOG_SNIPPET_LENGTH);
    const success = response.status >= 200 && response.status < 300;

    return {
      success,
      log: `${method} ${job.url} → ${response.status}${snippet ? ` | ${snippet}` : ''}`,
      durationMs: Date.now() - startedAt
    };
  } catch (error: any) {
    return {
      success: false,
      log: `${method} ${job.url} failed: ${error.message}`,
      durationMs: Date.now() - startedAt
    };
  }
}
