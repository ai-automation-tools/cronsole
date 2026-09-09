import { backendOrigin, devToken } from './env';

export interface ApiTask {
  id: string;
  name: string;
  platform: string;
  status: string;
  externalId: string;
  schedule?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${backendOrigin()}/api${path}`, {
    headers: { Authorization: `Bearer ${devToken()}` }
  });
  if (!res.ok) {
    throw new Error(`GET ${path} failed with ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${backendOrigin()}/api${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${devToken()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error(`POST ${path} failed with ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${backendOrigin()}/api${path}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${devToken()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error(`PATCH ${path} failed with ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(`${backendOrigin()}/api${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${devToken()}` }
  });
  if (!res.ok) {
    throw new Error(`DELETE ${path} failed with ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export function windowsTasksAsAgentTasks(tasks: ApiTask[]) {
  return tasks
    .filter((task) => task.platform === 'WINDOWS_TASK_SCHEDULER')
    .map((task) => {
      const metadata = task.metadata ?? {};
      return {
        path: task.externalId,
        name: task.name,
        state: task.status === 'DISABLED' ? 'Disabled' : 'Ready',
        nextRunTime:
          typeof metadata.nextRunTime === 'string'
            ? metadata.nextRunTime
            : new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        trigger:
          metadata.trigger && typeof metadata.trigger === 'object'
            ? metadata.trigger
            : null,
        actions: Array.isArray(metadata.actions) ? metadata.actions : [],
        enabled: task.status !== 'DISABLED',
        author: 'Cronsole E2E preserve-existing'
      };
    });
}
