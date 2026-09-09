import type { Task } from '../types';

/**
 * Case-insensitive task search across name, category, platform path
 * (externalId) and the command/schedule stored in metadata. Multiple
 * space-separated terms must all match ("paxai finance" narrows, not widens).
 */
export const matchesTaskSearch = (task: Task, query: string): boolean => {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;

  const meta = (task.metadata ?? {}) as Record<string, unknown>;
  const haystack = [
    task.name,
    task.category,
    task.externalId,
    task.schedule,
    typeof meta.command === 'string' ? meta.command : '',
    typeof meta.schedule === 'string' ? meta.schedule : ''
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return terms.every(term => haystack.includes(term));
};
